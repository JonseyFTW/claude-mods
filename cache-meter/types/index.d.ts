export type CacheSnapshot = {
  at: number
  read: number
  written: number
  uncached: number
  output: number
}

declare module 'claude-code' {
  interface PluginState {
    'cache-meter': { last: CacheSnapshot | null; now: number }
  }
}
