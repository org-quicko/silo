import '../collections/fields_converter.dart';
import '../entries/entry.dart';
import '../entries/entry_mapper.dart';
import '../transport/json_values.dart';
import 'search_snippet.dart';

/// One result, with its location. The entry's templates are resolved, so read
/// it again raw before editing.
final class SearchHit {
  const SearchHit(this.project, this.environment, this.collection, this.entry, this.snippets);

  factory SearchHit.fromJson(Map<String, Object?> json) => SearchHit(
    json['project'] as String,
    json['env'] as String,
    json['collection'] as String,
    EntryMapper.read(json['entry'] as Map<String, Object?>, FieldsConverter.map),
    JsonValues.objects(json['snippets']).map(SearchSnippet.fromJson).toList(),
  );

  final String project;
  final String environment;
  final String collection;
  final Entry<Map<String, Object?>> entry;
  final List<SearchSnippet> snippets;
}
