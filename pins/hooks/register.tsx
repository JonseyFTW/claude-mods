import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pin, PinKind, PinOwner, PinStatus } from '../types'

const PANE = 'pins'
const TOOL = 'mcp__pins__update'
const MAX_LINKS = 12
const ITEMS = { plugin: 'pins', key: 'items' } as const
const items = atom(ITEMS, [])
// The decision the user clicked in the pane, cleared once they submit an answer
const answering = atom({ plugin: 'pins', key: 'answering' } as const, null)
// Prompts a person typed (terminal, phone, desktop); notifications, peers and plugins never answer a decision
const PERSON = new Set(['composer', 'bridge', 'sdk'])
// Set once the Stop check has asked Claude about its open todos; cleared by the next prompt, so it asks at most once per turn
const nudged = atom({ plugin: 'pins', key: 'nudged' } as const, false)
// Pasted blocks are not the user's own words, so they never answer a decision
const PASTED = /<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g

type AddInput = { kind: PinKind; text: string; url?: string; owner?: PinOwner }

// ponytail: ids are kind letter + next number; built-in todos use tw<n>/task<taskId> (non-numeric after the letter) so they never collide
const nextId = (list: Pin[], kind: PinKind) =>
  kind[0] + (Math.max(0, ...list.filter(p => p.id[0] === kind[0]).map(p => Number(p.id.slice(1)) || 0)) + 1)

const capLinks = (list: Pin[]) => {
  const links = list.filter(p => p.kind === 'link')
  const drop = new Set(links.slice(0, Math.max(0, links.length - MAX_LINKS)).map(p => p.id))
  return list.filter(p => !drop.has(p.id))
}

const boardText = (list: Pin[]) =>
  list.length === 0
    ? '(empty)'
    : list.map(p => `- [${p.id}] ${p.owner === 'claude' ? 'claude ' : ''}${p.kind}${p.status ? ` (${p.status})` : ''}: ${p.text}${p.url ? ` <${p.url}>` : ''}`).join('\n')

// The board is saved per project folder. Built-in task todos (tw*/task*) belong to one session, so they are not saved.
const boardKey = async ($: EngineInterface) => `board:${(await $.session.root()).toLowerCase()}`

const change = async ($: EngineInterface, fn: (old: Pin[]) => Pin[]) => {
  const list = await update($, items, fn)
  await $.store.set(await boardKey($), list.filter(p => /^[dtl]\d+$/.test(p.id)))
  return list
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pins', description: 'Show open decisions, todos and links' })
    // session.start also fires on hot reload; only load the saved board into a fresh session
    if ((await $.state.get(ITEMS)).version === 0) {
      const saved = (await $.store.get(await boardKey($))) as Pin[] | undefined
      if (saved?.length) await $.state.set(ITEMS, saved)
    }
    await $.tool.register({
      name: 'update',
      description:
        'Update the pins pane the user sees beside the chat. Add a decision when you need an answer or choice from the user; ' +
        'remove it once they answer. Add links the user will want later (PRs, artifacts, docs, tickets). ' +
        'Add todos the user owns that are not in your task list. Remove items by id when done or stale. ' +
        'Mark a todo done with `done` in the same turn you finish it; remove a decision as soon as the user answers it. ' +
        'Set `owner: "claude"` on a todo for work you will do yourself; leave owner as "user" for actions the user takes. ' +
        'When TodoWrite is available, track your own work there instead of adding owner "claude" todos: the pane already ' +
        'mirrors TodoWrite and clears finished items itself. Owner "claude" todos are the fallback when TodoWrite is not available.',
      inputSchema: {
        type: 'object',
        properties: {
          add: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { enum: ['decision', 'todo', 'link'] },
                text: { type: 'string', description: 'One short line' },
                url: { type: 'string', description: 'Required for links' },
                owner: { enum: ['user', 'claude'], description: 'Todos only: who does it; "user" when left out' },
              },
              required: ['kind', 'text'],
            },
          },
          remove: { type: 'array', items: { type: 'string' }, description: 'Ids to remove' },
          done: { type: 'array', items: { type: 'string' }, description: 'Todo ids finished; shown as done, removed when the turn ends' },
        },
      },
    })
    return next(e)
  })

  // 'pins:pins' is commands/pins.md, there so the desktop menu lists it before session.start registers 'pins'
  for (const command of ['pins', 'pins:pins'])
    on('command.run', { command }, async $ => {
      await $.ui.open({ id: PANE, title: 'Pins' })
      return { text: 'Pins pane opened.' }
    })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as { add?: AddInput[]; remove?: string[]; done?: string[] }
    const gone = new Set(input.remove ?? [])
    const done = new Set(input.done ?? [])
    const wasEmpty = (await read($, items)).length === 0
    const list = await change($, old => {
      let out = old
        .filter(p => !gone.has(p.id))
        .map(p => (p.kind === 'todo' && done.has(p.id) ? { ...p, status: 'completed' as const } : p))
      for (const a of input.add ?? []) {
        if (a.kind === 'link' && !a.url) continue
        const owner = a.kind === 'todo' ? (a.owner === 'claude' ? 'claude' : 'user') : undefined
        out = [...out, { id: nextId(out, a.kind), kind: a.kind, text: a.text, url: a.url, owner }]
      }
      return capLinks(out)
    })
    // ponytail: auto-open is best effort; /pins opens it on demand
    if (wasEmpty && list.length > 0) $.ui.open({ id: PANE, title: 'Pins' }).catch(() => {})
    return { result: `Board now:\n${boardText(list)}` }
  })

  // Built-in todo tools feed the Todos section automatically.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) {
      const todos: Pin[] = e.todos.map((t, i) => ({ id: `tw${i + 1}`, kind: 'todo', text: t.content, status: t.status }))
      // ponytail: TodoWrite resends finished items every call; a completed one stays only while its pin is still on the board,
      // so one cleared at turn.complete does not come back
      await change($, old => {
        const shown = new Set(old.filter(p => p.id.startsWith('tw')).map(p => p.text))
        return [...old.filter(p => !p.id.startsWith('tw')), ...todos.filter(t => t.status !== 'completed' || shown.has(t.text))]
      })
    }
    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const task = (ran.result as { task?: { id: string; subject: string } } | undefined)?.task
    if (task) {
      await change($, old => [...old, { id: `task${task.id}`, kind: 'todo', text: task.subject, status: 'pending' }])
    }
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) {
      const id = `task${e.taskId}`
      const { status, subject } = e
      await change($, old =>
        status === 'deleted'
          ? old.filter(p => p.id !== id)
          : old.map(p => (p.id === id ? { ...p, text: subject ?? p.text, status: (status as PinStatus | undefined) ?? p.status } : p)),
      )
    }
    return ran
  })

  // Every request carries the board, so Claude knows what is still open.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const list = await read($, items)
    const text =
      `The user has a Pins pane beside the chat with open decisions, todos and links. Keep it current with ${TOOL}. ` +
      'When you end a turn asking the user a question or for a choice only they can make, pin it as a decision. ' +
      'When the user answers, remove that decision. Pin URLs you create or that the user will want later as links. ' +
      "At the start of each turn, if the user's message answers an open decision, remove it before doing anything else. " +
      'When you finish a pinned todo, mark it done in that same turn, not later.\n' +
      `Current board:\n${boardText(list)}`
    return { sections: [...composed.sections, { id: 'pins:board', scope: 'session', text }] }
  })

  // A submitted answer clears its decision: the one clicked in the pane, one quoted ("> text"), or one named by id ("d1").
  // ponytail: removed before next(e) so the turn's first request already sees the board without it; put back if the prompt is dropped
  on('prompt.submit', async ($, e, next) => {
    await update($, nudged, () => false)
    if (!e.text.trim() || !PERSON.has(e.origin.kind)) return next(e)
    const typed = e.text.replace(PASTED, '')
    const clicked = await read($, answering)
    const quoted = new Set(typed.split('\n').filter(l => l.startsWith('> ')).map(l => l.slice(2).trim()))
    const named = new Set(typed.match(/\bd\d+\b/g) ?? [])
    const answered = (await read($, items)).filter(
      p => p.kind === 'decision' && (p.id === clicked || quoted.has(p.text.trim()) || named.has(p.id)),
    )
    const ids = new Set(answered.map(p => p.id))
    if (ids.size) await change($, old => old.filter(p => !ids.has(p.id)))
    const entered = await next(e)
    if (entered.drop !== undefined) {
      if (ids.size) await change($, old => [...old, ...answered.filter(a => !old.some(p => p.id === a.id))])
      return entered
    }
    if (clicked !== null) await update($, answering, () => null)
    return entered
  })

  // Finished todos show ✓ for the rest of the turn they finished in, then leave.
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && (await read($, items)).some(p => p.status === 'completed'))
      await change($, old => old.filter(p => p.status !== 'completed'))
    return next(e)
  })

  // Claude's own todos don't rely on its memory: before the turn ends, it is asked once about the ones still open.
  // ponytail: at most one block per turn (nudged resets on the next prompt); a second Stop always passes, so no loops
  on('classic.Stop', async ($, e, next) => {
    const ran = await next(e)
    if (ran.block !== undefined || (await read($, nudged))) return ran
    const open = (await read($, items)).filter(p => p.kind === 'todo' && p.owner === 'claude' && p.status !== 'completed')
    if (open.length === 0) return ran
    await update($, nudged, () => true)
    const block =
      `Your pinned todos are still open:\n${open.map(p => `- [${p.id}] ${p.text}`).join('\n')}\n` +
      `For each one you finished, call ${TOOL} with \`done\` listing its id. Leave unfinished ones open; nothing else is needed.`
    return { ...ran, block }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const list = await read($, items)
    const dismiss = (id: string) => change($, old => old.filter(p => p.id !== id))
    // Clicking a decision quotes it into the prompt box; the clipboard is the fallback where the box refuses (e.g. a dialog is up)
    const answer = async (p: Pin, surface: string) => {
      await update($, answering, () => p.id)
      const filled = await $.prompt.fill({ text: `> ${p.text}\n\n`, mode: 'insert' })
      if (filled.isFilled) return
      const copied = await $.ui.copy({ text: p.text, surface })
      if (copied.isCopied) await $.ui.toast('Decision copied — paste it into the prompt')
    }

    const row = (p: Pin) => (
      <Box key={p.id} flexDirection="row" gap={1}>
        <Button key={`x-${p.id}`} label="x" plain onPress={() => dismiss(p.id)} />
        {p.kind === 'todo' && <Text>{p.status === 'completed' ? '✓' : p.status === 'in_progress' ? '▸' : '○'}</Text>}
        {p.owner === 'claude' && <Text dimColor>[c]</Text>}
        {p.kind === 'link' && p.url ? (
          <Link href={p.url}>{p.text}</Link>
        ) : p.kind === 'decision' ? (
          <Button key={`a-${p.id}`} label={p.text} plain onPress={press => answer(p, press.surface)} />
        ) : (
          <Text dimColor={p.status === 'completed'} wrap="wrap">
            {p.text}
          </Text>
        )}
      </Box>
    )

    const section = (kind: PinKind, title: string) => {
      const group = list.filter(p => p.kind === kind)
      return (
        <Box key={kind} flexDirection="column" marginBottom={1}>
          <Text bold>
            {title} ({group.filter(p => p.status !== 'completed').length})
          </Text>
          {group.length === 0 ? <Text dimColor>none</Text> : group.map(row)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {section('decision', 'Open decisions')}
        {section('todo', 'Todos')}
        {section('link', 'Links')}
      </Box>
    )
  })
}
