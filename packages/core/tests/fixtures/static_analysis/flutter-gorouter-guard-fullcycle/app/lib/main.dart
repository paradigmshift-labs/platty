import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'pages/dashboard_page.dart';
import 'pages/login_page.dart';
import 'services/auth_repository.dart';

final router = GoRouter(
  routes: [
    GoRoute(
      path: '/dashboard',
      redirect: (context, state) {
        final signedIn = AuthRepository().hasSession();
        if (!signedIn) {
          return '/login?from=${state.uri.path}';
        }
        return null;
      },
      builder: (context, state) => const DashboardPage(),
    ),
    GoRoute(
      path: '/login',
      builder: (context, state) => const LoginPage(),
    ),
  ],
);

void main() {
  runApp(MaterialApp.router(routerConfig: router));
}
