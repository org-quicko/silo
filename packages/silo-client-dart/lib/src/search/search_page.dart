import '../pagination/page.dart';
import '../pagination/page_window.dart';
import 'search_engine.dart';
import 'search_hit.dart';

final class SearchPage extends Page<SearchHit> {
  SearchPage(this.hits, int total, PageWindow window, bool truncated, this.engine, this._loader)
    : super(hits, total, window, truncated: truncated);

  final List<SearchHit> hits;
  final SearchEngine engine;
  final Future<SearchPage> Function(PageWindow window) _loader;

  Future<SearchPage?> next() async {
    final window = windowForNext();
    return window == null ? null : _loader(window);
  }

  Future<SearchPage?> previous() async {
    final window = windowForPrevious();
    return window == null ? null : _loader(window);
  }
}
