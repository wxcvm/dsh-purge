import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('release installs declared dependencies before importing the plugin, without host-changing scripts', () => {
  const source = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  const setup = source.indexOf('actions/setup-node@v4')
  const install = source.indexOf('npm install --ignore-scripts --legacy-peer-deps')
  const check = source.indexOf('name: Syntax-check plugin entry')
  assert.ok(setup > 0 && install > setup && check > install)
  assert.match(source, /node-version: '24'/)
  assert.match(source, /--package-lock=false/)
})
