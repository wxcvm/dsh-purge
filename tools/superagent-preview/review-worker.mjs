import { parentPort, threadId, workerData } from 'node:worker_threads'
const start = performance.now()
const { check, text } = workerData
if (check !== 'heading' && check !== 'appendix') throw Error('不支持的文档检查')

const lines = text.split(/\r?\n/)
let fence = null, found = false
const pattern = check === 'heading' ? /^ {0,3}#\s+\S/ : /^ {0,3}#{1,6}\s+(?:附录|appendix)(?:\s|[：:]|$)/i
for (const line of lines) {
  const marker = /^ {0,3}(\x60{3,}|~{3,})(.*)$/.exec(line)
  if (marker) {
    if (!fence) fence = marker[1]
    else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null
    continue
  }
  if (fence) continue
  if (pattern.test(line)) { found = true; break }
}
parentPort.postMessage({ found, threadId, ms: performance.now() - start })
