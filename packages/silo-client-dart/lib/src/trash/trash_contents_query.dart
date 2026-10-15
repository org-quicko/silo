/// What `Trash.contents` accepts. Unset, the server picks the window.
final class TrashContentsQuery {
  const TrashContentsQuery({this.limit, this.offset});

  final int? limit;
  final int? offset;
}
