mixin LoggerMixin {
  void log(String message) {
    print('[LOG] $message');
  }

  void logError(String message, [Object? error]) {
    print('[ERROR] $message ${error ?? ''}');
  }
}
