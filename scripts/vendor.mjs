// Kopieert three.js en Rapier uit node_modules naar vendor/, zodat het spel
// zonder CDN en zonder bouwstap draait (ook op GitHub Pages).
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ['node_modules/three/build/three.module.js', 'vendor/three/three.module.js'],
  ['node_modules/three/build/three.core.js', 'vendor/three/three.core.js'],
  ['node_modules/three/LICENSE', 'vendor/three/LICENSE'],
  ['node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs', 'vendor/rapier/rapier.mjs'],
  ['node_modules/@dimforge/rapier3d-compat/LICENSE', 'vendor/rapier/LICENSE'],
];
for (const [from, to] of files) {
  const src = join(root, from);
  mkdirSync(dirname(join(root, to)), { recursive: true });
  copyFileSync(src, join(root, to));
  console.log('vendor:', to);
}
