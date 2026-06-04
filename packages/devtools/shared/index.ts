export interface EntryFiles {
  /** Conventionally `import.meta.url` of the registering plugin. */
  baseUrl: string
  /** Client entry path (a `.ts` / `.js` file), relative to `baseUrl`. */
  source: string
  /** Route patterns this entry registers, e.g. `/config`. */
  routes?: string[]
}

export interface EntryData {
  /** Concrete URLs the client should `import()`, in order. */
  files: string[]
  /** Snapshot of the panel's reactive data. Methods are stripped. */
  data: unknown
  /** Names of `data` properties that are functions — exposed as RPC. */
  methods: string[]
}

export interface EntryInit {
  /** Server build/version tag. Client reloads when it changes. */
  version: string
  /** `null` means dispose. */
  entries: Record<string, EntryData | null>
}

export interface RpcRequest {
  sn: number
  entryId: string
  method: string
  args: unknown[]
}

export interface RpcResponse {
  sn: number
  ok: boolean
  value?: unknown
  message?: string
}

export type ServerMessage =
  | { type: 'entry:init'; body: EntryInit }
  | { type: 'rpc:response'; body: RpcResponse }
  | { type: 'pong'; body?: Record<string, never> }

export type ClientMessage =
  | { type: 'rpc:request'; body: RpcRequest }
  | { type: 'ping'; body?: Record<string, never> }

// ── Panel data shapes ───────────────────────────────────────────────
// Type-only contracts shared by the server panel impl and the client
// Vue component. Kept in `shared/` so the client doesn't transitively
// pull in `@maho/core` (Node) types when it reads them.

export interface ConfigPanelData {
  base: unknown
  current: unknown
  resolved: unknown
  mode: string
  reload(): Promise<void>
}
