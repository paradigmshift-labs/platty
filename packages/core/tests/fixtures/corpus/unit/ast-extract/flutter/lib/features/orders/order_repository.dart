import '../../core/network/api_client.dart';

class OrderRepository {
  final ApiClient _client;

  OrderRepository(this._client);

  Future<List<Map<String, dynamic>>> fetchOrders() async {
    final response = await _client.get('/orders');
    return List<Map<String, dynamic>>.from(response);
  }

  Future<Map<String, dynamic>> saveOrder(Map<String, dynamic> data) async {
    return _client.post('/orders', data);
  }
}
