/**
 * CredentialCracker — 离线凭据破解引擎
 *
 * 职责：hashcat / john 命令生成与结果归一化
 *
 * 安全与边界：
 * - 绝不打包或下载 hashcat/john 二进制；只调用系统 PATH 中已存在的命令
 * - 默认 dryRun：只生成命令，不启动破解进程
 * - 不读取明文口令；破解结果只返回是否成功与来源标记
 */

import { spawn } from 'node:child_process'

/** 常见哈希模式（hashcat -m） */
export const HASHCAT_MODES = Object.freeze({
  md5: 0,
  sha1: 100,
  sha256: 1400,
  ntlm: 1000,
  'netntlmv2': 5600,
  bcrypt: 3200,
  sha512crypt: 1800,
  kerberoast: 13100,
  asrep: 18200,
})

/** john --format 映射 */
export const JOHN_FORMATS = Object.freeze({
  md5: 'raw-md5',
  sha1: 'raw-sha1',
  sha256: 'raw-sha256',
  ntlm: 'nt',
  bcrypt: 'bcrypt',
  sha512crypt: 'sha512crypt',
})

export class CredentialCracker {
  constructor(options = {}) {
    this.config = {
      dryRun: options.dryRun !== false,
      timeout: options.timeout || 300000,
      hashcatPath: options.hashcatPath || 'hashcat',
      johnPath: options.johnPath || 'john',
      wordlists: options.wordlists || [],
      rules: options.rules || [],
      ...options,
    }
  }

  /**
   * 解析哈希类型到 hashcat 模式
   * @param {string} type - md5 | sha1 | ntlm | bcrypt | ...
   * @returns {number|null}
   */
  hashcatModeOf(type) {
    const key = String(type || '').toLowerCase()
    return Object.hasOwn(HASHCAT_MODES, key) ? HASHCAT_MODES[key] : null
  }

  /**
   * 生成 hashcat 命令（不执行）
   * @param {Object} options - { hash, type, wordlist, rules, attackMode }
   * @returns {Object} { ok, command, args, error }
   */
  buildHashcatCommand(options = {}) {
    const mode = this.hashcatModeOf(options.type)
    if (mode === null) return { ok: false, error: 'unsupported_hash_type' }

    const wordlist = options.wordlist || this.config.wordlists[0]
    if (!wordlist) return { ok: false, error: 'wordlist_required' }

    const args = [
      '-m', String(mode),
      '-a', String(options.attackMode || 0),
      options.hash || '[HASH]',
      wordlist,
    ]
    if (options.rules) args.push('-r', String(options.rules))
    if (options.outfile) args.push('-o', String(options.outfile))

    return {
      ok: true,
      command: this.config.hashcatPath,
      args,
      preview: [this.config.hashcatPath, ...args].join(' '),
    }
  }

  /**
   * 生成 john 命令（不执行）
   * @param {Object} options - { hash, type, wordlist }
   * @returns {Object} { ok, command, args, error }
   */
  buildJohnCommand(options = {}) {
    const format = JOHN_FORMATS[String(options.type || '').toLowerCase()]
    const args = []
    if (format) args.push('--format=' + format)
    if (options.wordlist) args.push('--wordlist=' + String(options.wordlist))
    args.push('--stdin')

    return {
      ok: true,
      command: this.config.johnPath,
      args,
      preview: [this.config.johnPath, ...args].join(' '),
    }
  }

  /**
   * 破解单个哈希
   * @param {string} hash
   * @param {string} type
   * @param {Object} options
   * @returns {Object} { success, cracked, source, note }
   */
  async crack(hash, type, options = {}) {
    if (!hash) return { success: false, error: 'hash_required' }

    const built = this.buildHashcatCommand({ hash, type, ...options })
    if (!built.ok) return { success: false, error: built.error, dryRun: this.config.dryRun }

    if (this.config.dryRun) {
      return {
        success: true,
        dryRun: true,
        cracked: false,
        source: 'hashcat',
        preview: built.preview,
        note: 'dry-run：仅生成命令，未启动破解。',
      }
    }

    // 真实执行：需要系统存在 hashcat；缺失时 fail closed，不伪造成果
    const available = await this._binaryAvailable(this.config.hashcatPath)
    if (!available) return { success: false, error: 'hashcat_not_available', source: 'hashcat' }

    return {
      success: true,
      dryRun: false,
      cracked: false,
      source: 'hashcat',
      note: '已通过可用性检查；实际破解进程需由操作者显式运行，本模块不托管长时间任务。',
    }
  }

  /**
   * 批量破解
   * @param {string[]} hashes
   * @param {string} type
   * @param {Object} options
   * @returns {Object} { results: [...], total, dryRun }
   */
  async crackMultiple(hashes = [], type, options = {}) {
    const results = []
    for (const hash of hashes) {
      results.push({ hash: '[REDACTED]', ...(await this.crack(hash, type, options)) })
    }
    return {
      results,
      total: hashes.length,
      dryRun: this.config.dryRun,
    }
  }

  /**
   * 列出可用字典
   * @returns {Object} { configured: string[], rules: string[] }
   */
  listDictionaries() {
    return {
      configured: this.config.wordlists.slice(),
      rules: this.config.rules.slice(),
      note: '字典需由操作者自行提供路径；本模块不下载任何字典文件。',
    }
  }

  /**
   * 把破解结果写入凭据库（由调用方提供 store）
   * @param {Object} store
   * @param {string} engagement
   * @param {Object} record - { credentialId, cracked, source }
   * @returns {Object} { ok, error }
   */
  async recordResult(store, engagement, record = {}) {
    if (!store) return { ok: false, error: 'store_required' }
    if (this.config.dryRun) {
      return { ok: true, dryRun: true, note: 'dry-run：未写入凭据库。' }
    }
    if (typeof store.addCredential !== 'function') {
      return { ok: false, error: 'addCredential_unavailable' }
    }
    // 明文口令不在此持久化；只记录破解方法与来源
    store.addCredential(engagement, {
      source: 'offline-crack',
      tool: record.source || 'unknown',
      secret_ref: record.secretRef || null,
      note: '离线破解完成，明文未写入本记录',
    })
    return { ok: true }
  }

  /** 检查系统命令是否可用（只做 which/where，不启动破解） */
  async _binaryAvailable(binary) {
    try {
      const probe = spawn(process.platform === 'win32' ? 'where' : 'which', [binary], {
        stdio: 'ignore',
        timeout: 5000,
      })
      return await new Promise((resolve) => {
        probe.on('error', () => resolve(false))
        probe.on('close', (code) => resolve(code === 0))
      })
    } catch {
      return false
    }
  }
}
