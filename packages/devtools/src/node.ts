import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { exec } from 'node:child_process'
import { Service, type Context } from 'cordis'
import { WebSocketServer } from 'ws'
import type { ViteDevServer } from 'vite'
import { Devtools } from './base.js'
import type { Entry } from './entry.js'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

export interface NodeDevtoolsConfig {
  /** HTTP/WS port. Default 9123. */
  port?: number
  /** Auto-open browser. Default false. */
  open?: boolean
  /** dev (Vite middleware) vs prod (serve dist). Default `process.env.NODE_ENV !== 'production'`. */
  devMode?: boolean
}

/**
 * Node implementation: HTTP server for the SPA + `/@fs/` for panel entry
 * sources (dev) or `dist/` chunks (prod) + WebSocket upgrade.
 *
 * Closely mirrors `webui-main/plugins/webui/src/index.ts` but trimmed: no
 * production manifest pipeline / vendor chunking. Single client SPA, panels
 * are workspace-local.
 */
export class NodeDevtools extends Devtools {
  private http?: Server
  private wss?: WebSocketServer
  private vite?: ViteDevServer

  private clientRoot: string
  private devMode: boolean

  constructor(public override ctx: Context, public config: NodeDevtoolsConfig = {}) {
    super(ctx)
    this.devMode = config.devMode ?? process.env['NODE_ENV'] !== 'production'

    const require = createRequire(import.meta.url)
    const pkgPath = require.resolve('@maho/devtools-client/package.json')
    this.clientRoot = dirname(pkgPath)
  }

  getEntryFiles(entry: Entry): string[] {
    const filename = fileURLToPath(new URL(entry.files.source, entry.files.baseUrl))
    // Same URL format both modes: `/@fs/<absolute>`. In dev, Vite middleware
    // resolves it; in prod, this URL is rarely needed because panel client
    // bundles are already statically imported by the SPA build.
    const norm = filename.replace(/\\/g, '/')
    return [`/@fs/${norm.startsWith('/') ? norm.slice(1) : norm}`]
  }

  async [Service.init](): Promise<void> {
    const port = this.config.port ?? 9123

    if (this.devMode) {
      await this.createVite()
    }

    this.http = createHttpServer((req, res) => {
      this.handleRequest(req, res).catch((err: Error) => {
        const logger = (this.ctx as { logger?: { warn?: (m: string) => void } }).logger
        logger?.warn?.(`[devtools] request error: ${err.message}`)
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'text/plain' })
          res.end('Internal error')
        }
      })
    })

    this.wss = new WebSocketServer({ noServer: true })
    this.http.on('upgrade', (req, socket, head) => {
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.accept(ws)
      })
    })

    await new Promise<void>((resolveListen, reject) => {
      this.http!.once('error', reject)
      this.http!.listen(port, () => resolveListen())
    })

    const url = `http://127.0.0.1:${port}/`
    const logger = (this.ctx as { logger?: { info?: (m: string) => void } }).logger
    logger?.info?.(`[devtools] running at ${url}`)

    if (this.config.open) {
      openUrl(url)
    }

    this.ctx.effect(() => () => {
      this.wss?.close()
      this.http?.close()
      void this.vite?.close()
    }, 'NodeDevtools.start()')
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.vite) {
      // SPA shell is OUR responsibility — Vite in middleware mode + appType
      // 'custom' refuses to serve index.html. Serve shell on navigation
      // requests; everything else (`/src/...`, `/@fs/...`, modules) goes to
      // Vite. We do NOT fall back to shell if Vite errors — that would mask
      // genuine module errors with a 200 + HTML response.
      const url = req.url ?? '/'
      const pathname = url.split('?')[0] ?? '/'
      if (this.isShellRoute(pathname)) {
        await this.serveSpaShell(res)
        return
      }
      this.vite.middlewares(req, res, () => {
        if (res.headersSent || res.writableEnded) return
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('Not found')
      })
      return
    }

    const distDir = join(this.clientRoot, 'dist')
    let pathname = (req.url ?? '/').split('?')[0] ?? '/'
    if (pathname === '/') pathname = '/index.html'

    const filePath = join(distDir, pathname)
    if (filePath.startsWith(distDir) && existsSync(filePath)) {
      const ext = extname(filePath)
      const body = await readFile(filePath)
      res.writeHead(200, {
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'cache-control': pathname === '/index.html' ? 'no-store' : 'public, max-age=3600',
      })
      res.end(body)
      return
    }

    await this.serveSpaShell(res)
  }

  /**
   * Returns true when a path should be answered with the SPA shell
   * (transformed `index.html`) instead of being routed through Vite. Treat
   * anything that looks like a navigation request — '/', no extension, not
   * a vite internal — as a shell route.
   */
  private isShellRoute(pathname: string): boolean {
    if (pathname === '/' || pathname === '/index.html') return true
    if (pathname.startsWith('/@')) return false        // /@fs, /@vite, /@id
    if (pathname.startsWith('/node_modules/')) return false
    if (pathname.startsWith('/src/')) return false
    if (pathname.startsWith('/__inspect')) return false
    return !/\.[a-zA-Z0-9]+$/.test(pathname)
  }

  private async serveSpaShell(res: ServerResponse): Promise<void> {
    if (this.vite) {
      const indexPath = join(this.clientRoot, 'index.html')
      let html = await readFile(indexPath, 'utf-8')
      html = await this.vite.transformIndexHtml('/', html)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    const indexPath = join(this.clientRoot, 'dist', 'index.html')
    if (existsSync(indexPath)) {
      const html = await readFile(indexPath, 'utf-8')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('Devtools client not built. Run `pnpm --filter @maho/devtools-client build`.')
  }

  private async createVite(): Promise<void> {
    const { createServer } = await import('vite')
    const vue = (await import('@vitejs/plugin-vue')).default

    this.vite = await createServer({
      root: this.clientRoot,
      // Disable auto-loaded `vite.config.ts` — the devtools-client config also
      // registers @vitejs/plugin-vue, which would run twice and try to parse
      // plugin-vue's own JS output as another SFC.
      configFile: false,
      server: {
        middlewareMode: true,
        fs: { allow: [resolve(this.clientRoot, '..', '..')] },
      },
      plugins: [vue()],
      appType: 'custom',
    })
  }
}

function openUrl(url: string): void {
  const platform = process.platform
  if (platform === 'win32') exec(`start "" "${url}"`)
  else if (platform === 'darwin') exec(`open "${url}"`)
  else exec(`xdg-open "${url}"`)
}
