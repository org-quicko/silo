import { Rng } from "./rng";
import { WordBank } from "./word-bank";

/** Assembles the word bank into titles, sentences, names and slugs. */
export class Lorem {
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
