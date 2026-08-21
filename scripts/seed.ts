#!/usr/bin/env bun
/**
 * A self-contained data seeder: fills a running silo instance with a large,
 * realistic corpus so the admin UI, search, filters and paging can be exercised
 * at a size that hand-entry never reaches.
 *
 * It speaks the public HTTP API and nothing else — no imports from `server/`,
 * `shared/` or `ui/`, and no dependencies beyond Bun's builtins. That is the
 * point of "self-contained": copy this one file at any silo instance, local or
 * remote, and it works. It is also the reason this file is long where the rest
 * of the repo is short, and holds many classes where CONTEXT.md's design rules
 * ask for one artifact per file — a seeder split across a directory would be
 * neither copyable nor droppable, so the rule is traded away deliberately here
 * and nowhere else.
 *
 * The corpus is a function of `--seed` and `--epoch` — the second because dates
 * have to be measured from somewhere, and reading the clock mid-generation is
 * what silently made two runs of one seed differ. `--epoch` defaults to now and
 * every run prints the pair that reproduces it.
 *
 * Writes are additive: it creates and never deletes, and re-running over an
 * instance re-uses the scopes and schemas it finds (projects, environments and
 * schemas are upserts) while appending a fresh generation of entries.
 *
 *   bun run scripts/seed.ts --key "$SILO_KEY"
 *   bun run scripts/seed.ts --url http://localhost:8090 --projects 3 --seed 7
 *   bun run scripts/seed.ts --key "$SILO_KEY" --dry-run
 */
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

/**
 * A seeded PRNG (mulberry32), so a run is reproducible. `Math.random` would
 * make every run a different corpus, and "it only fails on some data" is not a
 * bug report anyone can act on.
 */
class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Inclusive on both ends. */
  int(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  decimal(min: number, max: number, places = 2): number {
    const factor = 10 ** places;
    return Math.round((min + this.next() * (max - min)) * factor) / factor;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)] as T;
  }

  /** `n` distinct members, in a shuffled order, capped at what exists. */
  sample<T>(items: readonly T[], n: number): T[] {
    const pool = [...items];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [pool[i], pool[j]] = [pool[j] as T, pool[i] as T];
    }
    return pool.slice(0, Math.max(0, Math.min(n, pool.length)));
  }
}

/**
 * Dates, measured from an explicit epoch rather than `Date.now()`. Reading the
 * clock inside generation was the one thing that made two runs of the same seed
 * differ — everything else was already reproducible, and the difference was
 * invisible until two corpora were compared field by field.
 */
class Calendar {
  constructor(private readonly rng: Rng, private readonly epoch: number) {}

  /** An ISO instant somewhere in the `daysBack` days before the epoch. */
  past(daysBack = 730): string {
    return new Date(this.epoch - this.rng.int(0, daysBack) * 86_400_000 - this.rng.int(0, 86_399_000)).toISOString();
  }

  /** An ISO instant somewhere in the `daysAhead` days after it. */
  future(daysAhead = 180): string {
    return new Date(this.epoch + this.rng.int(0, daysAhead) * 86_400_000 + this.rng.int(0, 86_399_000)).toISOString();
  }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** The fixed vocabulary every generated string is assembled from. */
class WordBank {
  static readonly Nouns = [
    "platform", "pipeline", "schema", "migration", "release", "dashboard", "index",
    "cache", "tenant", "workflow", "endpoint", "payload", "cluster", "namespace",
    "rollout", "checkout", "invoice", "catalogue", "subscription", "webhook",
    "gateway", "collection", "environment", "snapshot", "backlog", "sprint",
    "budget", "customer", "partner", "warehouse", "storefront", "campaign",
  ] as const;

  static readonly Adjectives = [
    "portable", "resilient", "incremental", "deprecated", "regional", "nightly",
    "self-hosted", "immutable", "federated", "opinionated", "minimal", "audited",
    "throttled", "canary", "legacy", "experimental", "hardened", "observable",
  ] as const;

  static readonly Verbs = [
    "ships", "replaces", "documents", "measures", "throttles", "restores",
    "validates", "streams", "archives", "reconciles", "indexes", "backfills",
  ] as const;

  /**
   * Terms planted on purpose. They recur across every project and collection,
   * so a `⌘K` search has something that genuinely spans scopes to find, and the
   * accented and CJK entries give the tokenizer's folding something real to
   * fold.
   */
  static readonly Signals = [
    "pricing", "latency", "onboarding", "rollback", "throughput", "retention",
    "Café Rouge", "naïve caching", "日本語のテキスト", "façade layer",
  ] as const;

  static readonly FirstNames = [
    "Ada", "Grace", "Alan", "Rosalind", "Kenji", "Ines", "Omar", "Priya", "Nils",
    "Yara", "Tomas", "Leila", "Hugo", "Mei", "Sofia", "Diego", "Anouk", "Kwame",
  ] as const;

  static readonly LastNames = [
    "Lovelace", "Hopper", "Turing", "Franklin", "Tanaka", "Moreau", "Haddad",
    "Iyer", "Bergstrom", "Okafor", "Novak", "Ferreira", "Lindqvist", "Rahman",
  ] as const;

  static readonly Companies = [
    "Northwind Traders", "Acme Interstellar", "Globex Logistics", "Initech Labs",
    "Umbrella Analytics", "Hooli Systems", "Soylent Foods", "Vandelay Imports",
  ] as const;

  static readonly Cities = [
    "Lisbon", "Pune", "Reykjavik", "Nairobi", "Osaka", "Montevideo", "Ghent",
    "Tallinn", "Valencia", "Wellington", "Kraków", "Bengaluru",
  ] as const;

  static readonly Countries = [
    "PT", "IN", "IS", "KE", "JP", "UY", "BE", "EE", "ES", "NZ", "PL", "DE",
  ] as const;

  static readonly Tags = [
    "release", "docs", "infra", "billing", "search", "media", "auth", "beta",
    "breaking", "performance", "ux", "api", "migration", "security", "mobile",
  ] as const;
}

/** Assembles the word bank into titles, sentences, names and slugs. */
class Lorem {
  constructor(private readonly rng: Rng) {}

  word(): string {
    return this.rng.pick(WordBank.Nouns);
  }

  /** A short noun phrase, used for titles and names. */
  phrase(): string {
    const head = this.rng.chance(0.6) ? `${this.rng.pick(WordBank.Adjectives)} ` : "";
    const tail = this.rng.chance(0.35) ? ` ${this.rng.pick(WordBank.Nouns)}` : "";
    return `${head}${this.rng.pick(WordBank.Nouns)}${tail}`;
  }

  title(): string {
    const raw = this.rng.chance(0.25)
      ? `${this.rng.pick(WordBank.Signals)} ${this.phrase()}`
      : this.phrase();
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  sentence(): string {
    const subject = this.phrase();
    const object = this.rng.chance(0.3) ? this.rng.pick(WordBank.Signals) : this.phrase();
    const raw = `the ${subject} ${this.rng.pick(WordBank.Verbs)} ${object}`;
    return `${raw.charAt(0).toUpperCase()}${raw.slice(1)}.`;
  }

  paragraph(sentences = 4): string {
    return Array.from({ length: sentences }, () => this.sentence()).join(" ");
  }

  /** Several paragraphs — the long-form body a search snippet is cut from. */
  body(paragraphs = 3): string {
    return Array.from({ length: paragraphs }, () => this.paragraph(this.rng.int(3, 6))).join("\n\n");
  }

  personName(): string {
    return `${this.rng.pick(WordBank.FirstNames)} ${this.rng.pick(WordBank.LastNames)}`;
  }

  email(person?: string): string {
    const who = (person ?? this.personName()).toLowerCase().replace(/[^a-z]+/g, ".");
    return `${who}@${this.rng.pick(["example.com", "example.org", "test.invalid"])}`;
  }

  url(): string {
    return `https://${this.rng.pick(["docs", "www", "status", "cdn"])}.example.com/${this.slug(this.phrase())}`;
  }

  /** Lowercase, hyphenated, and suffixed so two similar titles stay distinct. */
  slug(from: string): string {
    const base = from.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `${base || "item"}-${this.rng.int(1000, 9999)}`;
  }

  tags(max = 4): string[] {
    return this.rng.sample(WordBank.Tags, this.rng.int(1, max));
  }
}

// ---------------------------------------------------------------------------
// Field model
// ---------------------------------------------------------------------------

type FieldKind =
  | "title" | "slug" | "line" | "body" | "choice" | "int" | "decimal" | "bool"
  | "date" | "future" | "person" | "email" | "url" | "tags" | "object" | "objects";

/**
 * One field, described once. Both the JSON Schema and the values are derived
 * from this, which is what keeps generated entries valid against the schema
 * that was generated beside them — two hand-written halves drift the first time
 * a field changes, and the drift shows up as a `400` mid-run.
 */
interface FieldSpec {
  name: string;
  kind: FieldKind;
  /** Required in the schema, and therefore never omitted from an entry. */
  required?: boolean;
  /** Weighted in the search index via `x-silo-search.label`. */
  label?: boolean;
  /** Kept out of the search index via `x-silo-search.exclude`. */
  secret?: boolean;
  choices?: readonly string[];
  min?: number;
  max?: number;
  /** Paragraphs for `body`, members for `tags`/`objects`. */
  size?: number;
  fields?: FieldSpec[];
}

/** Terse constructors for the catalogue below, so a blueprint reads as a list. */
class Fields {
  static title(name = "title"): FieldSpec {
    return { name, kind: "title", required: true, label: true };
  }
  static name(name = "name"): FieldSpec {
    return { name, kind: "title", required: true, label: true };
  }
  static slug(name = "slug"): FieldSpec {
    return { name, kind: "slug", required: true };
  }
  static line(name: string, label = false): FieldSpec {
    return { name, kind: "line", label };
  }
  static body(name = "body", size = 3): FieldSpec {
    return { name, kind: "body", required: true, size };
  }
  static choice(name: string, choices: readonly string[]): FieldSpec {
    return { name, kind: "choice", required: true, choices };
  }
  static int(name: string, min: number, max: number): FieldSpec {
    return { name, kind: "int", min, max };
  }
  static decimal(name: string, min: number, max: number): FieldSpec {
    return { name, kind: "decimal", min, max };
  }
  static bool(name: string): FieldSpec {
    return { name, kind: "bool" };
  }
  static date(name: string): FieldSpec {
    return { name, kind: "date" };
  }
  static future(name: string): FieldSpec {
    return { name, kind: "future" };
  }
  /** A labelled person is the row's identity, so it is never left absent. */
  static person(name: string, label = false): FieldSpec {
    return { name, kind: "person", label, required: label };
  }
  static email(name = "email"): FieldSpec {
    return { name, kind: "email" };
  }
  static url(name: string): FieldSpec {
    return { name, kind: "url" };
  }
  static tags(name = "tags", size = 4): FieldSpec {
    return { name, kind: "tags", size };
  }
  static object(name: string, fields: FieldSpec[]): FieldSpec {
    return { name, kind: "object", fields };
  }
  static objects(name: string, fields: FieldSpec[], size = 4): FieldSpec {
    return { name, kind: "objects", size, fields };
  }
  /** A field whose text is deliberately excluded from the search index. */
  static secret(name: string): FieldSpec {
    return { name, kind: "line", secret: true };
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Turns a field list into the JSON Schema document a collection is created with. */
class SchemaFactory {
  static build(blueprint: CollectionBlueprint): Record<string, unknown> {
    const schema: Record<string, unknown> = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: blueprint.title,
      type: "object",
      additionalProperties: false,
      ...SchemaFactory.shape(blueprint.fields),
      "x-silo-search": SchemaFactory.searchConfig(blueprint.fields),
    };
    // Absent rather than `false`, matching how the server writes the keyword.
    if (blueprint.auth) schema["x-silo-auth"] = true;
    return schema;
  }

  private static shape(fields: FieldSpec[]): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const field of fields) {
      properties[field.name] = SchemaFactory.node(field);
      if (field.required) required.push(field.name);
    }
    return required.length > 0 ? { properties, required } : { properties };
  }

  private static node(field: FieldSpec): Record<string, unknown> {
    switch (field.kind) {
      case "title":
        return { type: "string", minLength: 1, maxLength: 200 };
      case "slug":
        return { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 120 };
      case "line":
        return { type: "string", maxLength: 400 };
      case "body":
        return { type: "string" };
      case "choice":
        return { type: "string", enum: [...(field.choices ?? [])] };
      case "int":
        return { type: "integer", minimum: field.min ?? 0, maximum: field.max ?? 1000 };
      case "decimal":
        return { type: "number", minimum: field.min ?? 0, maximum: field.max ?? 1000 };
      case "bool":
        return { type: "boolean" };
      case "date":
      case "future":
        return { type: "string", format: "date-time" };
      case "person":
        return { type: "string", maxLength: 120 };
      case "email":
        return { type: "string", format: "email" };
      case "url":
        return { type: "string", format: "uri" };
      case "tags":
        return { type: "array", items: { type: "string" }, maxItems: field.size ?? 4 };
      case "object":
        return { type: "object", additionalProperties: false, ...SchemaFactory.shape(field.fields ?? []) };
      case "objects":
        return {
          type: "array",
          maxItems: field.size ?? 4,
          items: { type: "object", additionalProperties: false, ...SchemaFactory.shape(field.fields ?? []) },
        };
    }
  }

  /**
   * `x-silo-search` in D29 path terms: titles and names carry weight, and
   * anything marked secret is subtracted from the corpus. Every property in the
   * catalogue is a bare identifier, so no path segment here needs quoting.
   */
  private static searchConfig(fields: FieldSpec[]): Record<string, string[]> {
    const label: string[] = [];
    const exclude: string[] = [];
    SchemaFactory.collect(fields, "$.data", label, exclude);
    const config: Record<string, string[]> = {};
    if (label.length > 0) config.label = label;
    if (exclude.length > 0) config.exclude = exclude;
    return config;
  }

  private static collect(fields: FieldSpec[], prefix: string, label: string[], exclude: string[]): void {
    for (const field of fields) {
      const path = `${prefix}.${field.name}`;
      if (field.label) label.push(path);
      if (field.secret) exclude.push(path);
      if (field.kind === "object") SchemaFactory.collect(field.fields ?? [], path, label, exclude);
      if (field.kind === "objects") SchemaFactory.collect(field.fields ?? [], `${path}[*]`, label, exclude);
    }
  }
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** Generates one entry's data from the same field list the schema came from. */
class ValueFactory {
  private readonly lorem: Lorem;
  private readonly calendar: Calendar;

  constructor(private readonly rng: Rng, epoch: number) {
    this.lorem = new Lorem(rng);
    this.calendar = new Calendar(rng, epoch);
  }

  entry(fields: FieldSpec[]): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    // A person and the email beside it are correlated within one object, so an
    // author row reads as one human rather than two unrelated ones.
    let person: string | undefined;
    for (const field of fields) {
      // An optional field is sometimes absent — a table of uniformly full rows
      // never shows what an empty cell looks like.
      if (!field.required && this.rng.chance(0.15)) continue;
      const value = this.value(field, person);
      if (field.kind === "person") person = value as string;
      data[field.name] = value;
    }
    return data;
  }

  private value(field: FieldSpec, person?: string): unknown {
    switch (field.kind) {
      case "title":
        return this.lorem.title();
      case "slug":
        return this.lorem.slug(this.lorem.phrase());
      case "line":
        return this.lorem.sentence();
      case "body":
        return this.lorem.body(field.size ?? 3);
      case "choice":
        return this.rng.pick(field.choices ?? ["unset"]);
      case "int":
        return this.rng.int(field.min ?? 0, field.max ?? 1000);
      case "decimal":
        return this.rng.decimal(field.min ?? 0, field.max ?? 1000);
      case "bool":
        return this.rng.chance(0.5);
      case "date":
        return this.calendar.past();
      case "future":
        return this.calendar.future();
      case "person":
        return this.lorem.personName();
      case "email":
        return this.lorem.email(person);
      case "url":
        return this.lorem.url();
      case "tags":
        return this.lorem.tags(field.size ?? 4);
      case "object":
        return this.entry(field.fields ?? []);
      case "objects":
        return Array.from({ length: this.rng.int(1, field.size ?? 4) }, () =>
          this.entry(field.fields ?? []),
        );
    }
  }
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/** One collection's identity, access and field list. */
interface CollectionBlueprint {
  name: string;
  title: string;
  /** `x-silo-auth` — private data an anonymous caller must not read. */
  auth?: boolean;
  fields: FieldSpec[];
}

/**
 * The pool every scope draws its collections from. It is deliberately larger
 * than the per-scope maximum, so two environments of the same project hold
 * overlapping but different collections — which is what a scope switcher and a
 * cross-scope search have to be tested against.
 */
class CollectionCatalog {
  private static readonly Blueprints: CollectionBlueprint[] = [
    {
      name: "posts", title: "Blog posts",
      fields: [
        Fields.title(), Fields.slug(), Fields.line("summary", true), Fields.body("body", 4),
        Fields.choice("status", ["draft", "in_review", "published", "archived"]),
        Fields.object("author", [Fields.person("name", true), Fields.email()]),
        Fields.tags(), Fields.int("views", 0, 250_000), Fields.bool("featured"),
        Fields.date("published_at"),
      ],
    },
    {
      name: "authors", title: "Authors",
      fields: [
        Fields.person("name", true), Fields.slug(), Fields.email(), Fields.body("bio", 2),
        Fields.url("website"), Fields.line("headline"), Fields.date("joined_at"),
        Fields.bool("active"), Fields.tags("expertise", 3),
      ],
    },
    {
      name: "products", title: "Products",
      fields: [
        Fields.title(), Fields.slug(), Fields.body("description", 3),
        Fields.line("sku"), Fields.decimal("price", 4.99, 2499.99),
        Fields.choice("currency", ["EUR", "USD", "GBP", "INR"]),
        Fields.int("stock", 0, 5000), Fields.bool("discontinued"),
        Fields.tags("categories", 3), Fields.date("released_at"),
      ],
    },
    {
      name: "orders", title: "Orders", auth: true,
      fields: [
        Fields.name("reference"),
        Fields.object("customer", [Fields.person("name", true), Fields.email(), Fields.line("country")]),
        Fields.objects("items", [Fields.title("product"), Fields.int("quantity", 1, 12), Fields.decimal("unit_price", 1, 999)], 5),
        Fields.decimal("total", 10, 12_000),
        Fields.choice("status", ["pending", "paid", "shipped", "refunded", "cancelled"]),
        Fields.date("placed_at"), Fields.secret("payment_note"),
      ],
    },
    {
      name: "customers", title: "Customers", auth: true,
      fields: [
        Fields.person("name", true), Fields.email(), Fields.line("company", true),
        Fields.line("phone"), Fields.choice("segment", ["free", "starter", "growth", "enterprise"]),
        Fields.decimal("lifetime_value", 0, 480_000), Fields.date("signed_up_at"),
        Fields.bool("churned"), Fields.secret("internal_note"),
      ],
    },
    {
      name: "pages", title: "Marketing pages",
      fields: [
        Fields.title(), Fields.slug(), Fields.body("body", 5),
        Fields.object("seo", [Fields.line("meta_title", true), Fields.line("meta_description")]),
        Fields.bool("published"), Fields.int("nav_order", 0, 60), Fields.date("updated_on"),
      ],
    },
    {
      name: "docs", title: "Documentation",
      fields: [
        Fields.title(), Fields.slug(), Fields.body("body", 6),
        Fields.choice("section", ["getting-started", "guides", "reference", "operations"]),
        Fields.line("version"), Fields.bool("deprecated"), Fields.tags(), Fields.date("reviewed_at"),
      ],
    },
    {
      name: "faqs", title: "FAQ entries",
      fields: [
        Fields.title("question"), Fields.body("answer", 2),
        Fields.choice("category", ["billing", "accounts", "api", "privacy", "shipping"]),
        Fields.int("position", 1, 40), Fields.int("helpful_count", 0, 900), Fields.bool("published"),
      ],
    },
    {
      name: "events", title: "Events",
      fields: [
        Fields.name(), Fields.slug(), Fields.body("description", 3),
        Fields.object("venue", [Fields.line("name", true), Fields.line("city"), Fields.line("country")]),
        Fields.future("starts_at"), Fields.future("ends_at"), Fields.int("capacity", 20, 4000),
        Fields.bool("sold_out"), Fields.tags("topics", 3),
      ],
    },
    {
      name: "jobs", title: "Open roles",
      fields: [
        Fields.title(), Fields.slug(), Fields.body("description", 4),
        Fields.choice("department", ["engineering", "design", "sales", "support", "finance"]),
        Fields.line("location"), Fields.bool("remote"),
        Fields.choice("employment_type", ["full_time", "part_time", "contract", "internship"]),
        Fields.object("salary", [Fields.int("min", 30_000, 90_000), Fields.int("max", 90_001, 260_000), Fields.line("currency")]),
        Fields.date("posted_at"),
      ],
    },
    {
      name: "testimonials", title: "Testimonials",
      fields: [
        Fields.title("quote"), Fields.person("author", true), Fields.line("role"),
        Fields.line("company", true), Fields.int("rating", 1, 5), Fields.bool("approved"),
        Fields.date("collected_at"),
      ],
    },
    {
      name: "changelog", title: "Changelog",
      fields: [
        Fields.title(), Fields.line("version"), Fields.body("body", 3),
        Fields.choice("kind", ["feature", "fix", "breaking", "security", "chore"]),
        Fields.date("released_at"), Fields.tags("areas", 3), Fields.bool("highlighted"),
      ],
    },
    {
      name: "tickets", title: "Support tickets", auth: true,
      fields: [
        Fields.title(), Fields.body("description", 3),
        Fields.choice("priority", ["low", "normal", "high", "urgent"]),
        Fields.choice("status", ["open", "triaged", "blocked", "closed"]),
        Fields.person("assignee"), Fields.person("reporter"), Fields.tags("labels", 4),
        Fields.date("opened_at"), Fields.int("reopen_count", 0, 6),
      ],
    },
    {
      name: "campaigns", title: "Campaigns",
      fields: [
        Fields.name(), Fields.body("brief", 2),
        Fields.choice("channel", ["email", "search", "social", "events", "partner"]),
        Fields.decimal("budget", 500, 250_000), Fields.date("starts_on"), Fields.future("ends_on"),
        Fields.choice("status", ["planned", "running", "paused", "finished"]),
        Fields.decimal("conversion_rate", 0, 18),
      ],
    },
    {
      name: "feature_flags", title: "Feature flags",
      fields: [
        Fields.name("key"), Fields.line("description", true), Fields.bool("enabled"),
        Fields.int("rollout_percent", 0, 100), Fields.tags("environments", 3),
        Fields.person("owner"), Fields.date("created_on"),
      ],
    },
    {
      name: "webhooks", title: "Webhooks", auth: true,
      fields: [
        Fields.name(), Fields.url("endpoint"), Fields.tags("events", 4), Fields.bool("active"),
        Fields.secret("signing_secret"), Fields.int("failure_count", 0, 40), Fields.date("last_delivery_at"),
      ],
    },
    {
      name: "redirects", title: "Redirects",
      fields: [
        Fields.name("source"), Fields.line("target", true),
        Fields.choice("code", ["301", "302", "307", "308"]),
        Fields.int("hits", 0, 90_000), Fields.bool("enabled"), Fields.date("created_on"),
      ],
    },
    {
      name: "newsletters", title: "Newsletters",
      fields: [
        Fields.title("subject"), Fields.line("preheader", true), Fields.body("body", 5),
        Fields.date("sent_at"), Fields.int("recipients", 100, 400_000),
        Fields.decimal("open_rate", 0, 100), Fields.bool("archived"),
      ],
    },
    {
      name: "reviews", title: "Product reviews",
      fields: [
        Fields.title(), Fields.body("body", 2), Fields.int("rating", 1, 5),
        Fields.line("product_sku"), Fields.person("author", true), Fields.bool("verified"),
        Fields.date("posted_at"), Fields.int("upvotes", 0, 1200),
      ],
    },
    {
      name: "locations", title: "Locations",
      fields: [
        Fields.name(), Fields.line("street"), Fields.line("city", true), Fields.line("country"),
        Fields.decimal("latitude", -89, 89), Fields.decimal("longitude", -179, 179),
        Fields.line("phone"), Fields.bool("open_to_public"), Fields.date("opened_on"),
      ],
    },
    {
      name: "partners", title: "Partners",
      fields: [
        Fields.name(), Fields.url("website"), Fields.body("description", 2),
        Fields.choice("tier", ["bronze", "silver", "gold", "strategic"]),
        Fields.date("partner_since"), Fields.person("contact"), Fields.email("contact_email"),
      ],
    },
    {
      name: "courses", title: "Courses",
      fields: [
        Fields.title(), Fields.slug(), Fields.body("summary", 3),
        Fields.choice("level", ["beginner", "intermediate", "advanced"]),
        Fields.int("duration_minutes", 15, 900),
        Fields.objects("lessons", [Fields.title(), Fields.int("minutes", 3, 90)], 6),
        Fields.bool("published"), Fields.date("updated_on"),
      ],
    },
    {
      name: "snippets", title: "Code snippets",
      fields: [
        Fields.title(), Fields.body("code", 2), Fields.line("description", true),
        Fields.choice("language", ["typescript", "python", "go", "rust", "sql", "bash"]),
        Fields.tags(), Fields.int("copies", 0, 5000), Fields.date("added_on"),
      ],
    },
    {
      name: "releases", title: "Releases",
      fields: [
        Fields.name("tag"), Fields.title(), Fields.body("notes", 4),
        Fields.choice("channel", ["stable", "beta", "nightly"]),
        Fields.bool("prerelease"), Fields.int("downloads", 0, 120_000), Fields.date("published_at"),
      ],
    },
  ];

  static count(): number {
    return CollectionCatalog.Blueprints.length;
  }

  /** `n` distinct blueprints, chosen by the scope's own RNG. */
  static sample(rng: Rng, n: number): CollectionBlueprint[] {
    return rng.sample(CollectionCatalog.Blueprints, n);
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/** An API error carrying what the server actually said, not just a status. */
class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly path: string) {
    super(`${status} ${code} on ${path}: ${message}`);
    this.name = "ApiError";
  }
}

/**
 * The thinnest client the seeder needs: `POST` and `GET` against `/api`, with
 * the silo error envelope decoded. Retries cover a connection refused mid-run
 * and a `5xx`; a `4xx` is a defect in the generated payload and stops the run
 * immediately, because the alternative is thousands of silently skipped entries
 * and a summary that claims success.
 */
class SiloClient {
  private static readonly Retries = 3;

  constructor(private readonly baseUrl: string, private readonly key: string) {}

  async get<T>(path: string): Promise<T> {
    return this.send<T>("GET", path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>("POST", path, body);
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= SiloClient.Retries; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });

        if (res.ok) {
          const text = await res.text();
          return (text ? JSON.parse(text) : undefined) as T;
        }

        const error = await SiloClient.decodeError(res, path);
        if (res.status < 500) throw error;
        lastError = error;
      } catch (err) {
        if (err instanceof ApiError && err.status < 500) throw err;
        lastError = err;
      }
      await Bun.sleep(200 * attempt);
    }
    throw lastError;
  }

  private static async decodeError(res: Response, path: string): Promise<ApiError> {
    const text = await res.text().catch(() => "");
    try {
      const envelope = JSON.parse(text) as { error?: { code?: string; message?: string; details?: unknown[] } };
      const detail = envelope.error?.details?.length ? ` (${JSON.stringify(envelope.error.details)})` : "";
      return new ApiError(
        res.status,
        envelope.error?.code ?? "unknown",
        `${envelope.error?.message ?? text}${detail}`,
        path,
      );
    } catch {
      return new ApiError(res.status, "unknown", text || res.statusText, path);
    }
  }
}

/**
 * Runs `worker` over `items`, `size` at a time. The server serializes writes
 * behind one mutex, so this buys the round trips back rather than parallel
 * writes — which on a local instance is most of the wall clock.
 */
class TaskPool {
  static async run<T>(items: readonly T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0;
    const lanes = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++] as T;
        await worker(item);
      }
    });
    await Promise.all(lanes);
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** An inclusive `min`–`max` pair, parsed from `"5-20"` or a bare `"12"`. */
interface Range {
  min: number;
  max: number;
}

interface SeedOptions {
  url: string;
  key: string;
  projects: number;
  envs: string[];
  collections: Range;
  entries: Range;
  seed: number;
  /** Milliseconds the generated dates are measured from. */
  epoch: number;
  concurrency: number;
  dryRun: boolean;
  confirmed: boolean;
}

class OptionsParser {
  private static readonly Usage = `silo data seeder — fill an instance with a large, realistic corpus

Usage:
  bun run scripts/seed.ts [flags]

Flags:
  --url u            base URL of the silo server (default $SILO_URL or http://localhost:8090)
  --key k            API key (default $SILO_KEY); needs create claims on every scope it writes
  --projects n       how many projects to seed (default 2)
  --envs a,b,c       environments per project (default dev,uat,prod)
  --collections a-b  collections per environment (default 5-20)
  --entries a-b      entries per collection (default 20-100)
  --seed n           PRNG seed (default 1)
  --epoch t          instant the generated dates are measured from, ISO or ms
                     (default: now — pass the epoch a run prints to reproduce it)
  --concurrency n    entry writes in flight (default 8)
  --dry-run          print the plan and write nothing
  --yes              required to write to a non-localhost URL
  --help

The same --seed and --epoch produce the same entries; the order they are
written in still depends on --concurrency, so ids and silo's own timestamps are
assigned in whatever order the writes land.

Writes are additive — projects, environments and schemas are upserts, and
entries are appended. Nothing is ever deleted.`;

  static parse(argv: string[]): SeedOptions | null {
    const { values } = parseArgs({
      args: argv,
      options: {
        url: { type: "string" },
        key: { type: "string" },
        projects: { type: "string" },
        envs: { type: "string" },
        collections: { type: "string" },
        entries: { type: "string" },
        seed: { type: "string" },
        epoch: { type: "string" },
        concurrency: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        yes: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });

    if (values.help) {
      console.log(OptionsParser.Usage);
      return null;
    }

    return {
      url: (values.url ?? process.env.SILO_URL ?? "http://localhost:8090").replace(/\/+$/, ""),
      key: values.key ?? process.env.SILO_KEY ?? "",
      projects: OptionsParser.count(values.projects, "projects", 2, 1, 64),
      envs: OptionsParser.envs(values.envs),
      collections: OptionsParser.range(values.collections, "collections", { min: 5, max: 20 }),
      entries: OptionsParser.range(values.entries, "entries", { min: 20, max: 100 }),
      seed: OptionsParser.count(values.seed, "seed", 1, 0, 2 ** 31),
      epoch: OptionsParser.epoch(values.epoch),
      concurrency: OptionsParser.count(values.concurrency, "concurrency", 8, 1, 64),
      dryRun: values["dry-run"] === true,
      confirmed: values.yes === true,
    };
  }

  private static count(raw: string | undefined, flag: string, fallback: number, min: number, max: number): number {
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new Error(`--${flag} must be an integer between ${min} and ${max}, got "${raw}"`);
    }
    return n;
  }

  /** An ISO instant or epoch milliseconds; absent means now. */
  private static epoch(raw: string | undefined): number {
    if (raw === undefined) return Date.now();
    const ms = /^\d+$/.test(raw.trim()) ? Number(raw) : Date.parse(raw);
    if (!Number.isFinite(ms)) throw new Error(`--epoch must be an ISO instant or epoch milliseconds, got "${raw}"`);
    return ms;
  }

  private static range(raw: string | undefined, flag: string, fallback: Range): Range {
    if (raw === undefined) return fallback;
    const match = /^(\d+)(?:-(\d+))?$/.exec(raw.trim());
    if (!match) throw new Error(`--${flag} must look like "20-100" or "50", got "${raw}"`);
    const min = Number(match[1]);
    const max = match[2] === undefined ? min : Number(match[2]);
    if (max < min) throw new Error(`--${flag} range is inverted: "${raw}"`);
    return { min, max };
  }

  /** Ids the server would reject are caught here, not 40 requests into a run. */
  private static envs(raw: string | undefined): string[] {
    const ids = (raw ?? "dev,uat,prod").split(",").map((e) => e.trim()).filter(Boolean);
    if (ids.length === 0) throw new Error("--envs needs at least one environment id");
    for (const id of ids) {
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) {
        throw new Error(`invalid env id "${id}": want lowercase letter first, then [a-z0-9_-], max 64 chars`);
      }
    }
    return ids;
  }
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

interface CollectionPlan {
  blueprint: CollectionBlueprint;
  entries: number;
}

interface ScopePlan {
  project: string;
  env: string;
  collections: CollectionPlan[];
}

/** Derives a stream's seed from the master seed and what the stream is for. */
class Seeds {
  static of(base: number, key: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash ^ base) >>> 0;
  }
}

/**
 * Works out the whole shape of the corpus before a single request is sent, so
 * `--dry-run` can show exactly what a real run would write. Each scope draws
 * from its own RNG stream rather than a shared one: a scope's contents then
 * depend on its name and the seed, and not on the order scopes happen to be
 * visited in.
 */
class PlanBuilder {
  private static readonly ProjectNames = [
    "acme", "northwind", "globex", "initech", "umbrella", "hooli", "soylent", "vandelay",
  ] as const;

  static build(options: SeedOptions): ScopePlan[] {
    const plan: ScopePlan[] = [];
    for (const project of PlanBuilder.projects(options.projects)) {
      for (const env of options.envs) {
        const rng = new Rng(Seeds.of(options.seed, `${project}/${env}`));
        const wanted = Math.min(
          rng.int(options.collections.min, options.collections.max),
          CollectionCatalog.count(),
        );
        plan.push({
          project,
          env,
          collections: CollectionCatalog.sample(rng, wanted).map((blueprint) => ({
            blueprint,
            entries: rng.int(options.entries.min, options.entries.max),
          })),
        });
      }
    }
    return plan;
  }

  private static projects(count: number): string[] {
    return Array.from({ length: count }, (_, i) => PlanBuilder.ProjectNames[i] ?? `project-${i + 1}`);
  }

  static totals(plan: ScopePlan[]): { projects: number; envs: number; collections: number; entries: number } {
    const projects = new Set(plan.map((s) => s.project));
    let collections = 0;
    let entries = 0;
    for (const scope of plan) {
      collections += scope.collections.length;
      for (const col of scope.collections) entries += col.entries;
    }
    return { projects: projects.size, envs: plan.length, collections, entries };
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

class Reporter {
  private started = 0;

  static number(n: number): string {
    return n.toLocaleString("en-US");
  }

  static duration(ms: number): string {
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  header(options: SeedOptions, plan: ScopePlan[]): void {
    const t = PlanBuilder.totals(plan);
    console.log(`\nsilo seeder → ${options.url}`);
    console.log(
      `plan: ${t.projects} project(s) × ${options.envs.length} env(s) — ` +
        `${options.collections.min}–${options.collections.max} collections each, ` +
        `${options.entries.min}–${options.entries.max} entries each`,
    );
    console.log(`reproduce: --seed ${options.seed} --epoch ${options.epoch}`);
    console.log(
      `total: ${Reporter.number(t.collections)} collections, ${Reporter.number(t.entries)} entries\n`,
    );
    for (const scope of plan) {
      const entries = scope.collections.reduce((sum, c) => sum + c.entries, 0);
      console.log(
        `  ${`${scope.project}/${scope.env}`.padEnd(24)}` +
          `${String(scope.collections.length).padStart(3)} collections` +
          `${Reporter.number(entries).padStart(8)} entries`,
      );
    }
    console.log("");
  }

  begin(): void {
    this.started = performance.now();
  }

  collection(scope: ScopePlan, plan: CollectionPlan, done: number, total: number): void {
    const pct = Math.round((done / total) * 100);
    console.log(
      `  [${String(pct).padStart(3)}%] ${`${scope.project}/${scope.env}`.padEnd(24)}` +
        `${plan.blueprint.name.padEnd(16)}${Reporter.number(plan.entries).padStart(6)} entries`,
    );
  }

  done(plan: ScopePlan[]): void {
    const t = PlanBuilder.totals(plan);
    const elapsed = performance.now() - this.started;
    const rate = t.entries / Math.max(elapsed / 1000, 0.001);
    console.log(
      `\ndone: ${t.projects} projects, ${t.envs} environments, ` +
        `${Reporter.number(t.collections)} collections, ${Reporter.number(t.entries)} entries ` +
        `in ${Reporter.duration(elapsed)} (${Math.round(rate)} entries/s)\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/** Walks the plan and writes it, scope by scope and collection by collection. */
class Seeder {
  private readonly seenProjects = new Set<string>();

  constructor(
    private readonly client: SiloClient,
    private readonly options: SeedOptions,
    private readonly reporter: Reporter,
  ) {}

  /**
   * Fails fast on the first preflight problem rather than on request 300 of a
   * long run: an unreachable server and a rejected key both look like "nothing
   * happened" once thousands of writes are already in flight.
   */
  async preflight(): Promise<void> {
    const health = await this.client
      .get<{ status: string; version: string }>("/api/health")
      .catch((err) => {
        throw new Error(`cannot reach ${this.options.url}: ${err instanceof Error ? err.message : err}\n` +
          `start one with: bun run server/main.ts serve`);
      });

    let session: { label: string; claims: string[] };
    try {
      session = await this.client.get<{ label: string; claims: string[] }>("/api/session");
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        throw new Error(
          this.options.key
            ? "the API key was rejected — check --key / $SILO_KEY"
            : "no API key given: pass --key or set $SILO_KEY\n" +
              "mint one with: bun run server/main.ts keys create --preset root --label seeder",
        );
      }
      throw err;
    }

    console.log(
      `server ${health.version}, key "${session.label}" ` +
        `(${session.claims.length} claim${session.claims.length === 1 ? "" : "s"})`,
    );
  }

  async run(plan: ScopePlan[]): Promise<void> {
    const total = plan.reduce((sum, scope) => sum + scope.collections.length, 0);
    let done = 0;

    this.reporter.begin();
    for (const scope of plan) {
      await this.ensureProject(scope.project);
      await this.ensureEnvironment(scope.project, scope.env);
      for (const collection of scope.collections) {
        await this.ensureCollection(scope, collection.blueprint);
        await this.fill(scope, collection);
        this.reporter.collection(scope, collection, ++done, total);
      }
    }
  }

  private async ensureProject(project: string): Promise<void> {
    if (this.seenProjects.has(project)) return;
    await this.client.post("/api/projects", { id: project });
    this.seenProjects.add(project);
  }

  private async ensureEnvironment(project: string, env: string): Promise<void> {
    await this.client.post(`/api/projects/${project}/envs`, { id: env });
  }

  private async ensureCollection(scope: ScopePlan, blueprint: CollectionBlueprint): Promise<void> {
    await this.client.post(`/api/projects/${scope.project}/envs/${scope.env}/collections`, {
      name: blueprint.name,
      schema: SchemaFactory.build(blueprint),
    });
  }

  /**
   * Payloads are generated up front, in order, from one collection-scoped RNG;
   * only the writes are concurrent. Generating inside the workers would make
   * the corpus depend on how the lanes interleaved, and `--seed` would stop
   * meaning anything.
   */
  private async fill(scope: ScopePlan, plan: CollectionPlan): Promise<void> {
    const rng = new Rng(Seeds.of(this.options.seed, `${scope.project}/${scope.env}/${plan.blueprint.name}`));
    const factory = new ValueFactory(rng, this.options.epoch);
    const payloads = Array.from({ length: plan.entries }, () => factory.entry(plan.blueprint.fields));

    const path = `/api/projects/${scope.project}/envs/${scope.env}/collections/${plan.blueprint.name}`;
    await TaskPool.run(payloads, this.options.concurrency, async (payload) => {
      await this.client.post(path, payload);
    });
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

class Main {
  static async run(): Promise<number> {
    let options: SeedOptions | null;
    try {
      options = OptionsParser.parse(Bun.argv.slice(2));
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : err}`);
      return 2;
    }
    if (!options) return 0;

    const plan = PlanBuilder.build(options);
    const reporter = new Reporter();
    reporter.header(options, plan);

    if (options.dryRun) {
      console.log("dry run — nothing was written.\n");
      return 0;
    }
    if (!Main.isLocal(options.url) && !options.confirmed) {
      console.error(
        `refusing to write ${Reporter.number(PlanBuilder.totals(plan).entries)} entries to a remote ` +
          `instance (${options.url}) without --yes.`,
      );
      return 2;
    }

    const seeder = new Seeder(new SiloClient(options.url, options.key), options, reporter);
    try {
      await seeder.preflight();
      await seeder.run(plan);
    } catch (err) {
      console.error(`\nerror: ${err instanceof Error ? err.message : err}`);
      return 1;
    }
    reporter.done(plan);
    return 0;
  }

  private static isLocal(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
    } catch {
      return false;
    }
  }
}

process.exit(await Main.run());
