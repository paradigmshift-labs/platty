import 'package:dio/dio.dart';

class ProfileApi {
  final Dio client;

  ProfileApi({Dio? client}) : client = client ?? Dio();

  Future<Map<String, Object?>> fetchProfile() async {
    final response = await client.get('/api/mobile/profile');
    return Map<String, Object?>.from(response.data as Map);
  }
}
