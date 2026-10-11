import '../pagination/page_window.dart';
import '../request_options.dart';
import '../transport/page_payload.dart';
import '../transport/transport.dart';
import '../transport/transport_request.dart';
import 'search_engine.dart';
import 'search_hit.dart';
import 'search_page.dart';
import 'search_query.dart';
import 'search_reach.dart';

/// Search bound to one reach.
final class Search {
  const Search(this._transport, this._reach);

  final Transport _transport;
  final SearchReach _reach;

  Future<SearchPage> run(SearchQuery query, RequestOptions options) async {
    final body = await _transport.json(
      TransportRequest(
        'GET',
        _reach.path,
        query: {
          'q': ?query.text,
          'filter': ?query.where?.toJson(),
          'sort': ?query.sort,
          'limit': ?query.limit,
          'offset': ?query.offset,
        },
        options: options,
      ),
    );

    final payload = PagePayload.read(body);
    return SearchPage(
      payload.rows.map(SearchHit.fromJson).toList(),
      payload.total,
      PageWindow(payload.limit ?? query.limit ?? 50, payload.offset ?? query.offset ?? 0),
      body['truncated'] == true,
      SearchEngine.of(body['engine']),
      (window) => run(query.copyWith(limit: window.limit, offset: window.offset), options),
    );
  }
}
