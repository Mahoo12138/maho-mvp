import { createServer } from 'node:net'
import { MahoError } from '../utils/errors'

/**
 * 检测端口在 127.0.0.1 上是否可绑定。
 * 仅用 IPv4 loopback —— IPv6 双栈在 Windows 上常导致误判已占用。
 */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

/**
 * 从 preferred 开始顺序探测可用端口，最多探测 range 个。
 */
export async function allocatePort(preferred: number, range = 20): Promise<number> {
  for (let port = preferred; port < preferred + range; port++) {
    if (await isPortAvailable(port)) return port
  }
  throw new MahoError(
    'no-port',
    `No available port in range ${preferred}–${preferred + range - 1}. Close other dev servers and retry.`,
  )
}
