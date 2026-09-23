/// New bytes for an existing asset. [filename] must keep the current extension.
final class MediaReplace {
  const MediaReplace({required this.bytes, required this.filename, this.contentType});

  final List<int> bytes;
  final String filename;
  final String? contentType;
}
