/** Prepare an isolated, version-pinned official API fixture; never install or launch a host. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Single reviewed daily CI baseline; update when the next official host is released.
const latestHost = '0.2.2-rc.3';
const version = process.argv[2] || latestHost;
if (!['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.1-rc.5', '0.2.2-rc.1', '0.2.2-rc.2', latestHost].includes(version)) {
  throw new Error('Select one of the explicitly reviewed fixture versions.');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.scratch', 'hosts', version);
const response = await fetch(`https://registry.npmjs.org/@deepseek-ai%2Fdsh-tools/${encodeURIComponent(version)}`);
if (!response.ok) throw new Error(`official package metadata HTTP ${response.status}`);
const metadata = await response.json();
const cordis = String(metadata.peerDependencies?.['@deepseek-ai/cordis'] || '').replace(/^~/, '');
if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(cordis)) throw new Error('Expected an exact Cordis fixture baseline.');
const dependencies = {
  '@deepseek-ai/dsh-tools': version,
  '@deepseek-ai/dsh-system-prompt': version,
  '@deepseek-ai/dsh-scope': version,
  '@deepseek-ai/dsh-llm': version,
  '@deepseek-ai/cordis': cordis,
};
// P0 request-boundary test mounts the official Agent Loop, session and an inert LLM adapter.
// These are published host packages, not a live Desktop installation or model connection.
for (const name of [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-persistence',
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-tool-executor-native',
  // P0 Windows-only real PowerShell tool execution regression (no Provider).
  '@deepseek-ai/dsh-tool-pwsh',
  '@deepseek-ai/dsh-pwsh-local',
  '@deepseek-ai/dsh-subprocess-local',
  '@deepseek-ai/dsh-shell-env',
  '@deepseek-ai/dsh-shell',
  '@deepseek-ai/dsh-sandbox',
  '@deepseek-ai/dsh-sandbox-policy',
  '@deepseek-ai/dsh-user-approval',
  '@deepseek-ai/dsh-jobs',
]) dependencies[name] = version;
// rc.2+ dsh-llm imports dsh-error at runtime. The fixture deliberately installs
// with --legacy-peer-deps, so explicitly pin this official peer/module.
if (version === '0.2.2-rc.2' || version === latestHost) {
  dependencies['@deepseek-ai/dsh-error'] = version;
}
// Legacy tools import sandbox utilities; the 0.2.2 tool provider no longer does.
if (metadata.peerDependencies?.['@deepseek-ai/dsh-sandbox']) {
  dependencies['@deepseek-ai/dsh-sandbox'] = version;
  dependencies['@deepseek-ai/dsh-sandbox-policy'] = version;
  dependencies['@deepseek-ai/dsh-working-directory'] = version;
}
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
