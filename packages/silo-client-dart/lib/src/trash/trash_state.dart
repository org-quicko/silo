/// How far a receipt's trash, restore or purge got. Anything but [parked] is
/// still in progress.
enum TrashState {
  parking,
  parked,
  restoring,
  purging;

  static TrashState of(Object? value) => values.firstWhere(
    (state) => state.name == value,
    orElse: () => throw FormatException('unknown trash state', value),
  );
}
