import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseReportExportArgs, writeReportBundle } from '../lib/redteam/report-export.js'
import { makeShareableReport, redactCredentialText } from '../lib/redteam/report-shareable.js'

test('YAML literal and folded secret blocks are fully redacted without eating sibling fields', () => {
  const input = [
    'private_key: |-',
    '  synthetic-secret-line-1',
    '  synthetic-secret-line-2',
    '',
    'public_note: safe metadata',
    'items:',
    '  - sshPrivateKey: >2-',
    '      synthetic-ssh-block',
    '  - label: safe item',
    "passphrase: | # legacy credential",
    '  synthetic-passphrase-block',
    'other: visible',
  ].join('\r\n')
  const masked = redactCredentialText(input)
  for (const secret of ['synthetic-secret-line-1', 'synthetic-secret-line-2',
    'synthetic-ssh-block', 'synthetic-passphrase-block']) {
    assert.equal(masked.includes(secret), false)
  }
  assert.match(masked, /private_key: "\[REDACTED_SECRET\]"/)
  assert.match(masked, /sshPrivateKey: "\[REDACTED_SECRET\]"/)
  assert.match(masked, /passphrase: "\[REDACTED_SECRET\]"/)
  assert.match(masked, /public_note: safe metadata/)
  assert.match(masked, /- label: safe item/)
  assert.match(masked, /other: visible/)
  assert.match(masked, /\r\n/, 'original CRLF line endings remain')
})

test('shareable switch is explicit; legacy raw mode remains the default', () => {
  const cwd = process.cwd()
  assert.equal(parseReportExportArgs([], {}, cwd).shareable, undefined)
  assert.equal(parseReportExportArgs(['--shareable'], {}, cwd).shareable, true)
  assert.throws(() => parseReportExportArgs(['--shareable', '--shareable'], {}, cwd), /重复参数/)
  assert.throws(() => parseReportExportArgs(['--shareable=yes'], {}, cwd), /未知参数/)
})

test('shareable copy masks common secrets, hides target/IP and omits screenshots without mutating raw report', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shareable-report-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const root = path.join(base, 'store')
  const engagement = 'internal-test'
  const dir = path.join(root, 'engagements', engagement)
  const shots = path.join(dir, 'shots')
  fs.mkdirSync(shots, { recursive: true })
  fs.writeFileSync(path.join(shots, 'sample.png'), Buffer.from([1, 2, 3, 4]))
  const report = {
    target: 'Example Company',
    summary: { points: 8 },
    markdown: [
      '# Example Company',
      'Authorization: Bearer synthetic-credential',
      'Cookie: session=synthetic-cookie',
      '{"Authorization": "Basic synthetic-basic", "Cookie": "sid=synthetic-json-cookie", "Proxy-Authorization": "Basic synthetic-proxy"}',
      '{"Set-Cookie": "session=synthetic-set-cookie; Path=/"}',
      'password=synthetic-password',
      'api_key: synthetic-api-key',
      'private_key: |-',
      '  synthetic-report-yaml-block',
      'public_note: keep this line',
      '{"private_key":"synthetic-private-key","sshPrivateKey":"synthetic-ssh-private-key","passphrase":"synthetic-passphrase","signing_key":"synthetic-signing-key","encryptionKey":"synthetic-encryption-key"}',
      'password: "synthetic secret with spaces"',
      'GET https://operator:in-url-password@example.net/private',
      'prose: Bearer standalone-secret',
      '10.1.2.3 links to 10.1.2.3',
      'IPv6: 2001:DB8::ABCD, https://[2001:0db8:0:0:0:0:0:abcd]:8443/private, 2001:db8::abcd/64.',
      'Scoped: fe80::1%fixture-interface; https://[fe80::1%25fixture-interface]:443/',
      'Embedded: ::ffff:192.0.2.128; mapped hex: ::FFFF:C000:0280.',
      'Timestamp: 2026-11-28T12:34:56Z',
      '![Screenshot](shots/sample.png)',
      '-----BEGIN PRIVATE KEY-----',
      'synthetic-key-body',
      '-----END PRIVATE KEY-----',
    ].join('\n'),
    items: [{ shots: [{ url: 'shots/sample.png' }] }],
  }
  const original = report.markdown
  const output = path.join(base, 'out')
  const raw = writeReportBundle({ root, engagement, outDir: output, report })
  assert.equal(fs.readFileSync(raw.reportFile, 'utf8'), original)
  assert.equal(raw.manifest.summary.evidenceFiles, 1)
  const safe = writeReportBundle({ root, engagement, outDir: output, report, shareable: true })
  const markdown = fs.readFileSync(safe.reportFile, 'utf8')
  for (const secret of ['synthetic-credential', 'synthetic-cookie', 'synthetic-password',
    'synthetic-report-yaml-block', 'synthetic-api-key', 'synthetic-private-key', 'synthetic-ssh-private-key', 'synthetic-passphrase',
    'synthetic-signing-key', 'synthetic-encryption-key', 'synthetic-basic', 'synthetic-json-cookie', 'synthetic-proxy', 'synthetic-set-cookie', 'synthetic-key-body', 'Example Company', '10.1.2.3', 'shots/sample.png',
    'synthetic secret with spaces', 'in-url-password', 'standalone-secret', 'operator:',
    '2001:DB8::ABCD', '2001:0db8:0:0:0:0:0:abcd', '2001:db8::abcd', 'fe80::1',
    'fixture-interface', '::ffff:192.0.2.128', '::FFFF:C000:0280']) {
    assert.ok(!markdown.includes(secret), 'shareable markdown must not contain ' + secret)
  }
  assert.match(markdown, /Authorization: \[REDACTED_SECRET\]/)
  assert.match(markdown, /IP-01 links to IP-01/)
  assert.ok(markdown.includes('IPv6: IPv6-01, https://[IPv6-01]:8443/private, IPv6-01/64.'))
  assert.ok(markdown.includes('Scoped: IPv6-02; https://[IPv6-02]:443/'))
  assert.ok(markdown.includes('Embedded: IPv6-03; mapped hex: IPv6-03.'))
  assert.ok(markdown.includes('Timestamp: 2026-11-28T12:34:56Z'))
  assert.match(markdown, /public_note: keep this line/)
  assert.match(markdown, /password: "\[REDACTED_SECRET\]"/)
  assert.match(markdown, /https:\/\/\[REDACTED_USERINFO\]@example\.net\/private/)
  assert.match(markdown, /prose: Bearer \[REDACTED_SECRET\]/)
  assert.match(markdown, /\[EVIDENCE OMITTED\]/)
  assert.equal(safe.manifest.engagementId, '[REDACTED]')
  assert.equal(safe.manifest.privacy.mode, 'shareable')
  assert.equal(safe.manifest.privacy.manualReviewRequired, true)
  assert.equal(safe.manifest.summary.evidenceFiles, 0)
  assert.equal(fs.existsSync(path.join(safe.bundleDir, 'shots')), false)
  assert.equal(fs.readFileSync(raw.reportFile, 'utf8'), original)
  assert.equal(report.markdown, original)
})

test('IPv6 aliases start fresh per report and literal targets do not partially redact other addresses', () => {
  const first = makeShareableReport({ target: '::1', markdown: '# ::1\npeer=::1234', items: [] })
  assert.equal(first.markdown, '# IPv6-01\npeer=IPv6-02')
  const second = makeShareableReport({ target: 'Team [2001:DB8::2]', markdown: '# Team [2001:db8::2]\npeer=2001:db8::2', items: [] })
  assert.equal(second.markdown, '# [REDACTED_TARGET]\npeer=IPv6-01')
})

test('mask encrypted PEM credentials and complete API key header values', () => {
  const input = [
    '-----BEGIN ENCRYPTED PRIVATE KEY-----',
    'synthetic-encrypted-key-body',
    '-----END ENCRYPTED PRIVATE KEY-----',
    'X-API-Key: synthetic-header-first synthetic-header-rest',
    'public_note: keep this line',
    '-----BEGIN CERTIFICATE-----',
    'public-certificate-body',
    '-----END CERTIFICATE-----',
  ].join('\r\n')
  const masked = redactCredentialText(input)
  for (const value of ['synthetic-encrypted-key-body', 'synthetic-header-first', 'synthetic-header-rest']) {
    assert.equal(masked.includes(value), false)
  }
  assert.match(masked, /\[REDACTED_PRIVATE_KEY\]/)
  assert.match(masked, /X-API-Key: \[REDACTED_SECRET\]/)
  assert.match(masked, /public_note: keep this line/)
  assert.match(masked, /public-certificate-body/)
})
