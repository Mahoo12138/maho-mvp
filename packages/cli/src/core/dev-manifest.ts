export interface DevTargetMeta {
  name: string
  port: number
}

/**
 * 生成 vite-plugin 期望的 MAHO_DEV_REMOTES 环境变量内容。
 * 反序列化端在 packages/vite-plugin/src/utils/resolve-options.ts:readDevRemotesFromEnv。
 * 格式：`[{"name":"x","entry":"http://localhost:PORT/remoteEntry.js"}]`
 */
export function buildDevManifestEnv(remotes: DevTargetMeta[]): string {
  return JSON.stringify(
    remotes.map((t) => ({
      name: t.name,
      entry: `http://localhost:${t.port}/remoteEntry.js`,
    })),
  )
}
