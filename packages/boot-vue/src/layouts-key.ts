import type { InjectionKey } from 'vue'
import type { ResolvedLayoutMap } from '@maho/boot'

/**
 * provide/inject 共享布局映射的 Symbol。
 * adapter.createApp 时 provide，LayoutOutlet inject。
 */
export const LAYOUTS_KEY: InjectionKey<ResolvedLayoutMap> = Symbol('maho:layouts')
