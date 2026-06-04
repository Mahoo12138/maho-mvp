export function extractMethods(data: unknown): string[] {
  if (!data || typeof data !== 'object') return []
  return Object.keys(data as Record<string, unknown>).filter(
    (k) => typeof (data as Record<string, unknown>)[k] === 'function',
  )
}

export function stripMethods<T>(data: T): T {
  if (!data || typeof data !== 'object') return data
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (typeof v === 'function') continue
    out[k] = v
  }
  return out as T
}
