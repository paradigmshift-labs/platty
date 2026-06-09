import 'package:flutter/material.dart';
import 'package:flutter_counter/home_page.dart';

void main() {
  runApp(const MyApp());
}

/// Root application widget.
class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Flutter Counter',
      home: const HomePage(title: 'Counter Home Page'),
    );
  }
}
