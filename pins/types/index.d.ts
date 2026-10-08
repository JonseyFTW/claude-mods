export type PinKind = 'decision' | 'todo' | 'link'
export type PinStatus = 'pending' | 'in_progress' | 'completed'
// A todo's owner: 'user' for actions the user takes, 'claude' for work Claude does; absent reads as 'user'
export type PinOwner = 'user' | 'claude'
export type Pin = { id: string; kind: PinKind; text: string; url?: string; status?: PinStatus; owner?: PinOwner }

declare module 'claude-code' {
  interface PluginState {
    pins: { items: Pin[]; answering: string | null; nudged: boolean }
  }
}
