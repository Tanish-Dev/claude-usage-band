export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type ContextFill = { window: number; tokens?: number; percent?: number }

export type Reading = {
  limits: Limit[]
  context?: ContextFill
  costUsd?: number
  startedAt?: number
}

export type Mode = 'compact' | 'full' | 'hidden'

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      reading: Reading | null
      mode: Mode
      tick: number
      alerted: Record<string, number>
    }
  }
}
