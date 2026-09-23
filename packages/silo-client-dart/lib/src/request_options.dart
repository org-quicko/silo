import 'cancellation_signal.dart';

/// The deadline and cancellation every call accepts last.
class RequestOptions {
  const RequestOptions({this.timeout, this.cancellation});

  /// Wins over `SiloOptions.timeout`.
  final Duration? timeout;
  final CancellationSignal? cancellation;
}
