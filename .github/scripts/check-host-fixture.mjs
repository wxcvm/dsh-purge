/** Check installed package identities, not just pins in the generated manifest. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import semver from 'semver';

const root = process.env.DSH_COMPAT_HOST_ROOT;
const expected = process.argv[2];
assert.ok(root && expected, 'Set DSH_COMPAT_HOST_ROOT and pass the expected host version');
const read = (...parts) => JSON.parse(readFileSync(path.join(root, ...parts, 'package.json'), 'utf8'));
const { dependencies } = read();
const installed = {};
for (const [name, pin] of Object.entries(dependencies)) {
  const pkg = read('node_modules', name);
  assert.equal(pkg.name, name);
  assert.equal(pkg.version, pin, name + ' must match the manifest');
  if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(pkg.version, expected, name);
  installed[name] = pkg;
}
const [tools, llm, error, cordis] = ['dsh-tools', 'dsh-llm', 'dsh-error', 'cordis']
  .map(name => installed['@deepseek-ai/' + name]);
for (const [owner, peer] of [[tools, llm], [llm, error], [tools, cordis], [llm, cordis]]) {
  const range = owner.peerDependencies?.[peer.name];
  assert.ok(semver.validRange(range) && semver.satisfies(peer.version, range),
    owner.name + ' requires ' + peer.name + '@' + range + ', found ' + peer.version);
}
console.log('DSH_COMPAT_HOST_ROOT=' + root);
console.log(Object.keys(installed).length + ' exact pins verified; ' +
  [tools, llm, error, cordis].map(pkg => pkg.name + '@' + pkg.version).join(', '));
