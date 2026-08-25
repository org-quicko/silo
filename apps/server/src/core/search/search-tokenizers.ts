/**
 * Maps silo's two tokenizer names onto the FTS5 spellings they stand for.
 *
 * The config takes short names because `unicode61 remove_diacritics 2` is an
 * implementation detail nobody should have to type — and because pinning the
 * options here means a change to them is a one-line edit that the version
 * stamp then rebuilds the index for, rather than a setting every deployment
 * has spelled slightly differently.
 */
export class SearchTokenizers {
  static readonly Unicode61 = "unicode61 remove_diacritics 2";
  static readonly Trigram = "trigram";

  static sqlite(name: "unicode61" | "trigram"): string {
    return name === "trigram" ? SearchTokenizers.Trigram : SearchTokenizers.Unicode61;
  }
}
