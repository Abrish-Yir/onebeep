// Minimal zero-dependency static server for the built Onebeep app.
// EthioDeploy runs this as the project's start script; it must bind
// 0.0.0.0 and read PORT. Serves ./dist and falls back to index.html.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = join(__dirname, 'dist')
const PORT = process.env.PORT || 3000
const HOST = '0.0.0.0'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    let pathname = decodeURIComponent(url.pathname)
    if (pathname.endsWith('/')) pathname += 'index.html'

    let filePath = normalize(join(DIST, pathname))
    if (filePath !== DIST && !filePath.startsWith(DIST + sep)) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    let data
    try {
      const info = await stat(filePath)
      if (info.isDirectory()) filePath = join(filePath, 'index.html')
      data = await readFile(filePath)
    } catch {
      // Single-page fallback.
      filePath = join(DIST, 'index.html')
      data = await readFile(filePath)
    }

    res.setHeader(
      'Content-Type',
      MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
    )
    res.setHeader(
      'Cache-Control',
      filePath.endsWith('index.html')
        ? 'no-cache'
        : 'public, max-age=31536000, immutable'
    )
    res.statusCode = 200
    if (req.method === 'HEAD') res.end()
    else res.end(data)
  } catch {
    res.statusCode = 500
    res.end('Internal Server Error')
  }
})

server.listen(PORT, HOST, () => {
  console.log(`onebeep serving dist on http://${HOST}:${PORT}`)
})
