import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

for (const name of ['firebase.json', '.firebaserc', 'database.rules.json', 'public/app-config.json']) JSON.parse(await readFile(name, 'utf8'));
await build({ entryPoints: { 'firebase-client': 'src/firebase-client.js', 'admin-client': 'src/admin-client.js', player: 'src/player.js' }, outdir: 'public', bundle: true, splitting: true, chunkNames: 'assets/[name]-[hash]', minify: true, format: 'esm', target: ['es2022'], legalComments: 'eof' });
await import('./package-extension.mjs');
console.log('Firebase Hosting bundle ready.');
