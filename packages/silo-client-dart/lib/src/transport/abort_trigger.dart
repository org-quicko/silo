import 'dart:async';

import '../cancellation_signal.dart';

enum AbortReason { caller, timeout }

/// A caller's signal and a deadline composed into one trigger that remembers
/// which fired. [dispose] once the request settles.
final class AbortTrigger {
  AbortTrigger(CancellationSignal? cancellation, Duration? timeout) {
    if (timeout != null) _timer = Timer(timeout, () => _fire(AbortReason.timeout));
    _unregister = cancellation?.onCancel(() => _fire(AbortReason.caller));
  }

  final Completer<void> _fired = Completer<void>();
  Timer? _timer;
  void Function()? _unregister;
  AbortReason? _firedBy;

  Future<void> get fired => _fired.future;

  AbortReason? get firedBy => _firedBy;

  void dispose() {
    _timer?.cancel();
    _unregister?.call();
  }

  void _fire(AbortReason reason) {
    if (_firedBy != null) return;
    _firedBy = reason;
    _fired.complete();
  }
}
