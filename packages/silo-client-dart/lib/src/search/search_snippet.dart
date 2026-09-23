/// Where a match was found: the fragment is `before + match + after`.
final class SearchSnippet {
  const SearchSnippet(this.path, this.before, this.match, this.after);

  factory SearchSnippet.fromJson(Map<String, Object?> json) =>
      SearchSnippet(json['path'] as String, json['before'] as String, json['match'] as String, json['after'] as String);

  final String path;
  final String before;
  final String match;
  final String after;
}
