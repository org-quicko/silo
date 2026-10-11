import 'package:http/http.dart' as http;

import 'cache/cache_options.dart';

/// Everything `Silo` accepts. Only [url] is required: anonymous reads are legal.
final class SiloOptions {
  const SiloOptions({
    required this.url,
    this.key,
    this.timeout,
    this.headers = const {},
    this.httpClient,
    this.cache = const CacheOptions.off(),
  });

  final String url;
  final String? key;
  final Duration? timeout;
  final Map<String, String> headers;

  /// Your own client. `Silo.close` leaves it open.
  final http.Client? httpClient;
  final CacheOptions cache;
}
