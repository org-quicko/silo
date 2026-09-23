import 'dart:convert';

/// The `?a=1&b=2` suffix, or `''`. A map or list value (the filter AST) is
/// sent as JSON.
abstract final class QueryString {
  static String build(Map<String, Object?> query) {
    final parts = [
      for (final MapEntry(:key, :value) in query.entries)
        if (value != null) '${Uri.encodeComponent(key)}=${Uri.encodeComponent(_render(value))}',
    ];
    return parts.isEmpty ? '' : '?${parts.join('&')}';
  }

  static String _render(Object value) => value is Map || value is List ? jsonEncode(value) : '$value';
}
