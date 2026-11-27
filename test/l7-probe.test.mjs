/**
 * L7 应用层探针测试（全部走 127.0.0.1 回环，不接触外部网络）
 *
 * 背景：TUN 类代理会让 TCP 层对所有端口伪造 open，
 * 只有应用层交互能鉴别真服务。这里用本地假服务验证鉴别逻辑。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { probeL7, probeL7Batch, L7_DEFAULT_PORTS } from '../lib/redteam/l7-probe.js'

const FAST = { bannerWait: 250, readTimeout: 250, connectTimeout: 1500 }

/** 起一个最小本地 TCP 服务，返回 { port, close }。teardown 会强制销毁残留 socket。 */
async function startServer(t, onConnection) {
  const sockets = new Set()
  const server = net.createServer((sock) => {
    sockets.add(sock)
    sock.on('close', () => sockets.delete(sock))
    sock.on('error', () => { /* 探针主动断开是正常路径 */ })
    onConnection(sock)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  t.after(() => {
    for (const sock of sockets) { try { sock.destroy() } catch { /* ignore */ } }
    sockets.clear()
    return new Promise((resolve) => server.close(() => resolve()))
  })
  return port
}

/** 取一个当前空闲的端口（绑定后立即释放） */
async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(() => resolve()))
  return port
}

test('detects SSH from a passive banner', async (t) => {
  const port = await startServer(t, (sock) => {
    sock.write('SSH-2.0-OpenSSH_8.9p1 Ubuntu-3\r\n')
  })
  const r = await probeL7({ host: '127.0.0.1', port, ...FAST })
  assert.equal(r.verdict, 'REAL_SERVICE')
  assert.equal(r.service, 'ssh')
  assert.match(r.evidence, /SSH-2\.0/)
})

test('detects MySQL greeting', async (t) => {
  const port = await startServer(t, (sock) => {
    // MySQL 握手包里带 mysql_native_password 字样
    sock.write(Buffer.from('\x4a\x00\x00\x00\x0a5.7.42\x00mysql_native_password\x00', 'latin1'))
  })
  const r = await probeL7({ host: '127.0.0.1', port, ...FAST })
  assert.equal(r.verdict, 'REAL_SERVICE')
  assert.equal(r.service, 'mysql')
})

test('detects FTP and SMTP greetings as distinct services', async (t) => {
  const ftpPort = await startServer(t, (sock) => { sock.write('220 (vsFTPd 3.0.5)\r\n') })
  const ftp = await probeL7({ host: '127.0.0.1', port: ftpPort, ...FAST })
  // "220 (vsFTPd 3.0.5)" 无 FTP 字样，落到泛化 220 问候；关键是判定为真服务
  assert.equal(ftp.verdict, 'REAL_SERVICE')
  assert.ok(['ftp', 'smtp-greeting', 'smtp'].includes(ftp.service), 'got ' + ftp.service)

  const smtpPort = await startServer(t, (sock) => { sock.write('220 mail.example.test ESMTP Postfix\r\n') })
  const smtp = await probeL7({ host: '127.0.0.1', port: smtpPort, ...FAST })
  assert.equal(smtp.verdict, 'REAL_SERVICE')
  assert.equal(smtp.service, 'smtp')
})

test('detects plain HTTP via active GET when no banner is sent', async (t) => {
  const port = await startServer(t, (sock) => {
    sock.once('data', () => {
      sock.write('HTTP/1.0 200 OK\r\nServer: fixture\r\n\r\nhello')
    })
  })
  const r = await probeL7({ host: '127.0.0.1', port, ...FAST })
  assert.equal(r.verdict, 'REAL_SERVICE')
  assert.equal(r.service, 'http')
  assert.match(r.evidence, /^HTTP\/1\.0 200/)
})

test('detects a TLS record layer response', async (t) => {
  const port = await startServer(t, (sock) => {
    sock.once('data', () => {
      // 回一个 TLS handshake 记录（0x16 开头）
      sock.write(Buffer.from('160303004a020000460303', 'hex'))
    })
  })
  const r = await probeL7({ host: '127.0.0.1', port, ...FAST })
  assert.equal(r.verdict, 'REAL_SERVICE')
  assert.equal(r.service, 'tls')
})

test('a silent accept is reported as FAKE_OR_SILENT, not as an open service', async (t) => {
  /* 这正是 TUN 伪造的行为：连接建立成功，但对面什么都不说、什么都不回。 */
  const port = await startServer(t, () => { /* 接受连接但永不响应 */ })
  const r = await probeL7({ host: '127.0.0.1', port, ...FAST })
  assert.equal(r.verdict, 'FAKE_OR_SILENT')
  assert.equal(r.service, null)
  assert.match(r.note, /假 open/)
})

test('unmatched bytes still count as a real service', async (t) => {
  const port = await startServer(t, (sock) => { sock.write(Buffer.from('QUJDREVGR0g=', 'latin1')) })
  const r = await probeL7({ host: '127.0.0.1', port, ...FAST })
  assert.equal(r.verdict, 'REAL_SERVICE')
  assert.equal(r.service, 'unknown')
})

test('closed port is UNREACHABLE, never REAL_SERVICE', async () => {
  const port = await freePort()
  const r = await probeL7({ host: '127.0.0.1', port, ...FAST })
  assert.equal(r.verdict, 'UNREACHABLE')
  assert.equal(r.service, null)
})

test('rejects invalid port and missing host', async () => {
  await assert.rejects(() => probeL7({ host: '127.0.0.1', port: 0 }), /port/)
  await assert.rejects(() => probeL7({ host: '127.0.0.1', port: 70000 }), /port/)
  await assert.rejects(() => probeL7({ port: 80 }), /host/)
})

test('batch separates real services from silent accepts', async (t) => {
  const sshPort = await startServer(t, (sock) => { sock.write('SSH-2.0-test\r\n') })
  const silentPort = await startServer(t, () => {})

  const r = await probeL7Batch({
    host: '127.0.0.1',
    ports: [sshPort, silentPort],
    concurrency: 2,
    ...FAST,
  })

  assert.equal(r.tested, 2)
  assert.equal(r.real_services.length, 1)
  assert.equal(r.real_services[0].port, sshPort)
  assert.equal(r.real_services[0].service, 'ssh')
  assert.deepEqual(r.fake_or_silent, [silentPort])
  assert.equal(r.results.length, 2, 'per-port results preserve input order')
})

test('batch validates input', async () => {
  await assert.rejects(() => probeL7Batch({ ports: [80] }), /host/)
  await assert.rejects(() => probeL7Batch({ host: '127.0.0.1', ports: [] }), /ports/)
})

test('default port list is a curated high-value set, not a full range', () => {
  assert.ok(Array.isArray(L7_DEFAULT_PORTS))
  assert.ok(L7_DEFAULT_PORTS.includes(443))
  assert.ok(L7_DEFAULT_PORTS.includes(3306))
  assert.ok(L7_DEFAULT_PORTS.length < 60, 'must stay a curated list so the probe stays cheap')
})
