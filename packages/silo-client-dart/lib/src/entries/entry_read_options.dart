import '../request_options.dart';
import 'variable_resolution.dart';

/// Reads resolve by default. [EntryReadOptions.raw] answers the stored
/// templates, which is what an editor must read.
final class EntryReadOptions extends RequestOptions {
  const EntryReadOptions({this.variables = VariableResolution.resolved, super.timeout, super.cancellation});

  const EntryReadOptions.raw({super.timeout, super.cancellation}) : variables = VariableResolution.raw;

  final VariableResolution variables;
}
