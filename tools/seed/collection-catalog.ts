import type { CollectionBlueprint } from "./collection-blueprint";
import { Fields } from "./fields";
import { Rng } from "./rng";

/**
 * The pool every scope draws its collections from. It is deliberately larger
 * than the per-scope maximum, so two environments of the same project hold
 * overlapping but different collections — which is what a scope switcher and a
 * cross-scope search have to be tested against.
 */
export class CollectionCatalog {
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
