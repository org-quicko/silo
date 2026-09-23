import '../transport/transport.dart';

/// The transport and names every handle inside one environment shares.
final class ScopeReference {
  const ScopeReference(this.transport, this.project, this.environment);

  final Transport transport;
  final String project;
  final String environment;
}
