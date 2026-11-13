/** Run every host-sensitive test on every official fixture; common tests once per OS. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { HOSTS, FULL_HOST } from './host-fixture-policy.mjs';
export { HOSTS, FULL_HOST };

const root = fileURLToPath(new URL('../', import.meta.url));
export function selectCompatibilityTests(repoRoot, host) {
  if (!HOSTS.includes(host)) throw new Error('Unknown official fixture version: ' + host);
  const files = [
    ...fs.readdirSync(path.join(repoRoot, 'test')).filter(n => /\.test\.(?:js|mjs|cjs)$/.test(n)).map(n => 'test/' + n),
    ...['maintenance', 'maintenance/desktop-tools'].flatMap(dir =>
      fs.readdirSync(path.join(repoRoot, dir)).filter(n => n.endsWith('.test.mjs')).map(n => dir + '/' + n)),
  ].sort();
  if (host === FULL_HOST) return files;
  // Discover future tests that consume the explicit official fixture variables,
  // instead of silently limiting version-sensitive coverage to a hardcoded file.
  const contracts = files.filter(file => /\bDSH_COMPAT_(?:HOST_ROOT|TOOLS_MODULE)\b/.test(
    fs.readFileSync(path.join(repoRoot, file), 'utf8')));
  if (!contracts.includes('test/host-compat.test.mjs')) throw new Error('Missing actual host API contract test');
  return contracts;
}

function main() {
  const host = process.argv[2];
  const files = selectCompatibilityTests(root, host);
  if (process.argv[3] === '--list') {
    console.log(JSON.stringify(files));
    return;
  }
  const fixture = path.join(root, '.scratch', 'hosts', host);
  if (!fs.existsSync(path.join(fixture, 'package.json'))) throw new Error('Official fixture not prepared: ' + fixture);
  const env = { ...process.env, DSH_COMPAT_HOST_ROOT: fixture };
  delete env.DSH_COMPAT_TOOLS_MODULE;
  console.log(host + ': ' + files.length + ' test files (' + (host === FULL_HOST ? 'full' : 'host contracts') + ')');
  const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
