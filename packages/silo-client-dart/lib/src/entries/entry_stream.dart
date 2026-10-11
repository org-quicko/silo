import '../pagination/row_stream.dart';
import 'entry.dart';

/// What `all()` answers: entries one at a time, across every page.
final class EntryStream<F> extends RowStream<Entry<F>> {
  EntryStream(super.loader, super.startingLimit, super.options);
}
