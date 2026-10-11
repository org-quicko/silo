/// Whether a read answers `{{NAME}}` templates resolved or as stored.
enum VariableResolution {
  resolved(null),
  raw('raw');

  const VariableResolution(this.wireValue);

  final String? wireValue;
}
