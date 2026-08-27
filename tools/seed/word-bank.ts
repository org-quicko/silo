/** The fixed vocabulary every generated string is assembled from. */
export class WordBank {
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
