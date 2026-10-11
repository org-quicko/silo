import '../collections/fields_converter.dart';
import '../transport/timestamps.dart';
import 'entry.dart';

/// Splits the wire's flat row into the envelope and the fields. Every other
/// key is copied untouched.
abstract final class EntryMapper {
  static const _envelope = {'id', 'rev', 'created_at', 'updated_at'};

  static Entry<F> read<F>(Map<String, Object?> row, FieldsConverter<F> converter) => Entry(
    id: row['id'] as String,
    rev: row['rev'] as int,
    createdAt: Timestamps.parse(row['created_at']),
    updatedAt: Timestamps.parse(row['updated_at']),
    fields: converter.fromJson({
      for (final MapEntry(:key, :value) in row.entries)
        if (!_envelope.contains(key)) key: value,
    }),
  );
}
