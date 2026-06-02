export type MahoErrorCode =
  | 'workspace-not-found'
  | 'wrong-directory'
  | 'no-port'
  | 'bin-not-found'
  | 'no-vite-config'
  | 'config-invalid'
  | 'app-not-found'

/**
 * CLI 专用错误。CLI 顶层 handler 见到 MahoError 时只打 message + exit 1；
 * 其他错误打完整 stack（视作未预期 bug）。
 */
export class MahoError extends Error {
  constructor(
    public readonly code: MahoErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'MahoError'
  }
}
