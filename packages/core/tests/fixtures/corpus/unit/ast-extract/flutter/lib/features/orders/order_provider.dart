import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'order_service.dart';
import 'order_repository.dart';
import '../../core/network/api_client.dart';

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient());
final orderRepositoryProvider = Provider<OrderRepository>((ref) =>
  OrderRepository(ref.watch(apiClientProvider)));
final orderServiceProvider = Provider<OrderService>((ref) =>
  OrderService(ref.watch(orderRepositoryProvider)));
final ordersProvider = FutureProvider<List<Map<String, dynamic>>>((ref) =>
  ref.watch(orderServiceProvider).getOrders());
