import 'silo_exception.dart';

/// A `500`: the asset was staged for deletion and the blob store kept its bytes.
final class MediaDeleteStalledException extends SiloException {
  const MediaDeleteStalledException(String message, String method, String path, this.remedy)
    : super(500, 'media_delete_stalled', message, method, path);

  factory MediaDeleteStalledException.fromWire(String message, String method, String path, Object? details) =>
      MediaDeleteStalledException(message, method, path, switch (details) {
        {'remedy': final String remedy} => remedy,
        _ => '',
      });

  final String remedy;
}
