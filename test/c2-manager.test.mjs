/**
 * C2 管理器测试
 * 
 * 测试范围：
 * - 框架连接与验证
 * - Listener 创建与管理
 * - Session 状态跟踪
 * - Payload 生成（多格式）
 * - 命令执行与反馈
 */

import { strict as assert } from 'node:assert'
import test from 'node:test'
import { C2Manager } from '../lib/redteam/c2-manager.js'
import { SliverBridge } from '../lib/redteam/sliver-bridge.js'
import { CobaltStrikeBridge } from '../lib/redteam/cobalt-strike-bridge.js'

test('C2Manager - 初始化', async () => {
  const manager = new C2Manager()
  assert.ok(manager, '应成功初始化 C2Manager')
  assert.equal(manager.connections.size, 0, '初始时无连接')
  assert.equal(manager.listeners.size, 0, '初始时无监听器')
})

test('C2Manager - Sliver 连接', async () => {
  const manager = new C2Manager()
  
  const result = await manager.connect('sliver', {
    host: 'localhost',
    port: 31337
  })

  assert.ok(result.connected, '应成功连接 Sliver')
  assert.equal(result.version, '1.0.0', '应返回版本号')
  assert.equal(result.teamserver, 'localhost', '应返回 TeamServer 地址')
})

test('C2Manager - Cobalt Strike 连接', async () => {
  const manager = new C2Manager()
  
  const result = await manager.connect('cobalt-strike', {
    host: 'cs.example.com',
    port: 50050,
    token: 'test_token_123'
  })

  assert.ok(result.connected, '应成功连接 Cobalt Strike')
  assert.equal(result.teamserver, 'cs.example.com', '应返回 TeamServer 地址')
})

test('C2Manager - 连接失败处理', async () => {
  const manager = new C2Manager()
  
  const result = await manager.connect('unknown-framework', {})
  
  assert.equal(result.connected, false, '未知框架应连接失败')
  assert.ok(result.error, '应返回错误信息')
})

test('C2Manager - 创建 HTTPS 监听器', async () => {
  const manager = new C2Manager()
  
  await manager.connect('sliver', {
    host: 'localhost',
    port: 31337
  })

  const listener = await manager.createListener('sliver', 'https', '0.0.0.0', 8443)

  assert.ok(listener.listener_id, '应返回监听器 ID')
  assert.ok(listener.listener_id.includes('sliver'), 'ID 应包含框架标识')
  assert.equal(listener.listener_id.includes('https'), true, 'ID 应包含监听器类型')
  assert.ok(listener.url, '应返回 URL')
  assert.ok(listener.payload_cmd, '应返回 Payload 命令')
})

test('C2Manager - 创建 DNS 监听器', async () => {
  const manager = new C2Manager()
  
  await manager.connect('cobalt-strike', {
    host: 'cs.local',
    port: 50050,
    token: 'token'
  })

  const listener = await manager.createListener('cobalt-strike', 'dns', 'dns.example.com', 53)

  assert.ok(listener.listener_id, '应返回监听器 ID')
  assert.equal(listener.listener_id.includes('dns'), true, '类型应为 dns')
})

test('C2Manager - 列出监听器', async () => {
  const manager = new C2Manager()
  
  await manager.connect('sliver', { host: 'localhost', port: 31337 })
  
  await manager.createListener('sliver', 'https', '0.0.0.0', 8443)
  await manager.createListener('sliver', 'dns', '0.0.0.0', 53)

  const listeners = await manager.listListeners()

  assert.equal(listeners.length, 2, '应返回 2 个监听器')
  assert.ok(listeners.some(l => l.type === 'https'), '应包含 HTTPS 监听器')
  assert.ok(listeners.some(l => l.type === 'dns'), '应包含 DNS 监听器')
})

test('C2Manager - 过滤监听器', async () => {
  const manager = new C2Manager()
  
  await manager.connect('sliver', { host: 'localhost', port: 31337 })
  await manager.connect('cobalt-strike', { host: 'cs', port: 50050, token: 't' })
  
  await manager.createListener('sliver', 'https', '0.0.0.0', 8443)
  await manager.createListener('cobalt-strike', 'dns', '0.0.0.0', 53)

  const sliverListeners = await manager.listListeners('sliver')

  assert.equal(sliverListeners.length, 1, '应仅返回 Sliver 监听器')
  assert.equal(sliverListeners[0].type, 'https', '应为 HTTPS 类型')
})

test('C2Manager - 生成 EXE Payload', async () => {
  const manager = new C2Manager()
  
  await manager.connect('sliver', { host: 'localhost', port: 31337 })
  
  const listener = await manager.createListener('sliver', 'https', '0.0.0.0', 8443)
  const payload = await manager.generateBeacon('sliver', listener.listener_id, 'exe')

  assert.ok(payload.payload_b64, '应返回 Base64 编码的 Payload')
  assert.ok(payload.stager_cmd, '应返回 Stager 命令')
  assert.ok(payload.dropper_path, '应返回落地路径')
})

test('C2Manager - 生成 DLL Payload', async () => {
  const manager = new C2Manager()
  
  await manager.connect('cobalt-strike', { host: 'cs', port: 50050, token: 't' })
  
  const listener = await manager.createListener('cobalt-strike', 'https', '0.0.0.0', 8443)
  const payload = await manager.generateBeacon('cobalt-strike', listener.listener_id, 'dll')

  assert.ok(payload.payload_b64, '应返回 DLL Payload')
})

test('SliverBridge - 连接', async () => {
  const bridge = new SliverBridge({
    host: 'sliver.local',
    port: 31337
  })

  const result = await bridge.connect()

  assert.ok(result, '应成功连接')
  assert.ok(bridge.isConnected(), '应标记为已连接')
})

test('SliverBridge - 生成 Payload', async () => {
  const bridge = new SliverBridge()
  await bridge.connect()

  const payload = await bridge.generatePayload('windows/exe', '192.168.1.100', 8443)

  assert.ok(payload.payload_b64, '应返回 Base64 Payload')
  assert.equal(payload.format, 'exe', '格式应为 exe')
  assert.ok(payload.size > 0, 'Payload 大小应大于 0')
  assert.ok(payload.c2.includes('192.168.1.100'), 'C2 应包含指定地址')
})

test('SliverBridge - 启动监听器', async () => {
  const bridge = new SliverBridge()
  await bridge.connect()

  const listener = await bridge.startListener('https', '0.0.0.0', 8443)

  assert.ok(listener.listener_id, '应返回监听器 ID')
  assert.equal(listener.type, 'https', '应为 HTTPS 类型')
  assert.equal(listener.status, 'active', '应为活跃状态')
})

test('SliverBridge - 列出 Implant', async () => {
  const bridge = new SliverBridge()
  await bridge.connect()

  // 添加测试 Implant
  bridge.addImplant({
    id: 'test-implant-1',
    name: 'windows-beacon',
    hostname: 'WORKSTATION-01',
    username: 'admin',
    process_id: 2048,
    architecture: 'x64',
    os: 'windows'
  })

  const implants = await bridge.listImplants()

  assert.equal(implants.length, 1, '应返回 1 个 Implant')
  assert.equal(implants[0].id, 'test-implant-1', 'ID 应匹配')
  assert.equal(implants[0].hostname, 'WORKSTATION-01', 'Hostname 应匹配')
})

test('SliverBridge - 执行命令', async () => {
  const bridge = new SliverBridge()
  await bridge.connect()

  bridge.addImplant({
    id: 'test-implant-1',
    name: 'beacon',
    hostname: 'TARGET-PC'
  })

  const result = await bridge.executeCommand('test-implant-1', 'whoami')

  assert.ok(result.output, '应返回命令输出')
  assert.ok(result.output.includes('whoami'), '输出应包含命令')
  assert.equal(result.error, null, '不应有错误')
})

test('SliverBridge - Shellcode 注入', async () => {
  const bridge = new SliverBridge()
  await bridge.connect()

  bridge.addImplant({
    id: 'test-implant-1',
    name: 'beacon',
    hostname: 'TARGET-PC'
  })

  const shellcode = Buffer.from('MZ\x90\x00')
  const result = await bridge.injectShellcode('test-implant-1', shellcode, 1234)

  assert.ok(result.success, '注入应成功')
  assert.equal(result.injected_size, shellcode.length, '注入大小应匹配')
})

test('CobaltStrikeBridge - 连接', async () => {
  const bridge = new CobaltStrikeBridge()
  
  const result = await bridge.connect('cs.example.com', 50050, 'api_token_123')

  assert.ok(result, '应成功连接')
  assert.ok(bridge.isConnected(), '应标记为已连接')
})

test('CobaltStrikeBridge - 生成 Payload', async () => {
  const bridge = new CobaltStrikeBridge()
  await bridge.connect('cs.local', 50050, 'token')

  const payload = await bridge.generatePayload('https-listener', 'exe', 'x64')

  assert.ok(payload.payload_b64, '应返回 Base64 Payload')
  assert.equal(payload.format, 'exe', '格式应为 exe')
  assert.equal(payload.arch, 'x64', '架构应为 x64')
})

test('CobaltStrikeBridge - 列出 Beacon', async () => {
  const bridge = new CobaltStrikeBridge()
  await bridge.connect('cs.local', 50050, 'token')

  bridge.addBeacon({
    id: 'beacon-1',
    host: '192.168.1.50',
    user: 'admin',
    pid: 2048,
    arch: 'x64',
    os: 'Windows Server 2019'
  })

  const beacons = await bridge.listBeacons()

  assert.equal(beacons.length, 1, '应返回 1 个 Beacon')
  assert.equal(beacons[0].host, '192.168.1.50', 'Host 应匹配')
})

test('CobaltStrikeBridge - 执行命令', async () => {
  const bridge = new CobaltStrikeBridge()
  await bridge.connect('cs.local', 50050, 'token')

  bridge.addBeacon({
    id: 'beacon-1',
    host: '192.168.1.50'
  })

  const result = await bridge.executeCommand('beacon-1', 'ipconfig')

  assert.ok(result.output, '应返回命令输出')
  assert.equal(result.error, null, '不应有错误')
})

test('C2Manager - 获取代理状态', async () => {
  const manager = new C2Manager()
  
  await manager.connect('sliver', { host: 'localhost', port: 31337 })
  await manager.connect('cobalt-strike', { host: 'cs', port: 50050, token: 't' })

  const status = await manager.getAgentStatus()

  assert.ok(status.sessions, '应返回 sessions')
  assert.ok(status.listeners, '应返回 listeners')
  assert.equal(status.operator_count, 2, '应有 2 个已连接框架')
  assert.ok(status.connectedFrameworks.includes('sliver'), '应包含 sliver')
  assert.ok(status.connectedFrameworks.includes('cobalt-strike'), '应包含 cobalt-strike')
})

test('C2Manager - 断开连接', async () => {
  const manager = new C2Manager()
  
  await manager.connect('sliver', { host: 'localhost', port: 31337 })

  assert.equal(manager.connections.size, 1, '应有 1 个连接')
  
  await manager.disconnect('sliver')

  assert.equal(manager.connections.size, 0, '应无连接')
})

test('C2Manager - 多框架并行', async () => {
  const manager = new C2Manager()
  
  await manager.connect('sliver', { host: 'localhost', port: 31337 })
  await manager.connect('cobalt-strike', { host: 'cs', port: 50050, token: 't' })

  await manager.createListener('sliver', 'https', '0.0.0.0', 8443)
  await manager.createListener('cobalt-strike', 'dns', '0.0.0.0', 53)

  const status = manager.getStatus()

  assert.equal(status.sliver, 'connected', 'Sliver 应已连接')
  assert.equal(status['cobalt-strike'], 'connected', 'Cobalt Strike 应已连接')
  
  const listeners = await manager.listListeners()
  assert.equal(listeners.length, 2, '应有 2 个监听器')
})

test('C2Manager - 未连接框架的操作', async () => {
  const manager = new C2Manager()
  
  try {
    await manager.listSessions('sliver')
    assert.fail('应抛出错误')
  } catch (error) {
    assert.ok(error.message.includes('not connected'), '应提示未连接')
  }
})

test('完整流程 - Sliver Implant 生成与管理', async () => {
  const manager = new C2Manager()
  
  // 1. 连接
  await manager.connect('sliver', { host: 'localhost', port: 31337 })
  
  // 2. 创建监听器
  const listener = await manager.createListener('sliver', 'https', '0.0.0.0', 8443)
  assert.ok(listener.listener_id, '应成功创建监听器')
  
  // 3. 生成 Payload
  const payload = await manager.generateBeacon('sliver', listener.listener_id, 'exe')
  assert.ok(payload.payload_b64, '应成功生成 Payload')
  
  // 4. 验证监听器
  const listeners = await manager.listListeners('sliver')
  assert.equal(listeners.length, 1, '应有 1 个监听器')
  
  // 5. 获取状态
  const status = await manager.getAgentStatus()
  assert.equal(status.operator_count, 1, '应有 1 个已连接框架')
})

test('完整流程 - Cobalt Strike Beacon 生成与管理', async () => {
  const manager = new C2Manager()
  
  // 1. 连接
  await manager.connect('cobalt-strike', {
    host: 'cs.example.com',
    port: 50050,
    token: 'test_token'
  })
  
  // 2. 创建监听器
  const listener = await manager.createListener('cobalt-strike', 'https', '192.168.1.100', 443)
  assert.ok(listener.listener_id, '应成功创建监听器')
  
  // 3. 生成多格式 Payload
  const exePayload = await manager.generateBeacon('cobalt-strike', listener.listener_id, 'exe')
  const dllPayload = await manager.generateBeacon('cobalt-strike', listener.listener_id, 'dll')
  const ps1Payload = await manager.generateBeacon('cobalt-strike', listener.listener_id, 'ps1')
  
  assert.ok(exePayload.payload_b64, '应生成 EXE')
  assert.ok(dllPayload.payload_b64, '应生成 DLL')
  assert.ok(ps1Payload.payload_b64, '应生成 PS1')
  
  // 4. 验证监听器
  const listeners = await manager.listListeners('cobalt-strike')
  assert.equal(listeners.length, 1, '应有 1 个监听器')
})
