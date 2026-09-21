import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Silo } from "../dist/index.js";

/** Verifies the built client against a real collection using only public GET methods. */
class VerifyCache {
  httpRequests = 0;
  checks = 0;
  project = process.env.SILO_PROJECT ?? "in-co-sandbox-gst";
  environment = process.env.SILO_ENVIRONMENT ?? "prod";
  collectionName = process.env.SILO_GST_STATE_CODE_COLLECTION ?? "in-co-sandbox-gst-state-code";
  options = {
    url: process.env.SILO_BASE_URL ?? "https://api.silo.quicko.company",
    timeoutMilliseconds: 15_000,
    fetch: (input, init) => {
      this.httpRequests += 1;
      console.log(`  HTTP ${this.httpRequests}: ${init.method} ${input}`);
      return fetch(input, init);
    },
  };

  collection(client) {
    return client.scope(this.project, this.environment).collection(this.collectionName);
  }

  async check(name, expectedRequests, read) {
    const before = this.httpRequests;
    const started = performance.now();
    const result = await read();
    const actualRequests = this.httpRequests - before;
    assert.equal(actualRequests, expectedRequests, `${name}: unexpected HTTP request count`);
    this.checks += 1;
    console.log(`PASS ${name}: ${actualRequests} HTTP request(s), ${Math.round(performance.now() - started)} ms`);
    return result;
  }

  async run() {
    console.log(`Target: ${this.options.url} / ${this.project} / ${this.environment} / ${this.collectionName}`);
    console.log("Read-only verification. No API key is needed for the default public collection.\n");

    const cache = { enabled: true, ttl: 60_000, maxSize: 100 };
    const client = new Silo({ ...this.options, cache });
    const collection = this.collection(client);
    const query = { limit: 5, offset: 0 };

    const page = await this.check("First list reaches the API", 1, () => collection.list(query));
    assert.ok(page.entries.length > 0, "The collection needs at least one entry to verify get()");
    console.log(`\nCollection has ${page.total} entries. Sample:`);
    console.log(JSON.stringify(page.entries[0], null, 2));
    console.log();

    const repeated = await this.check("Repeated list uses cache", 0, () => collection.list(query));
    assert.deepEqual(repeated.entries, page.entries);
    await this.check("Another handle shares this client's cache", 0, () => this.collection(client).list(query));

    const id = page.entries[0].id;
    const entry = await this.check("First entry get reaches the API", 1, () => collection.get(id));
    const repeatedEntry = await this.check("Repeated entry get uses cache", 0, () => collection.get(id));
    assert.deepEqual(repeatedEntry, entry);

    const anotherQuery = { limit: 2, offset: 0 };
    await this.check("Different query has its own cache key", 1, () => collection.list(anotherQuery));
    await this.check("Repeated different query uses cache", 0, () => collection.list(anotherQuery));

    client.cache().clear();
    assert.equal(client.cache().statistics().size, 0);
    await this.check("Read after clear reaches the API", 1, () => collection.list(query));
    await this.check("Read after clear is cached again", 0, () => collection.list(query));

    const anotherClient = new Silo({ ...this.options, cache });
    await this.check("New client has independent storage", 1, () => this.collection(anotherClient).list(query));
    await this.check("withUrl starts with an empty cache", 1, () => this.collection(client.withUrl(this.options.url)).list(query));
    await this.check("withKey starts with an empty cache", 1, () => this.collection(client.withKey(undefined)).list(query));
    await this.check("Original client's cache is still available", 0, () => collection.list(query));

    const disabled = this.collection(new Silo({ ...this.options, cache: { enabled: false } }));
    await this.check("Disabled cache: first read reaches the API", 1, () => disabled.list(query));
    await this.check("Disabled cache: repeated read reaches the API", 1, () => disabled.list(query));

    await this.check("Health reaches the API", 1, () => client.health());
    await this.check("Repeated health is not cached", 1, () => client.health());

    const expiringClient = new Silo({ ...this.options, cache: { enabled: true, ttl: 250, maxSize: 100 } });
    const expiring = this.collection(expiringClient);
    await this.check("Short TTL: first read reaches the API", 1, () => expiring.list(query));
    await this.check("Short TTL: immediate repeat uses cache", 0, () => expiring.list(query));
    await delay(350);
    await this.check("Expired response is fetched again", 1, () => expiring.list(query));

    const limitedClient = new Silo({ ...this.options, cache: { enabled: true, ttl: 60_000, maxSize: 1 } });
    const limited = this.collection(limitedClient);
    await this.check("Capacity one: cache first query", 1, () => limited.list(query));
    await this.check("Capacity one: second query replaces first", 1, () => limited.list(anotherQuery));
    await this.check("Evicted first query is fetched again", 1, () => limited.list(query));
    assert.equal(limitedClient.cache().statistics().size, 1);

    console.log("\nMain client statistics:", client.cache().statistics());
    console.log("Expiry statistics:", expiringClient.cache().statistics());
    console.log("Capacity statistics:", limitedClient.cache().statistics());
    console.log(`\n${this.checks} checks passed; ${this.httpRequests} actual HTTP requests.`);
  }
}

new VerifyCache().run().catch((error) => {
  console.error(`\nFAIL: ${error.message}`);
  process.exitCode = 1;
});
