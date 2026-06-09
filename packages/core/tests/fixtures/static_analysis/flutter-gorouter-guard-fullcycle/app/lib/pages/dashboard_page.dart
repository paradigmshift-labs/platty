import 'package:flutter/material.dart';

import '../services/profile_api.dart';

class DashboardPage extends StatelessWidget {
  const DashboardPage({super.key});

  @override
  Widget build(BuildContext context) {
    final api = ProfileApi();
    return ElevatedButton(
      onPressed: () => api.fetchProfile(),
      child: const Text('Load profile'),
    );
  }
}
