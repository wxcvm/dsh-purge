import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const workspace = client.slice(client.indexOf('function workspacePrivacySummary('), client.indexOf('function PurgeWorkspaceIcon('))

test('workspace privacy status reflects saved options separately from temporary masking', () => {
  assert.ok(workspace.includes('status?.ok !== true'))
  assert.ok(workspace.includes('typeof status.maskHistory !== "boolean"'))
  assert.ok(workspace.includes('typeof status.maskAssetResults !== "boolean"'))
  assert.ok(workspace.includes('privacySummary.label + (temporaryPrivacy ? " · 临时" : "")'))
})

test('workspace refreshes saved status without applying stale updates', () => {
  assert.ok(workspace.includes('api({ op: "privacyDisplayStatus" })'))
  assert.ok(workspace.includes('document.addEventListener("dsh-purge-privacy-saved", refresh)'))
  assert.ok(workspace.includes('document.removeEventListener("dsh-purge-privacy-saved", refresh)'))
  assert.ok(workspace.includes('live && current === revision'))
})

test('privacy navigation opens existing low-impact tab and does not change configuration', () => {
  assert.ok(workspace.includes('className: "dshp-workspace-privacy"'))
  assert.ok(workspace.includes('"aria-label": "打开智能隐私中心。"'))
  assert.ok(workspace.includes('setUI({ open: true, tab: "low-impact", focus: null })'))
  assert.ok(!workspace.includes('api({ op: "savePlatformConfig"'))
})

test('privacy button preserves Windows caption and fullscreen layout', () => {
  const literal = client.match(/const PURGE_WORKSPACE_CSS = ("(?:[^"\\]|\\.)*");/)?.[1]
  assert.ok(literal)
  const css = JSON.parse(literal)
  assert.ok(css.includes('.dshp-workspace .dshp-workspace-privacy{'))
  assert.ok(css.includes('-webkit-app-region:no-drag'))
  assert.ok(css.includes('--dsh-windows-titlebar-height,40px'))
})
