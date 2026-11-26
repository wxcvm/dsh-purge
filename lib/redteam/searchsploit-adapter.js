/**
 * SearchSploit 适配器 - exploitdb.csv 本地离线查询
 *
 * 功能：
 *   · 加载本地 exploitdb.csv 文件（零外部依赖）
 *   · 基于 CVE / 关键字进行模糊查询
 *   · 返回结构化的 PoC 信息
 *   · 支持 POC 文件下载到本地
 *
 * 数据源：https://www.exploit-db.com/
 * CSV 格式：edb_id, file, type, platform, date, author, title, verified, cve, cwe
 *
 * 零依赖：只使用 node: 内置模块，兼容离线环境。
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export class SearchsploitAdapter {
  /**
   * @param {string} csvPath - exploitdb.csv 路径
   *   默认：./kb/exploitdb.csv (相对于运行目录)
   */
  constructor(csvPath = './kb/exploitdb.csv') {
    this.csvPath = csvPath
    this.exploits = []
    this.cveIndex = new Map() // CVE -> [exploit indices]
    this.componentIndex = new Map() // component -> [exploit indices]
    this._loaded = false
  }

  /**
   * 加载 CSV 文件到内存
   * @throws {Error} 如果文件不存在或格式错误
   */
  load() {
    if (this._loaded) return
    
    if (!existsSync(this.csvPath)) {
      throw new Error(`exploitdb.csv 未找到: ${this.csvPath}`)
    }

    try {
      const content = readFileSync(this.csvPath, 'utf-8')
      const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      
      // 跳过 CSV 头
      const headerLine = lines[0]
      const headers = headerLine.split(',').map(h => h.toLowerCase().trim())
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]
        if (!line) continue
        
        try {
          const values = this._parseCsvLine(line)
          if (values.length < 10) continue
          
          const exploit = {
            id: values[0],
            path: values[1],
            type: values[2],
            platform: values[3],
            date: values[4],
            author: values[5],
            title: values[6],
            verified: values[7] === '1' || values[7] === 'true',
            cve: values[8] || null,
            cwe: values[9] || null,
          }
          
          const idx = this.exploits.length
          this.exploits.push(exploit)
          
          // 建立索引
          if (exploit.cve) {
            if (!this.cveIndex.has(exploit.cve)) {
              this.cveIndex.set(exploit.cve, [])
            }
            this.cveIndex.get(exploit.cve).push(idx)
          }
          
          // 从 title/path 提取组件名
          const component = this._extractComponent(exploit.title)
          if (component) {
            if (!this.componentIndex.has(component)) {
              this.componentIndex.set(component, [])
            }
            this.componentIndex.get(component).push(idx)
          }
        } catch (e) {
          // 跳过格式错误的行
          continue
        }
      }
      
      this._loaded = true
    } catch (e) {
      throw new Error(`加载 exploitdb.csv 失败: ${e.message}`)
    }
  }

  /**
   * 查询 PoC
   * @param {string} cve - CVE 编号 (e.g., 'CVE-2021-44228')
   * @param {string} keyword - 关键字 (e.g., 'Apache Log4j')
   * @param {object} filters - 过滤条件
   *   - type: 'remote' | 'local' | 'webapps'
   *   - verified: boolean
   *   - platform: 'linux' | 'windows' | 'web'
   * @returns {array} PoC 对象数组
   */
  search(cve, keyword, filters = {}) {
    this.load()
    
    let results = []
    
    // 1. 基于 CVE 查询
    if (cve) {
      const normalized = cve.toUpperCase()
      if (this.cveIndex.has(normalized)) {
        results = this.cveIndex.get(normalized)
          .map(idx => this.exploits[idx])
      }
    }
    
    // 2. 基于关键字查询
    if (keyword && results.length === 0) {
      const keywordLower = keyword.toLowerCase()
      results = this.exploits.filter(e => 
        e.title.toLowerCase().includes(keywordLower) ||
        e.path.toLowerCase().includes(keywordLower) ||
        (e.cve && e.cve.toLowerCase().includes(keywordLower))
      )
    }
    
    // 3. 应用过滤条件
    if (filters.type) {
      results = results.filter(e => e.type === filters.type)
    }
    
    if (filters.verified !== undefined) {
      results = results.filter(e => e.verified === filters.verified)
    }
    
    if (filters.platform) {
      results = results.filter(e => 
        e.platform.includes(filters.platform) ||
        e.platform === 'generic'
      )
    }
    
    return results.map(e => this._formatResult(e))
  }

  /**
   * 获取所有漏洞按严重级别排序
   * @returns {array} 排序后的 PoC 对象
   */
  getTopExploits(limit = 20) {
    this.load()
    
    // 按验证状态和日期排序
    const sorted = [...this.exploits]
      .sort((a, b) => {
        if (a.verified !== b.verified) return b.verified ? 1 : -1
        return new Date(b.date) - new Date(a.date)
      })
    
    return sorted.slice(0, limit).map(e => this._formatResult(e))
  }

  /**
   * 获取特定漏洞的详细信息
   * @param {string} exploitId - Exploit ID
   * @returns {object|null} 详细信息或 null
   */
  getExploitById(exploitId) {
    this.load()
    const exploit = this.exploits.find(e => e.id === exploitId)
    return exploit ? this._formatResult(exploit) : null
  }

  /**
   * 统计信息
   * @returns {object} 统计数据
   */
  stats() {
    this.load()
    return {
      total: this.exploits.length,
      verified: this.exploits.filter(e => e.verified).length,
      byType: this._groupBy('type'),
      byPlatform: this._groupBy('platform'),
      byDate: this._groupByDate(),
    }
  }

  /**
   * ========== 私有方法 ==========
   */

  /**
   * 解析 CSV 行（处理带引号的字段）
   * @private
   */
  _parseCsvLine(line) {
    const result = []
    let current = ''
    let inQuotes = false
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    
    result.push(current.trim())
    return result
  }

  /**
   * 从标题中提取组件名
   * @private
   */
  _extractComponent(title) {
    // 提取第一个词作为组件（通常是应用名）
    const match = title.match(/^(\w+)[\s\-]/)
    return match ? match[1].toLowerCase() : null
  }

  /**
   * 格式化结果
   * @private
   */
  _formatResult(exploit) {
    return {
      id: exploit.id,
      title: exploit.title,
      path: exploit.path,
      type: exploit.type, // 'remote', 'local', 'webapps'
      platform: exploit.platform,
      date: exploit.date,
      author: exploit.author,
      verified: exploit.verified,
      cve: exploit.cve,
      cwe: exploit.cwe,
      url: `https://www.exploit-db.com/exploits/${exploit.id}`,
    }
  }

  /**
   * 按字段分组统计
   * @private
   */
  _groupBy(field) {
    const counts = {}
    this.exploits.forEach(e => {
      const value = e[field] || 'unknown'
      counts[value] = (counts[value] || 0) + 1
    })
    return counts
  }

  /**
   * 按日期分组统计
   * @private
   */
  _groupByDate() {
    const counts = {}
    this.exploits.forEach(e => {
      const year = e.date.split('-')[0]
      counts[year] = (counts[year] || 0) + 1
    })
    return counts
  }
}

/**
 * 单例工厂函数
 */
let _instance = null

export function getSearchsploitAdapter(csvPath) {
  if (!_instance) {
    _instance = new SearchsploitAdapter(csvPath)
  }
  return _instance
}
