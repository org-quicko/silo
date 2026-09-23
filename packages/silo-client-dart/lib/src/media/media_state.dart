enum MediaState {
  active,
  deleting;

  static MediaState of(Object? value) => value == 'deleting' ? deleting : active;
}
