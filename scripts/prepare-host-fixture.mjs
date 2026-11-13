/** Prepare an isolated, version-pinned official API fixture; never install or launch a host. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOSTS, FULL_HOST, fixtureDependencies } from './host-fixture-policy.mjs';

const version = process.argv[2] || FULL_HOST;
if (!HOSTS.includes(version)) {
  throw new Error('Select one of the explicitly reviewed fixture versions.');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.scratch', 'hosts', version);
const metadata = await Promise.all(['dsh-tools', 'dsh-llm'].map(async name => {
  const response = await fetch(`https://registry.npmjs.org/@deepseek-ai%2F${name}/${encodeURIComponent(version)}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`official ${name} metadata HTTP ${response.status}`);
  return response.json();
}));
const dependencies = fixtureDependencies(version, ...metadata);
const manifest = JSON.stringify({
  name: `dsh-purge-host-fixture-${version}`,
  private: true,
  type: 'module',
  dependencies,
}, null, 2) + '\n';
fs.mkdirSync(directory, { recursive: true });
const target = path.join(directory, 'package.json');
if (fs.existsSync(target)) {
  if (fs.readFileSync(target, 'utf8') !== manifest) throw new Error('Existing fixture manifest differs; select a fresh fixture directory.');
} else fs.writeFileSync(target, manifest, { flag: 'wx' });
console.log(directory);
