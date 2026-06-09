import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'order_repository.dart';

class OrderService {
  final OrderRepository _repository;

  OrderService(this._repository);

  Future<List<Map<String, dynamic>>> getOrders() {
    return _repository.fetchOrders();
  }

  Future<Map<String, dynamic>> createOrder(Map<String, dynamic> data) {
    return _repository.saveOrder(data);
  }
}
