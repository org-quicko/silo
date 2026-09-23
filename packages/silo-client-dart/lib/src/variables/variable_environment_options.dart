import '../request_options.dart';

/// [environment] picks whose value comes back. Unset, the server assumes
/// `prod`, which is a 404 in a project without one.
final class VariableEnvironmentOptions extends RequestOptions {
  const VariableEnvironmentOptions({this.environment, super.timeout, super.cancellation});

  final String? environment;
}
