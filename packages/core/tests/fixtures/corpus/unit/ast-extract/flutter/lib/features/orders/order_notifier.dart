import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/mixins/logger_mixin.dart';
import 'order_service.dart';

class OrderNotifier extends StateNotifier<AsyncValue<List<Map<String, dynamic>>>> with LoggerMixin {
  final OrderService _service;

  OrderNotifier(this._service) : super(const AsyncValue.loading());

  Future<void> loadOrders() async {
    log('Loading orders');
    state = const AsyncValue.loading();
    try {
      final orders = await _service.getOrders();
      state = AsyncValue.data(orders);
    } catch (e, st) {
      logError('Failed to load orders', e);
      state = AsyncValue.error(e, st);
    }
  }
}
