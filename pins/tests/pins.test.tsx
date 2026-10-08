import { expect, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'pins', props: { title: 'Pins', isFocused: false, bodyColumns: 40, placement: 'dock' } } as const

test('board adds, removes, captures TodoWrite and draws on every surface', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  on('session.root', () => ({ value: 'C:\\Proj' }))
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))

  const added = await $.tool.call({
    tool: 'mcp__pins__update',
    add: [
      { kind: 'decision', text: 'Which DB?' },
      { kind: 'link', text: 'missing url' },
      { kind: 'link', text: 'PR', url: 'https://example.com/pr/1' },
    ],
  })
  expect(added.result).toBe('Board now:\n- [d1] decision: Which DB?\n- [l1] link: PR <https://example.com/pr/1>')

  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Write docs', status: 'in_progress', activeForm: 'Writing docs' }] })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'pins', surface, ...PANE })
    expect(await ui.find({ type: 'Button', key: 'a-d1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Write docs/ })).toBeDefined()
    await ui.unmount()
  }

  const removed = await $.tool.call({ tool: 'mcp__pins__update', remove: ['d1'] })
  expect(removed.result).toBe('Board now:\n- [l1] link: PR <https://example.com/pr/1>\n- [tw1] todo (in_progress): Write docs')

  // saved under the project folder, without the session-only TodoWrite item
  const saved = store.get('board:c:\\proj') as { id: string }[]
  expect(saved.map(p => p.id)).toEqual(['l1'])
})

test('clicking a decision quotes it into the prompt box, or copies it when the box refuses', async ($, on) => {
  on('session.root', () => ({ value: 'C:\Proj' }))
  on('store.set', () => ({ value: undefined }))
  const filled: string[] = []
  let boxTakes = true
  on('prompt.fill', (_$, e) => (filled.push(e.text), boxTakes ? { isFilled: true } : { isFilled: false, refusal: 'dialog' as const }))
  const copied: string[] = []
  on('ui.copy', (_$, e) => (copied.push(e.text), { value: { isCopied: true } }))

  await $.tool.call({ tool: 'mcp__pins__update', add: [{ kind: 'decision', text: 'Which DB?' }] })

  for (const surface of ['terminal', 'desktop'] as const) {
    filled.length = 0
    copied.length = 0
    boxTakes = true
    const ui = await $.ui.mount({ plugin: 'pins', surface, ...PANE })
    await ui.press({ key: 'a-d1' })
    expect(filled).toEqual(['> Which DB?\n\n'])
    expect(copied).toEqual([])

    boxTakes = false
    await ui.press({ key: 'a-d1' })
    expect(copied).toEqual(['Which DB?'])
    await ui.unmount()
  }
})

const TURN_END = { answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' } as const
const board = async ($: Parameters<Parameters<typeof test>[1]>[0]) =>
  ((await $.tool.call({ tool: 'mcp__pins__update' })).result as string).split('\n').slice(1)

test('a clicked decision clears when the answer is submitted, and stays when the prompt is dropped', async ($, on) => {
  on('session.root', () => ({ value: 'C:\Proj' }))
  on('store.set', () => ({ value: undefined }))
  on('prompt.fill', () => ({ isFilled: true }))
  let dropNext = false
  on('prompt.submit', (_$, e) => (dropNext ? { drop: 'no' } : { text: e.text }))

  await $.tool.call({ tool: 'mcp__pins__update', add: [{ kind: 'decision', text: 'Which DB?' }, { kind: 'decision', text: 'Ship today?' }] })
  const ui = await $.ui.mount({ plugin: 'pins', surface: 'desktop', ...PANE })
  await ui.press({ key: 'a-d1' })
  await ui.unmount()

  dropNext = true
  await $.prompt.submit({ text: 'Postgres', origin: { kind: 'composer' }, wait: false })
  expect((await board($)).sort()).toEqual(['- [d1] decision: Which DB?', '- [d2] decision: Ship today?'])

  dropNext = false
  await $.prompt.submit({ text: 'Postgres', origin: { kind: 'composer' }, wait: false })
  expect(await board($)).toEqual(['- [d2] decision: Ship today?'])
})

test('a typed answer clears the decision it quotes or names by id; a peer message does not', async ($, on) => {
  on('session.root', () => ({ value: 'C:\Proj' }))
  on('store.set', () => ({ value: undefined }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))

  await $.tool.call({
    tool: 'mcp__pins__update',
    add: [{ kind: 'decision', text: 'Which DB?' }, { kind: 'decision', text: 'Ship today?' }, { kind: 'decision', text: 'Rename repo?' }],
  })
  await $.prompt.submit({ text: 'd2 yes', origin: { kind: 'peer' }, wait: false } as never)
  expect((await board($)).length).toBe(3)

  await $.prompt.submit({ text: '> Which DB?\n\nPostgres', origin: { kind: 'composer' }, wait: false })
  await $.prompt.submit({ text: 'd2: yes, ship it', origin: { kind: 'sdk' }, wait: false } as never)
  expect(await board($)).toEqual(['- [d3] decision: Rename repo?'])
})

test('done todos show as completed, then leave when the turn ends', async ($, on) => {
  on('session.root', () => ({ value: 'C:\Proj' }))
  on('store.set', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))

  await $.tool.call({ tool: 'mcp__pins__update', add: [{ kind: 'todo', text: 'Phone-test' }, { kind: 'todo', text: 'Refresh page' }] })
  const marked = await $.tool.call({ tool: 'mcp__pins__update', done: ['t1'] })
  expect(marked.result).toBe('Board now:\n- [t1] todo (completed): Phone-test\n- [t2] todo: Refresh page')

  const ui = await $.ui.mount({ plugin: 'pins', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: '✓' })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Write docs', status: 'in_progress', activeForm: 'Writing docs' }] })
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Write docs', status: 'completed', activeForm: 'Writing docs' }] })
  expect((await board($)).at(-1)).toBe('- [tw1] todo (completed): Write docs')

  await $.turn.complete(TURN_END)
  expect(await board($)).toEqual(['- [t2] todo: Refresh page'])

  // TodoWrite resends the finished item next turn; it stays gone
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Write docs', status: 'completed', activeForm: 'Writing docs' }] })
  expect(await board($)).toEqual(['- [t2] todo: Refresh page'])
})
