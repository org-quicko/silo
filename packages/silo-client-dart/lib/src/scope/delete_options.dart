import '../request_options.dart';

/// [force] overrides the server's "not empty" or "still referenced" refusal.
final class DeleteOptions extends RequestOptions {
  const DeleteOptions({this.force = false, super.timeout, super.cancellation});

  final bool force;
}
