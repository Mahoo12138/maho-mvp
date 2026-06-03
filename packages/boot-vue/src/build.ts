import vue from '@vitejs/plugin-vue'
import type {
  BootBuildAdapter,
  BootSharedDepsMap,
  VitePluginLike,
} from '@maho/boot'

const sharedDeps: BootSharedDepsMap = {
  vue: { singleton: true, requiredVersion: '^3.4.0' },
  'vue-router': { singleton: true, requiredVersion: '^4.3.0' },
  pinia: { singleton: true, requiredVersion: '^2.1.0' },
}

const vueBuildAdapter: BootBuildAdapter = {
  framework: 'vue',
  sharedDeps,
  getVitePlugins(): VitePluginLike[] {
    const plugin = vue() as unknown as VitePluginLike | VitePluginLike[]
    return Array.isArray(plugin) ? plugin : [plugin]
  },
}

export default vueBuildAdapter
export { sharedDeps }
