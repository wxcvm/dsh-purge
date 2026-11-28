import { createConnection, isIP } from 'node:net'

export function parseLoopbackSocks5Listen(value) {
  const match = String(value || '').trim().match(/^(127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{0,4})$/i)
  if (!match) throw new Error('tunnel.listen must be a loopback SOCKS5 host:port')
  const port = Number(match[2])
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('invalid SOCKS5 listen port')
  return { host: match[1].toLowerCase() === '[::1]' ? '::1' : '127.0.0.1', port }
}

export function probeSocks5Connect(proxy, targetIp, targetPort, timeoutMs = 3000) {
  const proxyHost = String(proxy?.host || '')
  const proxyPort = Number(proxy?.port)
  if (!['127.0.0.1', '::1'].includes(proxyHost) || !Number.isSafeInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535)
    throw new Error('SOCKS5 proxy must be a validated loopback listener')
  if (isIP(String(targetIp || '')) !== 4) throw new Error('pivot target must be a registered IPv4 asset')
  const port = Number(targetPort)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('pivot target port must be an integer from 1 to 65535')
  const timeout = Number(timeoutMs)
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 5000) throw new Error('pivot probe timeout must be between 1000 and 5000 ms')

  return new Promise(resolve => {
    const startedAt = Date.now()
    const socket = createConnection({ host: proxyHost, port: proxyPort })
    let stage = 'greeting'
    let buffer = Buffer.alloc(0)
    let done = false
    const finish = (ok, error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      const result = { ok, latency_ms: Date.now() - startedAt }
      if (error) result.error = error
      socket.destroy()
      resolve(result)
    }

    const timer = setTimeout(() => finish(false, 'timeout'), timeout)
    socket.once('error', error => finish(false, String(error.code || error.message || error)))
    socket.once('connect', () => socket.write(Buffer.from([5, 1, 0])))
    socket.on('data', chunk => {
      if (buffer.length + chunk.length > 64) return finish(false, 'oversized_socks5_reply')
      buffer = Buffer.concat([buffer, chunk])
      if (stage === 'greeting') {
        if (buffer.length < 2) return
        const version = buffer[0]
        const method = buffer[1]
        buffer = Buffer.alloc(0)
        if (version !== 5 || method !== 0) return finish(false, 'no_auth_method_not_accepted')
        const octets = targetIp.split('.').map(Number)
        const request = Buffer.alloc(10)
        request[0] = 5
        request[1] = 1
        request[2] = 0
        request[3] = 1
        request[4] = octets[0]
        request[5] = octets[1]
        request[6] = octets[2]
        request[7] = octets[3]
        request.writeUInt16BE(port, 8)
        stage = 'connect'
        socket.write(request)
        return
      }
      if (stage === 'connect') {
        if (buffer.length < 2) return
        const version = buffer[0]
        const reply = buffer[1]
        if (version !== 5) return finish(false, 'invalid_socks5_reply')
        if (reply !== 0) return finish(false, `socks5_connect_rejected_${reply}`)
        if (buffer.length < 4) return
        if (buffer[2] !== 0) return finish(false, 'invalid_socks5_reply')
        const addressType = buffer[3]
        let responseLength
        if (addressType === 1) responseLength = 10
        else if (addressType === 4) responseLength = 22
        else if (addressType === 3) {
          if (buffer.length < 5) return
          if (buffer[4] < 1) return finish(false, 'invalid_socks5_reply')
          responseLength = 7 + buffer[4]
        } else return finish(false, 'invalid_socks5_reply')
        if (buffer.length < responseLength) return
        return finish(true)
      }
    })
    socket.once('close', () => {
      if (!done) finish(false, 'closed')
    })
  })
}
