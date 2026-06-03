declare module 'virtual:maho-config' {
  import type { MahoStaticConfig } from './interfaces/MahoStaticConfig'
  const config: MahoStaticConfig
  export default config

  /** host 的 shared singleton shareScope，传给 remote 的 init()。 */
  export const shareScope: Record<
    string,
    Record<string, { get: () => Promise<any> }>
  >
}
