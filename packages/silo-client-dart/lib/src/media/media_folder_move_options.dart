import '../request_options.dart';

/// [merge] joins an existing destination instead of refusing.
final class MediaFolderMoveOptions extends RequestOptions {
  const MediaFolderMoveOptions({this.merge = false, super.timeout, super.cancellation});

  final bool merge;
}
