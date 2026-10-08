import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CacheSnapshot } from '../types'

// Claude Code subscriptions use a 1-hour prompt-cache TTL; each request that reads the cache restarts it.
const TTL_MS = 60 * 60 * 1000
const BAR_CELLS = 20

const last = atom({ plugin: 'cache-meter', key: 'last' } as const, null)
const now = atom({ plugin: 'cache-meter', key: 'now' } as const, 0)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await $.clock.now()
    await update($, now, () => started)
    $.clock.every(30_000, async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && e.usage) {
      const at = await $.clock.now()
      const snap: CacheSnapshot = {
        at,
        read: e.usage.cache_read_input_tokens,
        written: e.usage.cache_creation_input_tokens,
        uncached: e.usage.input_tokens,
        output: e.usage.output_tokens,
      }
      await update($, last, () => snap)
      await update($, now, () => at)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const snap = await read($, last)

    if (snap === null) {
      return (
        <Box>
          <Text dimColor>○ cache cold · first prompt writes the cache</Text>
        </Box>
      )
    }

    const t = await read($, now)
    const leftMs = TTL_MS - (t - snap.at)
    const input = snap.read + snap.written + snap.uncached
    const hit = input > 0 ? Math.round((snap.read / input) * 100) : 0
    const context = Math.round((input + snap.output) / 1000)

    if (e.props.isWorking || leftMs > 0) {
      const minutes = Math.max(0, Math.ceil(leftMs / 60_000))
      const filled = Math.round((Math.max(0, leftMs) / TTL_MS) * BAR_CELLS)
      const color = minutes > 10 ? 'green' : 'yellow'

      return (
        <Box>
          <Text color={color}>● cache warm </Text>
          <Text color={color}>{minutes}m left </Text>
          <Text color={color}>{'■'.repeat(filled)}</Text>
          <Text dimColor>{'□'.repeat(BAR_CELLS - filled)}</Text>
          <Text dimColor> last turn {hit}% hit · {context}k ctx</Text>
        </Box>
      )
    }

    return (
      <Box>
        <Text color="red">○ cache cold </Text>
        <Text dimColor>· next prompt re-writes ~{context}k tokens (consider /compact or /clear first)</Text>
      </Box>
    )
  })
}
