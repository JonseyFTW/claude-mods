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
