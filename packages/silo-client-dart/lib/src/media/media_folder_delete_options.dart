import '../request_options.dart';

/// [recursive] takes the folder's contents with it; [force] only matters with it.
final class MediaFolderDeleteOptions extends RequestOptions {
  const MediaFolderDeleteOptions({this.recursive = false, this.force = false, super.timeout, super.cancellation});

  final bool recursive;
  final bool force;
}
