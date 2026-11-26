/**
 * 常见设备/服务默认凭据库
 *
 * 收集已知服务、IoT、网络设备的默认凭据。
 * 仅作信息参考，实际校验走 cred-check.js 的真实认证流程。
 */

export const DEFAULT_CREDENTIALS = {
  'admin-panels': [
    { user: 'admin', pass: 'admin' },
    { user: 'admin', pass: 'password' },
    { user: 'admin', pass: '123456' },
    { user: 'admin', pass: '12345678' },
    { user: 'admin', pass: 'admin@123' },
    { user: 'admin', pass: 'Admin@123' },
    { user: 'root', pass: 'root' },
    { user: 'root', pass: '123456' },
    { user: 'guest', pass: 'guest' },
  ],
  'databases': [
    { service: 'mysql', user: 'root', pass: '' },
    { service: 'mysql', user: 'root', pass: 'root' },
    { service: 'mysql', user: 'root', pass: '123456' },
    { service: 'mysql', user: 'mysql', pass: 'mysql' },
    { service: 'mssql', user: 'sa', pass: 'sa' },
    { service: 'mssql', user: 'sa', pass: 'password' },
    { service: 'mssql', user: 'sa', pass: '123456' },
    { service: 'postgresql', user: 'postgres', pass: 'postgres' },
    { service: 'postgresql', user: 'postgres', pass: '' },
    { service: 'redis', user: '', pass: '' },
    { service: 'redis', user: '', pass: 'redis' },
    { service: 'mongodb', user: 'admin', pass: 'admin' },
    { service: 'mongodb', user: '', pass: '' },
  ],
  'network-devices': [
    { device: 'cisco', user: 'admin', pass: 'admin' },
    { device: 'cisco', user: 'admin', pass: 'cisco' },
    { device: 'juniper', user: 'admin', pass: 'admin' },
    { device: 'arista', user: 'admin', pass: 'arista' },
    { device: 'huawei', user: 'admin', pass: 'huawei' },
    { device: 'tenda', user: 'admin', pass: 'admin' },
    { device: 'tplink', user: 'admin', pass: 'admin' },
  ],
  'iot-devices': [
    { device: 'hikvision-cam', user: 'admin', pass: '12345' },
    { device: 'dahua-cam', user: 'admin', pass: 'admin' },
    { device: 'axis-cam', user: 'root', pass: 'pass' },
    { device: 'ubiquiti', user: 'ubnt', pass: 'ubnt' },
    { device: 'reolink', user: 'admin', pass: '123456' },
  ],
  'web-services': [
    { service: 'tomcat', user: 'admin', pass: 'admin' },
    { service: 'tomcat', user: 'tomcat', pass: 'tomcat' },
    { service: 'jenkins', user: 'admin', pass: 'admin' },
    { service: 'grafana', user: 'admin', pass: 'admin' },
    { service: 'prometheus', user: 'admin', pass: 'admin' },
    { service: 'elastic', user: 'elastic', pass: 'changeme' },
    { service: 'kibana', user: 'elastic', pass: 'changeme' },
  ],
  'backup-services': [
    { service: 'backup', user: 'admin', pass: 'backup' },
    { service: 'backup', user: 'backup', pass: 'backup' },
    { service: 'rsync', user: 'admin', pass: 'backup' },
  ],
}

/**
 * 获取指定服务的所有已知凭据
 * @param {string} serviceType - 服务类型，如 'databases', 'network-devices'
 * @param {string} [service] - 可选的具体服务名过滤（如 'mysql'）
 * @returns {Array} 凭据列表
 */
export function getDefaultCredentials(serviceType, service) {
  const creds = DEFAULT_CREDENTIALS[serviceType] || []
  if (!service) return creds
  return creds.filter(c => {
    return (c.service === service) || (c.device === service)
  })
}

/**
 * 检查单个凭据是否在默认库中
 * @param {string} user - 用户名
 * @param {string} pass - 密码
 * @returns {Object|null} 匹配的凭据对象或 null
 */
export function findDefaultCredential(user, pass) {
  for (const category of Object.values(DEFAULT_CREDENTIALS)) {
    const found = category.find(c => c.user === user && c.pass === pass)
    if (found) return found
  }
  return null
}

/**
 * 检查主机/端口是否可能运行指定服务
 * @param {string} host - 目标主机
 * @param {number} port - 端口号
 * @param {string} service - 服务名 ('mysql', 'mssql', etc)
 * @returns {Object} { possible: boolean, reason: string }
 */
export function checkDefaultCredential(host, port, service) {
  const portMap = {
    mysql: [3306],
    mssql: [1433],
    postgresql: [5432],
    redis: [6379],
    mongodb: [27017, 27018],
    ftp: [21],
    ssh: [22],
    http: [80, 8080, 8000],
    https: [443, 8443],
  }
  
  const knownPorts = portMap[service] || []
  const portMatch = knownPorts.includes(port)
  
  return {
    possible: portMatch,
    reason: portMatch 
      ? `${service} typically runs on port ${port}`
      : `port ${port} is unusual for ${service}`,
  }
}

/**
 * 生成针对目标的候选凭据列表
 * @param {string} target - 目标名称（用于社工）
 * @param {string} serviceType - 服务类型
 * @returns {Array} 增强版凭据列表，包含社工变体
 */
export function generateCandidateCredentials(target, serviceType) {
  const base = DEFAULT_CREDENTIALS[serviceType] || []
  const candidates = [...base]
  
  // 简单社工：用目标名作密码
  if (target && target.length > 0 && target.length <= 20) {
    const targetLower = target.toLowerCase()
    candidates.push({ user: 'admin', pass: targetLower })
    candidates.push({ user: 'admin', pass: targetLower + '123' })
    candidates.push({ user: targetLower, pass: targetLower })
  }
  
  // 去重
  const seen = new Set()
  return candidates.filter(c => {
    const key = `${c.user}:${c.pass}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
