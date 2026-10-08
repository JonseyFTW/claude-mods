export type PinKind = 'decision' | 'todo' | 'link'
export type PinStatus = 'pending' | 'in_progress' | 'completed'
export type Pin = { id: string; kind: PinKind; text: string; url?: string; status?: PinStatus }

declare module 'claude-code' {
  interface PluginState {
    pins: { items: Pin[]; answering: string | null }
  }
}
