import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';

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
const check = (path) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--check', path], { stdio: 'inherit', windowsHide: true });
  child.once('error', reject);
  child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`Syntax check failed: ${path} (exit ${code})`)));
});

// Keep process startup overhead low without spawning one Node process per CPU at once.
const workers = Math.min(4, availableParallelism(), paths.length);
let next = 0;
await Promise.all(Array.from({ length: workers }, async () => {
  while (next < paths.length) await check(paths[next++]);
}));
console.log(`Syntax OK: ${paths.length} JavaScript modules (no target application executed).`);
