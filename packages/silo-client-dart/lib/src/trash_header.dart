/// The header a delete carries its trash receipt's id in (D113), and the
/// reader for it.
///
/// Absent when the delete was permanent or the instance has the trash off, so
/// a miss reads as "not recoverable", never as an error.
abstract final class TrashHeader {
  static const name = 'X-Silo-Trash-Id';

  /// Case-insensitive, since HTTP header names are.
  static String? read(Map<String, String> headers) {
    final wanted = name.toLowerCase();
    for (final MapEntry(:key, :value) in headers.entries) {
      if (key.toLowerCase() == wanted && value.isNotEmpty) return value;
    }
    return null;
  }
}
