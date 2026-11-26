import { createPreview } from '../../tools/superagent-preview/server.mjs'

// Leave an ordinary document check pending so the parent can terminate this
// child before a result is emitted; never touches the installed workstation.
const app = createPreview({ dataDir: process.argv[2], checkDocument: () => new Promise(() => {}) })
app.listen(0, '127.0.0.1', () => process.send({ port: app.address().port }))
