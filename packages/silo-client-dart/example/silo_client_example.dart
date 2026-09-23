import 'package:silo_client/silo_client.dart';

Future<void> main() async {
  final silo = Silo.at('http://localhost:8090');
  try {
    print('silo ${(await silo.health()).version}');

    final page = await silo.scope('acme', 'prod').collection('posts').list(const EntryListQuery(limit: 10));
    for (final entry in page.entries) {
      print('${entry.id} ${entry.fields['title']}');
    }
  } finally {
    silo.close();
  }
}
