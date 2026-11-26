/**
 * C2 控制台 UI 集成
 * 
 * 在红队作战台中新增 C2 标签页，提供：
 * - Listener 列表与创建
 * - Beacon/Session 管理
 * - 命令下发
 * - Payload 生成
 */

export const C2Tab = {
  /**
   * 标签页配置
   */
  config: {
    id: 'c2-control',
    label: 'C2 控制',
    icon: 'server',
    order: 50,
    category: 'redteam'
  },

  /**
   * 组件数据模型
   */
  data() {
    return {
      activeFramework: 'sliver',
      frameworks: [
        {
          id: 'sliver',
          name: 'Sliver',
          icon: '🐍',
          color: '#00ff00'
        },
        {
          id: 'cobalt-strike',
          name: 'Cobalt Strike',
          icon: '🎯',
          color: '#ff6b6b'
        }
      ],
      
      // 连接状态
      connections: {
        sliver: {
          connected: false,
          host: 'localhost',
          port: 31337,
          version: null
        },
        'cobalt-strike': {
          connected: false,
          host: 'localhost',
          port: 50050,
          version: null,
          token: ''
        }
      },

      // 监听器列表
      listeners: [],
      listenerForm: {
        type: 'https',
        host: '0.0.0.0',
        port: 8443
      },

      // 会话/Beacon 列表
      sessions: [],
      selectedSession: null,

      // 命令下发
      commandInput: '',
      commandOutput: '',

      // Payload 生成
      payloadFormat: 'exe',
      selectedListener: null,
      generatedPayload: null,

      // UI 状态
      loading: false,
      error: null,
      tabs: [
        { id: 'listeners', label: '监听器' },
        { id: 'sessions', label: '会话' },
        { id: 'payload', label: 'Payload 生成' },
        { id: 'commands', label: '命令下发' }
      ],
      activeTab: 'listeners'
    }
  },

  /**
   * 计算属性
   */
  computed: {
    currentConnection() {
      return this.connections[this.activeFramework]
    },

    activeListeners() {
      return this.listeners.filter(l => l.type === this.activeFramework)
    },

    activeSessions() {
      return this.sessions.filter(s => s.framework === this.activeFramework)
    },

    frameworkStatus() {
      const conn = this.currentConnection
      return conn.connected ? '已连接' : '未连接'
    },

    frameworkStatusClass() {
      return this.currentConnection.connected ? 'status-connected' : 'status-disconnected'
    }
  },

  /**
   * 方法
   */
  methods: {
    /**
     * 连接到 C2 框架
     */
    async connectFramework() {
      this.loading = true
      this.error = null

      try {
        const config = this.connections[this.activeFramework]
        
        // 调用后端连接方法
        const response = await this.c2Manager.connect(this.activeFramework, {
          host: config.host,
          port: config.port,
          token: config.token
        })

        if (response.connected) {
          config.connected = true
          config.version = response.version
          this.showNotification(`${this.activeFramework} 已连接`, 'success')
          
          // 刷新监听器和会话列表
          await this.refreshListeners()
          await this.refreshSessions()
        } else {
          this.error = `连接失败: ${response.error}`
          this.showNotification(this.error, 'error')
        }
      } catch (err) {
        this.error = err.message
        this.showNotification(this.error, 'error')
      } finally {
        this.loading = false
      }
    },

    /**
     * 断开连接
     */
    async disconnectFramework() {
      try {
        await this.c2Manager.disconnect(this.activeFramework)
        this.connections[this.activeFramework].connected = false
        this.listeners = this.listeners.filter(l => l.type !== this.activeFramework)
        this.sessions = this.sessions.filter(s => s.framework !== this.activeFramework)
        this.showNotification('已断开连接', 'info')
      } catch (err) {
        this.error = err.message
        this.showNotification(this.error, 'error')
      }
    },

    /**
     * 创建监听器
     */
    async createListener() {
      this.loading = true
      this.error = null

      try {
        const listener = await this.c2Manager.createListener(
          this.activeFramework,
          this.listenerForm.type,
          this.listenerForm.host,
          this.listenerForm.port
        )

        this.listeners.push({
          id: listener.listener_id,
          type: this.activeFramework,
          listenerType: this.listenerForm.type,
          host: this.listenerForm.host,
          port: this.listenerForm.port,
          url: listener.url,
          payloadCmd: listener.payload_cmd,
          createdAt: new Date().toLocaleString(),
          active: true
        })

        this.showNotification('监听器已创建', 'success')
        this.listenerForm = { type: 'https', host: '0.0.0.0', port: 8443 }
      } catch (err) {
        this.error = err.message
        this.showNotification(this.error, 'error')
      } finally {
        this.loading = false
      }
    },

    /**
     * 刷新监听器列表
     */
    async refreshListeners() {
      try {
        const listeners = await this.c2Manager.listListeners(this.activeFramework)
        this.listeners = listeners.map(l => ({
          ...l,
          type: this.activeFramework,
          createdAt: new Date().toLocaleString(),
          active: true
        }))
      } catch (err) {
        console.error('Failed to refresh listeners:', err)
      }
    },

    /**
     * 刷新会话列表
     */
    async refreshSessions() {
      try {
        const sessions = await this.c2Manager.listSessions(this.activeFramework)
        this.sessions = sessions.map(s => ({
          ...s,
          framework: this.activeFramework,
          lastSeen: new Date(s.checkin || Date.now()).toLocaleString()
        }))
      } catch (err) {
        console.error('Failed to refresh sessions:', err)
      }
    },

    /**
     * 生成 Payload
     */
    async generatePayload() {
      if (!this.selectedListener) {
        this.error = '请先选择监听器'
        this.showNotification(this.error, 'warning')
        return
      }

      this.loading = true
      this.error = null

      try {
        const payload = await this.c2Manager.generateBeacon(
          this.activeFramework,
          this.selectedListener.id,
          this.payloadFormat
        )

        this.generatedPayload = {
          format: this.payloadFormat,
          base64: payload.payload_b64,
          command: payload.stager_cmd,
          path: payload.dropper_path,
          size: payload.payload_b64.length,
          timestamp: new Date().toLocaleString()
        }

        this.showNotification('Payload 已生成', 'success')
      } catch (err) {
        this.error = err.message
        this.showNotification(this.error, 'error')
      } finally {
        this.loading = false
      }
    },

    /**
     * 执行命令
     */
    async executeCommand() {
      if (!this.selectedSession) {
        this.error = '请先选择会话'
        this.showNotification(this.error, 'warning')
        return
      }

      if (!this.commandInput.trim()) {
        this.error = '请输入命令'
        return
      }

      this.loading = true
      this.commandOutput = '执行中...\n'

      try {
        const result = await this.c2Manager.executeCommand(
          this.activeFramework,
          this.selectedSession.id,
          this.commandInput
        )

        this.commandOutput = result.output || '无输出'
        if (result.error) {
          this.commandOutput += `\n错误: ${result.error}`
        }

        this.showNotification('命令已执行', 'success')
      } catch (err) {
        this.commandOutput = `执行失败: ${err.message}`
        this.showNotification(this.commandOutput, 'error')
      } finally {
        this.loading = false
      }
    },

    /**
     * 复制 Payload Base64 到剪贴板
     */
    copyPayload() {
      if (!this.generatedPayload) return
      navigator.clipboard.writeText(this.generatedPayload.base64)
      this.showNotification('已复制到剪贴板', 'success')
    },

    /**
     * 复制命令到剪贴板
     */
    copyCommand() {
      if (!this.generatedPayload) return
      navigator.clipboard.writeText(this.generatedPayload.command)
      this.showNotification('已复制命令到剪贴板', 'success')
    },

    /**
     * 显示通知
     */
    showNotification(message, type = 'info') {
      // 实现通知逻辑（集成现有通知系统）
      console.log(`[${type.toUpperCase()}] ${message}`)
    },

    /**
     * 获取框架图标
     */
    getFrameworkIcon(id) {
      const fw = this.frameworks.find(f => f.id === id)
      return fw ? fw.icon : '❓'
    }
  },

  /**
   * 生命周期钩子
   */
  mounted() {
    // 初始化时刷新数据
    this.refreshListeners()
    this.refreshSessions()
  },

  /**
   * 模板结构（HTML/Vue）
   */
  template: `
    <div class="c2-control-panel">
      <!-- 框架选择与连接状态 -->
      <div class="c2-header">
        <div class="framework-selector">
          <label>C2 框架：</label>
          <select v-model="activeFramework" class="framework-select">
            <option v-for="fw in frameworks" :key="fw.id" :value="fw.id">
              {{ fw.icon }} {{ fw.name }}
            </option>
          </select>
        </div>

        <div class="connection-status" :class="frameworkStatusClass">
          <span class="status-indicator"></span>
          <span class="status-text">{{ frameworkStatus }}</span>
          <div class="status-details" v-if="currentConnection">
            <span>{{ currentConnection.host }}:{{ currentConnection.port }}</span>
            <span v-if="currentConnection.version">v{{ currentConnection.version }}</span>
          </div>
        </div>

        <div class="connection-buttons">
          <button 
            v-if="!currentConnection.connected"
            @click="connectFramework" 
            :disabled="loading"
            class="btn btn-primary"
          >
            连接
          </button>
          <button 
            v-else
            @click="disconnectFramework" 
            :disabled="loading"
            class="btn btn-danger"
          >
            断开
          </button>
        </div>
      </div>

      <!-- 错误提示 -->
      <div v-if="error" class="alert alert-error">
        {{ error }}
      </div>

      <!-- 标签页导航 -->
      <div class="c2-tabs">
        <button 
          v-for="tab in tabs" 
          :key="tab.id"
          @click="activeTab = tab.id"
          :class="['tab-button', { 'tab-active': activeTab === tab.id }]"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- 监听器管理 -->
      <div v-show="activeTab === 'listeners'" class="tab-content">
        <div class="listeners-section">
          <h3>创建新监听器</h3>
          <div class="form-group">
            <label>类型：
              <select v-model="listenerForm.type">
                <option value="https">HTTPS</option>
                <option value="dns">DNS</option>
                <option value="smb">SMB</option>
                <option value="tcp">TCP</option>
              </select>
            </label>
            <label>监听地址：
              <input v-model="listenerForm.host" type="text" placeholder="0.0.0.0" />
            </label>
            <label>监听端口：
              <input v-model="listenerForm.port" type="number" placeholder="8443" />
            </label>
            <button @click="createListener" :disabled="loading" class="btn btn-success">
              创建
            </button>
          </div>

          <h3>活跃监听器</h3>
          <table class="listeners-table" v-if="activeListeners.length > 0">
            <thead>
              <tr>
                <th>类型</th>
                <th>地址</th>
                <th>端口</th>
                <th>创建时间</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="listener in activeListeners" :key="listener.id">
                <td>{{ listener.type }}</td>
                <td>{{ listener.host }}</td>
                <td>{{ listener.port }}</td>
                <td>{{ listener.createdAt }}</td>
                <td><span class="badge badge-success">活跃</span></td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty-state">无活跃监听器</div>
        </div>
      </div>

      <!-- 会话管理 -->
      <div v-show="activeTab === 'sessions'" class="tab-content">
        <div class="sessions-section">
          <div class="session-controls">
            <button @click="refreshSessions" class="btn btn-secondary">刷新</button>
          </div>

          <table class="sessions-table" v-if="activeSessions.length > 0">
            <thead>
              <tr>
                <th></th>
                <th>ID</th>
                <th>主机</th>
                <th>用户</th>
                <th>PID</th>
                <th>架构</th>
                <th>OS</th>
                <th>最后上线</th>
              </tr>
            </thead>
            <tbody>
              <tr 
                v-for="session in activeSessions" 
                :key="session.id"
                @click="selectedSession = session"
                :class="{ 'row-selected': selectedSession?.id === session.id }"
              >
                <td>
                  <input type="radio" :checked="selectedSession?.id === session.id" />
                </td>
                <td>{{ session.id }}</td>
                <td>{{ session.host }}</td>
                <td>{{ session.user }}</td>
                <td>{{ session.pid }}</td>
                <td>{{ session.arch }}</td>
                <td>{{ session.os }}</td>
                <td>{{ session.lastSeen }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty-state">无活跃会话</div>
        </div>
      </div>

      <!-- Payload 生成 -->
      <div v-show="activeTab === 'payload'" class="tab-content">
        <div class="payload-section">
          <div class="form-group">
            <label>选择监听器：
              <select v-model="selectedListener">
                <option :value="null">-- 请选择 --</option>
                <option v-for="listener in activeListeners" :key="listener.id" :value="listener">
                  {{ listener.type }}-{{ listener.host }}:{{ listener.port }}
                </option>
              </select>
            </label>
            <label>Payload 格式：
              <select v-model="payloadFormat">
                <option value="exe">Windows EXE</option>
                <option value="dll">Windows DLL</option>
                <option value="ps1">PowerShell</option>
                <option value="elf">Linux ELF</option>
              </select>
            </label>
            <button @click="generatePayload" :disabled="loading || !selectedListener" class="btn btn-primary">
              生成 Payload
            </button>
          </div>

          <div v-if="generatedPayload" class="payload-result">
            <h3>生成结果</h3>
            <div class="payload-info">
              <p><strong>格式：</strong> {{ generatedPayload.format }}</p>
              <p><strong>大小：</strong> {{ generatedPayload.size }} bytes</p>
              <p><strong>生成时间：</strong> {{ generatedPayload.timestamp }}</p>
            </div>

            <div class="payload-commands">
              <div class="command-item">
                <label>执行命令：</label>
                <textarea readonly>{{ generatedPayload.command }}</textarea>
                <button @click="copyCommand" class="btn btn-small">复制命令</button>
              </div>

              <div class="command-item">
                <label>Payload (Base64)：</label>
                <textarea readonly>{{ generatedPayload.base64.substring(0, 200) }}...</textarea>
                <button @click="copyPayload" class="btn btn-small">复制 Payload</button>
              </div>

              <p class="text-muted">落地路径：{{ generatedPayload.path }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 命令下发 -->
      <div v-show="activeTab === 'commands'" class="tab-content">
        <div class="commands-section">
          <div class="session-select">
            <label>选择会话：
              <select v-model="selectedSession">
                <option :value="null">-- 请选择 --</option>
                <option v-for="session in activeSessions" :key="session.id" :value="session">
                  {{ session.user }}@{{ session.host }} ({{ session.id }})
                </option>
              </select>
            </label>
          </div>

          <div class="command-input-area">
            <label>执行命令：</label>
            <textarea 
              v-model="commandInput" 
              placeholder="输入要执行的命令..."
              rows="3"
            ></textarea>
            <button @click="executeCommand" :disabled="loading || !selectedSession" class="btn btn-primary">
              执行
            </button>
          </div>

          <div v-if="commandOutput" class="command-output">
            <label>输出结果：</label>
            <pre>{{ commandOutput }}</pre>
          </div>
        </div>
      </div>
    </div>
  `
}

export default C2Tab
