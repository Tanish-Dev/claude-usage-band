import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-10T12:00:00Z')
const HOUR = 3_600_000

const BAND = {
  plugin: 'usage-band',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 110,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const measure = (session: number, week: number) => ({
  context: { window: 200_000, tokens: 82_000, percent: 41 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: session, resetsAt: new Date(NOW + 2 * HOUR).toISOString() },
    { kind: 'seven_day', percentUsed: week, resetsAt: new Date(NOW + 80 * HOUR).toISOString() },
  ],
  changed: ['context', 'rateLimits'] as ('context' | 'rateLimits')[],
})

test('draws the limits, expands and collapses on every surface', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))

  await $.session.measure(measure(34, 12))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: '34%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2h' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '41%' })).toBeDefined()

    await ui.press({ key: 'details' })
    expect(await ui.find({ type: 'Text', text: /resets in 2h . on pace for ~57% by reset/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '82k of 200k tokens' })).toBeDefined()

    await ui.press({ key: 'compact' })
    expect(await ui.find({ type: 'Text', text: /on pace/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('warns once per threshold as a window fills', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const toasts: string[] = []
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  await $.session.measure(measure(50, 10))
  expect(toasts.length).toBe(0)
  await $.session.measure(measure(91, 10))
  await $.session.measure(measure(92, 10))
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('Session limit 91% used')
})

test('Clawd lives on the desktop only', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))

  await $.session.measure(measure(20, 10))
  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await terminal.find({ key: 'clawd' })).toBeUndefined()
  await terminal.unmount()

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await desktop.findAll({ type: 'Svg' })).length).toBe(1)
  expect(await desktop.find({ type: 'Box', key: 'clawd' })).toBeDefined()
  await desktop.unmount()
})
