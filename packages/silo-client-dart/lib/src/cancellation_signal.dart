/// Cancels every request holding it, now and later. One-way and idempotent.
final class CancellationSignal {
  final Set<void Function()> _listeners = {};
  bool _cancelled = false;

  bool get isCancelled => _cancelled;

  void cancel() {
    if (_cancelled) return;
    _cancelled = true;
    for (final listener in [..._listeners]) {
      listener();
    }
    _listeners.clear();
  }

  /// Runs [action] on [cancel], or now if already cancelled. The returned
  /// function unregisters it.
  void Function() onCancel(void Function() action) {
    if (_cancelled) {
      action();
      return () {};
    }
    _listeners.add(action);
    return () => _listeners.remove(action);
  }
}
