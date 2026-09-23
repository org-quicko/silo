import '../request_options.dart';

/// [environment] is where the initial [value] lands.
final class DeclareVariableOptions extends RequestOptions {
  const DeclareVariableOptions({this.description, this.environment, this.value, super.timeout, super.cancellation});

  final String? description;
  final String? environment;
  final String? value;
}
