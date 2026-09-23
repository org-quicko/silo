import 'dart:convert';

import 'package:http/http.dart' as http;

import '../errors/invalid_response_exception.dart';
import 'transport_request.dart';

/// A successful body as JSON text, or null for `204` and an empty body. A
/// route that promises JSON and answers anything else is refused.
abstract final class ResponseDecoder {
  static String? jsonText(http.Response response, TransportRequest request) {
    if (response.statusCode == 204 || response.bodyBytes.isEmpty) return null;
    final contentType = response.headers['content-type'] ?? '';
    if (!contentType.contains('application/json')) {
      throw InvalidResponseException(request.method, request.path, contentType);
    }
    return utf8.decode(response.bodyBytes);
  }
}
