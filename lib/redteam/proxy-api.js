/** Host-side proxy settings operations exposed through /redteam/api. */
import {
  importProxyYaml,
  loadProxyConfig,
  proxyConfigPublic,
  resolveProxyConfig,
  saveProxyConfig,
} from './proxy-config.js'
import { matchesNoProxy, requestTextWithProxy } from './proxy-network.js'
import { discoverFlClashProxy } from './proxy-local-discovery.js'
import { verifyModeBExit } from './proxy-mode-b-verify.js'
import {
  proxyPoolSnapshot,
  proxyPoolExportArtexModeBConfig,
  proxyPoolSave,
  proxyProfileSave,
  proxyProfileDelete,
  proxyPoolImport,
  proxyPoolConnect,
  proxyPoolTest,
  proxyPoolDisconnect,
  proxyProfileConnect,
  proxyProfileTest,
  proxyProfilesDelete,
  clearProxyPoolState,
} from './proxy-pool.js'

export const PROXY_SCOPE = '插件 GitHub 版本查询与代理连接测试（测试地址：api.github.com）；不修改系统、浏览器或模型 API 的代理设置。'
export const DEFAULT_PROXY_TEST_URL = 'https://api.github.com/'

function isProxyOp(op) {
  return op === 'proxyLocalDiscover'
    || op === 'proxyModeBVerify'
    || op === 'proxyModeBExportArtex'
    || op === 'proxyConfigGet'
    || op === 'proxyConfigSave'
    || op === 'proxyConfigImport'
    || op === 'proxyConfigTest'
    || op === 'proxyPoolGet'
    || op === 'proxyPoolSave'
    || op === 'proxyPoolImport'
    || op === 'proxyPoolConnect'
    || op === 'proxyPoolTest'
    || op === 'proxyPoolDisconnect'
    || op === 'proxyProfileSave'
    || op === 'proxyProfileDelete'
    || op === 'proxyProfilesDelete'
    || op === 'proxyProfileConnect'
    || op === 'proxyProfileTest'
}

function safeError(error, fallback = '代理操作失败') {
  const message = error && error.message ? String(error.message) : ''
  if (/代理地址|代理主机|代理协议|主机和端口|代理池|代理节点|代理超时|直连列表|未回退|活动代理|密码|endpoint changed|host and port|protocol|password must|模式 B|链式节点|VLESS|VPS/i.test(message)) return message
  return fallback
}

function poolResult(root, result = {}, extra = {}) {
  return {
    ok: true,
    scope: PROXY_SCOPE,
    ...result,
    ...extra,
  }
}

/**
 * Handle only proxy operations.  Returning undefined for other operations lets
 * the existing redteam API dispatcher continue with its normal routing.
 * `options.testUrl` is intended for deterministic host-side tests only.
 */
export async function handleProxyOp(root, request, options = {}) {
  const op = request && request.op
  if (!isProxyOp(op)) return undefined
  const configRoot = String(root || '.')
  if (op === 'proxyLocalDiscover') {
    return discoverFlClashProxy()
  }
  if (op === 'proxyModeBVerify') {
    try {
      const result = await verifyModeBExit(request && request.expectedExitIp, { root: configRoot })
      return { ...poolResult(configRoot), ...result }
    } catch {
      return { ok: false, verification: 'failed', scope: 'purge_plugin_http_only',
        error: '三跳出口未通过验证；请检查 VPS2 的预期公网 IPv4、活动代理与实际连通性。' }
    }
  }
  if (op === 'proxyModeBExportArtex') {
    // The returned YAML contains secrets. The caller must establish trusted
    // local access at the HTTP boundary; never accept consent from request data.
    if (options.allowCredentialExport !== true) {
      return { ok: false, error: '包含凭据的配置仅允许可信本机界面导出' }
    }
    try {
      return proxyPoolExportArtexModeBConfig(configRoot)
    } catch {
      return { ok: false, error: 'ARTEX 模式 B 配置导出失败' }
    }
  }
  if (op === 'proxyPoolGet') {
    try { return poolResult(configRoot, proxyPoolSnapshot(configRoot)) }
    catch (error) { return { ok: false, error: safeError(error, '代理池读取失败') } }
  }
  if (op === 'proxyPoolSave') {
    try {
      const result = await proxyPoolSave(configRoot, request && request.settings, options)
      return poolResult(configRoot, result)
    } catch (error) {
      return { ok: false, error: safeError(error, '代理池设置无效') }
    }
  }
  if (op === 'proxyProfileSave') {
    try {
      const result = await proxyProfileSave(configRoot, request && request.profile)
      return poolResult(configRoot, result)
    } catch (error) {
      return { ok: false, error: safeError(error, '代理节点设置无效') }
    }
  }
  if (op === 'proxyProfileDelete') {
    try {
      const result = await proxyProfileDelete(configRoot, request && request.id)
      return poolResult(configRoot, result)
    } catch (error) {
      return { ok: false, error: safeError(error, '代理节点删除失败') }
    }
  }
  if (op === 'proxyProfilesDelete') {
    try {
      const result = await proxyProfilesDelete(configRoot, request && request.ids)
      return poolResult(configRoot, result)
    } catch (error) {
      return { ok: false, error: safeError(error, '代理节点批量删除失败') }
    }
  }
  if (op === 'proxyPoolImport') {
    try {
      const result = await proxyPoolImport(configRoot, request && request.yaml)
      if (result && result.ok === false) return result
      return poolResult(configRoot, result)
    } catch (error) {
      return { ok: false, error: safeError(error, '代理节点导入失败') }
    }
  }
  if (op === 'proxyPoolConnect') {
    try {
      const result = await proxyPoolConnect(configRoot, options)
      return { ...poolResult(configRoot, result), ok: result.ok !== false, ...(result.error ? { error: result.error } : {}) }
    } catch (error) {
      return { ...poolResult(configRoot, proxyPoolSnapshot(configRoot)), ok: false, error: safeError(error, '代理池连接失败') }
    }
  }
  if (op === 'proxyPoolTest') {
    try {
      const result = await proxyPoolTest(configRoot, request && request.ids, options)
      return { ...poolResult(configRoot, result), ok: result.ok !== false, ...(result.error ? { error: result.error } : {}) }
    } catch (error) {
      return { ok: false, error: safeError(error, '代理节点批量测试失败') }
    }
  }
  if (op === 'proxyPoolDisconnect') {
    try {
      const result = await proxyPoolDisconnect(configRoot, request && request.id)
      return poolResult(configRoot, result)
    } catch (error) {
      return { ok: false, error: safeError(error, '代理池断开失败') }
    }
  }
  if (op === 'proxyProfileConnect') {
    try {
      const result = await proxyProfileConnect(configRoot, request && request.id, options)
      return { ...poolResult(configRoot, result), ok: result.ok !== false, ...(result.error ? { error: result.error } : {}) }
    } catch (error) {
      return { ...poolResult(configRoot, proxyPoolSnapshot(configRoot)), ok: false, error: safeError(error, '代理节点连接失败') }
    }
  }
  if (op === 'proxyProfileTest') {
    try {
      const result = await proxyProfileTest(configRoot, request && request.profile, options)
      return poolResult(configRoot, { ...proxyPoolSnapshot(configRoot), ...result })
    } catch (error) {
      return { ...poolResult(configRoot, proxyPoolSnapshot(configRoot)), ok: false, error: safeError(error, '代理节点测试失败') }
    }
  }
  if (op === 'proxyConfigGet') {
    try {
      const config = loadProxyConfig(configRoot)
      return {
        ok: true,
        scope: PROXY_SCOPE,
        proxyRevision: config.updated_at || 'default',
        config: proxyConfigPublic(config),
      }
    } catch (error) {
      return { ok: false, error: safeError(error, '代理配置读取失败') }
    }
  }
  if (op === 'proxyConfigImport') {
    const result = importProxyYaml(request && request.yaml)
    return result
  }
  if (op === 'proxyConfigSave') {
    try {
      const result = {
        ok: true,
        scope: PROXY_SCOPE,
        config: saveProxyConfig(request && request.config, configRoot),
      }
      /* If the pool had been read before a legacy save, let its next read
         perform the one-time migration.  An existing proxy-pool.json remains
         authoritative and is simply reloaded. */
      clearProxyPoolState(configRoot)
      return result
    } catch (error) {
      return { ok: false, error: safeError(error, '代理设置无效') }
    }
  }
  try {
    const savedOnly = request.config === undefined
    const config = savedOnly ? loadProxyConfig(configRoot) : resolveProxyConfig(request.config, configRoot)
    const proxyRevision = config.updated_at || 'default'
    const resultOf = (result) => {
      const evidence = { scope: savedOnly ? 'saved_plugin_proxy' : 'draft_plugin_proxy',
        checkedAt: new Date().toISOString(), ...(savedOnly ? { proxyRevision } : {}) }
      if (savedOnly && (request.expectedProxyRevision !== undefined && request.expectedProxyRevision !== proxyRevision
          || JSON.stringify(loadProxyConfig(configRoot)) !== JSON.stringify(config))) {
        return { ...evidence, ok: false, code: 'proxy_config_changed', error: '已保存的插件代理已改变，请重新读取后检测。' }
      }
      return { ...evidence, ...result }
    }
    if (savedOnly && request.expectedProxyRevision !== undefined && request.expectedProxyRevision !== proxyRevision) {
      return resultOf({})
    }
    if (!config.enabled) return resultOf({ ok: false, error: '请先启用插件代理再测试连接' })
    const url = typeof options.testUrl === 'string' && options.testUrl.trim()
      ? options.testUrl.trim()
      : DEFAULT_PROXY_TEST_URL
    if (matchesNoProxy(url, config.noProxy)) {
      return resultOf({ ok: false, error: '测试地址命中直连列表，请移除 api.github.com 后再测试代理' })
    }
    const started = Date.now()
    const result = requestTextWithProxy(url, {
      method: 'GET',
      timeout: 10000,
      headers: {
        'user-agent': 'dsh-purge-proxy-test',
        accept: 'application/json,text/plain;q=0.8,*/*;q=0.5',
      },
    }, config)
    return Promise.resolve(result).then((response) => {
      if (response.statusCode < 200 || response.statusCode >= 400) {
        return resultOf({ ok: false, error: '代理返回 HTTP ' + response.statusCode })
      }
      return resultOf({ ok: true, latencyMs: Date.now() - started, message: '代理连接成功' })
    }, error => resultOf({ ok: false, error: safeError(error, '代理连接失败') }))
      .catch(() => ({ ok: false, code: 'proxy_config_unavailable', error: '无法确认代理配置，请重新读取后检测。' }))
  } catch (error) {
    return { ok: false, error: safeError(error, '代理设置无效') }
  }
}

export default { handleProxyOp, PROXY_SCOPE, DEFAULT_PROXY_TEST_URL }
