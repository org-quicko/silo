import { Calendar } from "./calendar";
import type { FieldSpec } from "./field-spec";
import { Lorem } from "./lorem";
import { Rng } from "./rng";

/** Generates one entry's data from the same field list the schema came from. */
export class ValueFactory {
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
