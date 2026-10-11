import '../pagination/page.dart';
import '../pagination/page_window.dart';
import 'entry.dart';

/// One page of entries, navigated by the window the server answered.
final class EntryPage<F> extends Page<Entry<F>> {
  EntryPage(this.entries, int total, PageWindow window, this._loader) : super(entries, total, window);

  final List<Entry<F>> entries;
  final Future<EntryPage<F>> Function(PageWindow window) _loader;

  Future<EntryPage<F>?> next() async {
    final window = windowForNext();
    return window == null ? null : _loader(window);
  }

  Future<EntryPage<F>?> previous() async {
    final window = windowForPrevious();
    return window == null ? null : _loader(window);
  }
}
