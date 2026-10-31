import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(?:js|mjs)$/.test(entry.name) ? [path] : [];
  });
}
const paths = ['lib', 'bin', 'scripts', 'test'].flatMap((dir) => walk(join(root, dir)));
paths.push(join(root, 'client.js'));
for (const path of paths) {
  const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax OK: ${paths.length} JavaScript modules (no target application executed).`);
