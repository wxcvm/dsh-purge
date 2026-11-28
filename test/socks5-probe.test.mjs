import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { parseLoopbackSocks5Listen, probeSocks5Connect } from '../lib/redteam/socks5-probe.js'

async function mockTruncatedSocks5() {
  const server = createServer(socket => {
    let stage = 'greeting'
    let buffer = Buffer.alloc(0)
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      if (stage === 'greeting' && buffer.length >= 3) {
        buffer = buffer.subarray(3)
        socket.write(Buffer.from([5, 0]))
        stage = 'connect'
      }
      if (stage === 'connect' && buffer.length >= 10) {
        socket.write(Buffer.from([5, 0]))
        socket.end()
        stage = 'done'
      }
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return { server, listen: `127.0.0.1:${server.address().port}` }
}

async function mockSocks5(replyCode = 0, method = 0, reserved = 0) {
  let request = null
  const server = createServer(socket => {
    let stage = 'greeting'
    let buffer = Buffer.alloc(0)
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      if (stage === 'greeting' && buffer.length >= 3) {
        buffer = buffer.subarray(3)
        socket.write(Buffer.from([5, method]))
        stage = 'connect'
      }
      if (stage === 'connect' && buffer.length >= 10) {
        request = Buffer.from(buffer.subarray(0, 10))
        buffer = buffer.subarray(10)
        socket.write(Buffer.from([5, replyCode, reserved, 1, 127, 0, 0, 1, 0, 0]))
        stage = 'done'
      }
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return { server, listen: `127.0.0.1:${server.address().port}`, getRequest: () => request }
}

test('parseLoopbackSocks5Listen accepts loopback only', () => {
  assert.deepEqual(parseLoopbackSocks5Listen('127.0.0.1:1080'), { host: '127.0.0.1', port: 1080 })
  assert.deepEqual(parseLoopbackSocks5Listen('localhost:1080'), { host: '127.0.0.1', port: 1080 })
  assert.deepEqual(parseLoopbackSocks5Listen('[::1]:1080'), { host: '::1', port: 1080 })
  assert.throws(() => parseLoopbackSocks5Listen('10.0.0.5:1080'), /loopback/)
  assert.throws(() => parseLoopbackSocks5Listen('0.0.0.0:1080'), /loopback/)
})

test('probeSocks5Connect sends one IPv4 TCP CONNECT and accepts success', async () => {
  const mock = await mockSocks5(0, 0)
  try {
    const result = await probeSocks5Connect(parseLoopbackSocks5Listen(mock.listen), '10.0.0.2', 443, 1000)
    assert.equal(result.ok, true)
    const request = mock.getRequest()
    assert.ok(request)
    assert.deepEqual([...request.subarray(0, 4)], [5, 1, 0, 1])
    assert.deepEqual([...request.subarray(4, 8)], [10, 0, 0, 2])
    assert.equal(request.readUInt16BE(8), 443)
  } finally {
    await new Promise(resolve => mock.server.close(resolve))
  }
})

test('probeSocks5Connect rejects a non-zero reserved byte in the SOCKS5 reply', async () => {
  const mock = await mockSocks5(0, 0, 1)
  try {
    const result = await probeSocks5Connect(parseLoopbackSocks5Listen(mock.listen), '10.0.0.2', 443, 1000)
    assert.equal(result.ok, false)
    assert.equal(result.error, 'invalid_socks5_reply')
  } finally {
    await new Promise(resolve => mock.server.close(resolve))
  }
})

test('probeSocks5Connect rejects a truncated success reply instead of claiming reachability', async () => {
  const mock = await mockTruncatedSocks5()
  try {
    const result = await probeSocks5Connect(parseLoopbackSocks5Listen(mock.listen), '10.0.0.2', 443, 1000)
    assert.equal(result.ok, false)
    assert.equal(result.error, 'closed')
  } finally {
    await new Promise(resolve => mock.server.close(resolve))
  }
})

test('probeSocks5Connect reports a SOCKS5 connect rejection', async () => {
  const mock = await mockSocks5(5, 0)
  try {
    const result = await probeSocks5Connect(parseLoopbackSocks5Listen(mock.listen), '10.0.0.2', 443, 1000)
    assert.equal(result.ok, false)
    assert.equal(result.error, 'socks5_connect_rejected_5')
  } finally {
    await new Promise(resolve => mock.server.close(resolve))
  }
})

test('probeSocks5Connect bounds unexpected proxy response buffering', async t => {
  const server = createServer(socket => socket.once('data', () => socket.write(Buffer.alloc(65, 0))))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const result = await probeSocks5Connect(
    parseLoopbackSocks5Listen(`127.0.0.1:${server.address().port}`),
    '10.0.0.2', 443, 1000,
  )
  assert.equal(result.ok, false)
  assert.equal(result.error, 'oversized_socks5_reply')
})

test('probeSocks5Connect rejects non-IPv4 targets and invalid timeouts', () => {
  const proxy = { host: '127.0.0.1', port: 1080 }
  assert.throws(() => probeSocks5Connect(proxy, 'example.com', 443, 1000), /IPv4/)
  assert.throws(() => probeSocks5Connect(proxy, '10.0.0.2', 443, 900), /timeout/)
})
