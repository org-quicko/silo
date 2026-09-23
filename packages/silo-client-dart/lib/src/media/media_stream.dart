import '../pagination/row_stream.dart';
import 'media_asset.dart';

/// What `Media.all` answers: assets one at a time, across every page.
final class MediaStream extends RowStream<MediaAsset> {
  MediaStream(super.loader, super.startingLimit, super.options);
}
