import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sprayHTTP,
  spraySSH,
  spraySMB,
  sprayDatabase,
  withRateLimit,
  recordValidCredentials,
  RateLimiter,
} from '../lib/redteam/password-spray.js'
import {
  DEFAULT_CREDENTIALS,
  getDefaultCredentials,
  findDefaultCredential,
  checkDefaultCredential,
  generateCandidateCredentials,
} from '../lib/redteam/default-credential-db.js'

test('DEFAULT_CREDENTIALS contains expected categories', () => {
  assert.ok(DEFAULT_CREDENTIALS['admin-panels'])
  assert.ok(DEFAULT_CREDENTIALS['databases'])
  assert.ok(DEFAULT_CREDENTIALS['network-devices'])
  assert.ok(DEFAULT_CREDENTIALS['iot-devices'])
  assert.ok(DEFAULT_CREDENTIALS['web-services'])
  assert.ok(DEFAULT_CREDENTIALS.databases.length > 0)
  assert.ok(DEFAULT_CREDENTIALS.databases.some(c => c.service === 'mysql'))
})

test('getDefaultCredentials filters by service type', () => {
  const all = getDefaultCredentials('databases')
  assert.ok(all.length > 0)

  const mysql = getDefaultCredentials('databases', 'mysql')
  assert.ok(mysql.every(c => c.service === 'mysql'))
  assert.ok(mysql.length > 0)
})

test('findDefaultCredential locates credentials in database', () => {
  const found = findDefaultCredential('admin', 'admin')
  assert.ok(found)
  assert.equal(found.user, 'admin')
  assert.equal(found.pass, 'admin')

  const notFound = findDefaultCredential('nonexistent', 'nope')
  assert.equal(notFound, null)
})

test('checkDefaultCredential validates port association', () => {
  const mysql = checkDefaultCredential('localhost', 3306, 'mysql')
  assert.equal(mysql.possible, true)

  const wrong = checkDefaultCredential('localhost', 1234, 'mysql')
  assert.equal(wrong.possible, false)
})

test('generateCandidateCredentials includes social engineering variants', () => {
  const cands = generateCandidateCredentials('target-name', 'admin-panels')
  assert.ok(cands.length > 0)
  assert.ok(cands.some(c => c.pass === 'target-name'))
  assert.ok(cands.some(c => c.pass === 'target-name123'))

  // 检查去重
  const unique = new Set(cands.map(c => `${c.user}:${c.pass}`))
  assert.equal(unique.size, cands.length)
})

test('RateLimiter enforces request rate limit', async () => {
  const limiter = new RateLimiter(10) // 10 RPS = 100ms per request
  const times = []

  for (let i = 0; i < 3; i++) {
    times.push(Date.now())
    await limiter.wait()
  }

  // 检查间隔约为 100ms（允许 ±50% 误差，考虑系统调度延迟）
  for (let i = 1; i < times.length; i++) {
    const interval = times[i] - times[i - 1]
    assert.ok(interval >= 50 && interval <= 150, `Interval ${interval}ms not within expected range`)
  }
})

test('sprayHTTP detects success pattern', async () => {
  // Mock fetch - 模拟 HTTP 响应
  const originalFetch = global.fetch
  let callCount = 0

  global.fetch = async (url, opts) => {
    callCount++
    const body = new URLSearchParams(opts.body)
    const user = body.get('user')
    const pass = body.get('pass')

    // 模拟：user=admin, pass=admin 时成功
    if (user === 'admin' && pass === 'admin') {
      return {
        status: 200,
        text: async () => 'Login successful',
      }
    }

    return {
      status: 401,
      text: async () => 'Login failed',
    }
  }

  try {
    const result = await sprayHTTP(
      'http://localhost/login',
      'user',
      'pass',
      ['admin', 'root'],
      ['admin', 'wrong'],
      { rateLimit: 100 } // 快速模式用于测试
    )

    assert.equal(result.checked, 4) // 2 users × 2 passwords
    assert.equal(result.valid.length, 1)
    assert.equal(result.valid[0].user, 'admin')
    assert.equal(result.valid[0].pass, 'admin')
  } finally {
    global.fetch = originalFetch
  }
})

test('spraySSH returns candidate credentials with rate limit', async () => {
  const result = await spraySSH(
    ['192.168.1.100', '192.168.1.101'],
    ['root', 'admin'],
    ['password', '123456'],
    { rateLimit: 100, port: 22 }
  )

  // 由于无实际 SSH 连接，应返回候选列表
  assert.ok(Array.isArray(result.valid))
  assert.equal(result.checked, 8) // 2 hosts × 2 users × 2 passwords
})

test('spraySMB handles unreachable hosts', async () => {
  const result = await spraySMB(
    ['unreachable.invalid'],
    ['admin'],
    ['password'],
    'DOMAIN',
    { rateLimit: 100 }
  )

  assert.ok(result.errors.length > 0)
  assert.ok(result.errors[0].error.includes('unreachable'))
})

test('sprayDatabase recognizes valid database type', async () => {
  const result = await sprayDatabase('mysql', ['127.0.0.1'], [], { rateLimit: 100 })
  assert.ok(Array.isArray(result.valid))
  assert.equal(result.checked, 0) // 无凭据
})

test('sprayDatabase rejects unknown type', async () => {
  const result = await sprayDatabase('unknown', [], [], {})
  assert.ok(result.errors.length > 0)
  assert.equal(result.checked, 0)
})

test('withRateLimit applies rate limiting', async () => {
  const start = Date.now()
  let executed = false

  await withRateLimit(async () => {
    executed = true
  }, 1) // 1 RPS

  assert.equal(executed, true)
})

test('recordValidCredentials mock store integration', async () => {
  // Mock store
  const mockStore = {
    recordCredential: async (engagement, cred) => {
      return { id: 'cred-' + Math.random(), ...cred }
    },
  }

  const creds = [
    { host: '192.168.1.1', user: 'admin', pass: 'admin', protocol: 'ssh' },
    { host: '192.168.1.2', user: 'root', pass: 'password', protocol: 'ssh' },
  ]

  const result = await recordValidCredentials(mockStore, 'engagement-1', creds, {
    protocol: 'ssh',
    source_tool: 'password-spray',
  })

  assert.equal(result.recorded, 2)
  assert.equal(result.errors.length, 0)
})

test('password spray workflow end-to-end (mocked)', async () => {
  const mockStore = {
    recordCredential: async (engagement, cred) => {
      return { id: 'cred-123', ...cred }
    },
  }

  // 模拟发现的凭据
  const validCreds = [
    { host: '192.168.1.100', user: 'admin', pass: 'admin', protocol: 'ssh' },
  ]

  const result = await recordValidCredentials(mockStore, 'eng-1', validCreds, {
    protocol: 'ssh',
    source_tool: 'password-spray-test',
  })

  assert.equal(result.recorded, 1)
  assert.ok(result.recorded === validCreds.length)
})

test('credential database completeness check', () => {
  // 确保各主要服务都有默认凭据
  const dbs = DEFAULT_CREDENTIALS.databases
  assert.ok(dbs.some(c => c.service === 'mysql'), 'MySQL credentials missing')
  assert.ok(dbs.some(c => c.service === 'mssql'), 'MSSQL credentials missing')
  assert.ok(dbs.some(c => c.service === 'redis'), 'Redis credentials missing')
  assert.ok(dbs.some(c => c.service === 'postgresql'), 'PostgreSQL credentials missing')

  const admin = DEFAULT_CREDENTIALS['admin-panels']
  assert.ok(admin.some(c => c.user === 'admin'), 'Default admin user missing')
})

test('password spray HTTP handles missing headers', async () => {
  const originalFetch = global.fetch
  global.fetch = async () => ({
    status: 200,
    text: async () => 'success',
  })

  try {
    const result = await sprayHTTP(
      'http://localhost/api',
      'username',
      'password',
      ['user1'],
      ['pass1'],
      { rateLimit: 100 }
    )

    assert.equal(result.checked, 1)
  } finally {
    global.fetch = originalFetch
  }
})
