import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

/// The multipart file an upload and a replace both send.
abstract final class MediaParts {
  static http.MultipartFile file(List<int> bytes, String filename, String? contentType) {
    if (filename.trim().isEmpty) {
      throw ArgumentError.value(filename, 'filename', 'the server reads the extension off it');
    }
    return http.MultipartFile.fromBytes(
      'file',
      bytes,
      filename: filename,
      contentType: contentType == null ? null : MediaType.parse(contentType),
    );
  }
}
