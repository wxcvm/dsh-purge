import { parentPort, workerData } from 'node:worker_threads'

const lines = workerData.split(/\r?\n/)
let fence = null, title = false, appendix = false
for (const line of lines) {
  const marker = /^ {0,3}(\x60{3,}|~{3,})(.*)$/.exec(line)
  if (marker) {
    if (!fence) fence = marker[1]
    else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null
    continue
  }
  if (fence) continue
  if (/^ {0,3}#\s+\S/.test(line)) title = true
  if (/^ {0,3}#{1,6}\s+(?:附录|appendix)(?:\s|[：:]|$)/i.test(line)) appendix = true
}
parentPort.postMessage({ title, appendix })