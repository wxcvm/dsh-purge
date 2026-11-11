/**
 * Optional VMware/SSH Kali VM connection profile.
 * Stores SSH destination + key FILE PATH only, never password or key contents.
 */
export function normalizeKaliVm(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    host: typeof source.host === 'string' ? source.host.trim() : '',
    user: typeof source.user === 'string' ? source.user.trim() : 'kali',
    port: source.port === '' || source.port === undefined || source.port === null
      ? 22 : Number(source.port),
    identityFile: typeof source.identityFile === 'string' ? source.identityFile.trim() : '',
  }
}

export function validateKaliVm(value) {
  const vm = normalizeKaliVm(value)
  // Host can be an IPv4 address, DNS name, or safe OpenSSH Host alias.
  // Reject whitespace, shell metacharacters and option-like leading dashes.
  if (vm.host && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/.test(vm.host)) {
    return 'SSH 主机地址只能填写 IPv4、主机名或安全的 SSH 别名'
  }
  if (vm.host && !/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(vm.user)) {
    return 'SSH 用户名无效'
  }
  if (!Number.isInteger(vm.port) || vm.port < 1 || vm.port > 65535) {
    return 'SSH 端口应为 1-65535'
  }
  if (/[\u0000-\u001f]/.test(vm.identityFile) || vm.identityFile.startsWith('-')) {
    return 'SSH 私钥路径无效'
  }
  return null
}
