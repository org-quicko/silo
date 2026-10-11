/// One file on its way into the library. The server reads the extension off
/// [filename]. [folder] unset means the library root.
final class MediaUpload {
  const MediaUpload({required this.bytes, required this.filename, this.contentType, this.folder});

  final List<int> bytes;
  final String filename;
  final String? contentType;
  final String? folder;
}
