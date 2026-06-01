import type { RemoteModule } from '../interfaces/RemoteModule'

/**
 * 模块级单例：已加载的联邦模块注册表。
 * 由 loadFederation 在加载成功后调用 registerRemote 注入；
 * 由 resolveLayout / mf.load 通过 getLoadedRemote 查询。
 */
const remotes = new Map<string, RemoteModule>()

export function registerRemote(remote: RemoteModule): void {
  remotes.set(remote.name, remote)
}

export function getLoadedRemote(name: string): RemoteModule | undefined {
  return remotes.get(name)
}

export function listLoadedRemotes(): RemoteModule[] {
  return [...remotes.values()]
}

/** 仅用于测试 / dev 场景重置注册表。 */
export function _resetRemoteRegistry(): void {
  remotes.clear()
}
