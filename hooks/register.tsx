import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ContextFill, Limit, Mode, Reading } from '../types'

const reading = atom({ plugin: 'usage-band', key: 'reading' } as const, null)
const mode = atom({ plugin: 'usage-band', key: 'mode' } as const, 'compact')
const tick = atom({ plugin: 'usage-band', key: 'tick' } as const, 0)
const alerted = atom({ plugin: 'usage-band', key: 'alerted' } as const, {})

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const THRESHOLDS = [75, 90, 95]
const FILL = '━'
// Clawd as pixels, for the surfaces that draw them (the terminal has none): a body with two eye holes,
// two arms and four legs. It blinks, taps its feet, hops and waves a claw now
// and then, and squints as the limits fill.
const clawdSvg = (isSquinting: boolean): string => {
  const body = '#D97757'
  const move = (values: string, keyTimes: string, dur: string) =>
    `<animateTransform attributeName="transform" type="translate" values="${values}" keyTimes="${keyTimes}" dur="${dur}" repeatCount="indefinite"/>`
  const lids = isSquinting
    ? `<path fill="${body}" d="M4 2h1v1H4zM11 2h1v1h-1z"/>`
    : `<path fill="${body}" opacity="0" d="M4 2h1v2H4zM11 2h1v2h-1z"><animate attributeName="opacity" values="0;0;1;0" keyTimes="0;0.95;0.975;1" dur="5s" repeatCount="indefinite"/></path>`

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -1 16 12" width="24" height="18" shape-rendering="crispEdges">',
    `<g fill="${body}">`,
    move('0 0;0 0;0 -1;0 0;0 0', '0;0.6;0.66;0.72;1', '4s'),
    '<path fill-rule="evenodd" d="M2 0h12v9H2zM4 2v2h1V2zM11 2v2h1V2z"/>',
    lids,
    '<path d="M0 4h2v2H0z"/>',
    `<path d="M14 4h2v2h-2z">${move('0 0;0 -1;0 0;0 -1;0 0;0 0', '0;0.04;0.08;0.12;0.16;1', '7s')}</path>`,
    `<path d="M3 9h1v2H3zM10 9h1v2h-1z">${move('0 0;0 -1;0 0;0 0', '0;0.05;0.1;1', '4s')}</path>`,
    `<path d="M5 9h1v2H5zM12 9h1v2h-1z">${move('0 0;0 0;0 -1;0 0;0 0', '0;0.1;0.15;0.2;1', '4s')}</path>`,
    '</g>',
    '</svg>',
  ].join('')
}

// The system palette: one hue pair per meter, warm ones as a window fills.
type Hues = readonly [string, string]
const BLUE: Hues = ['#0A84FF', '#64D2FF']
const PURPLE: Hues = ['#BF5AF2', '#FF6BD6']
const GREEN: Hues = ['#28BD52', '#63E6E2']
const INDIGO: Hues = ['#5E5CE6', '#0A84FF']
const ORANGE: Hues = ['#FF9F0A', '#FFD60A']
const RED: Hues = ['#FF453A', '#FF375F']

// The colour a share of the way from a pair's first hue to its second.
const blend = ([from, to]: Hues, share: number): string => {
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16)
  const mix = (at: number) =>
    Math.round(channel(from, at) + (channel(to, at) - channel(from, at)) * share)
      .toString(16)
      .padStart(2, '0')

  return `#${mix(1)}${mix(3)}${mix(5)}`
}

type Meter = {
  key: string
  label: string
  percent: number
  hues: Hues
  // The short tail of the one-line view, and the sentence of the detailed one.
  brief: string
  detail: string
}

const windowMs = (kind: string): number | undefined =>
  kind.startsWith('five_hour') ? 5 * HOUR : kind.startsWith('seven_day') ? 7 * DAY : undefined

const labelOf = (kind: string): string => {
  if (kind === 'five_hour') return 'Session'
  if (kind === 'seven_day') return 'Week'
  if (kind === 'spend_limit') return 'Spend'
  if (kind.startsWith('seven_day_')) return `Week ${kind.slice(10).replace(/_/g, ' ')}`

  return kind.replace(/_/g, ' ')
}

const restHues = (kind: string): Hues =>
  kind === 'context'
    ? GREEN
    : kind.startsWith('five_hour')
      ? BLUE
      : kind.startsWith('seven_day')
        ? PURPLE
        : INDIGO

const huesOf = (kind: string, percent: number, isHot = false): Hues =>
  percent >= 90 ? RED : percent >= 75 || isHot ? ORANGE : restHues(kind)

const span = (ms: number): string => {
  const minutes = Math.max(1, Math.round(ms / MINUTE))
  if (minutes >= 24 * 60) {
    const hours = Math.round(minutes / 60)

    return hours % 24 === 0 ? `${hours / 24}d` : `${Math.floor(hours / 24)}d ${hours % 24}h`
  }
  if (minutes >= 60) {
    return minutes % 60 === 0 ? `${minutes / 60}h` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  }

  return `${minutes}m`
}

const tokens = (count: number): string =>
  count >= 1_000_000
    ? `${(count / 1_000_000).toFixed(1)}M`
    : count >= 1000
      ? `${Math.round(count / 1000)}k`
      : String(count)

const whole = (percent: number): string => `${Math.round(percent)}%`

// Where the window ends up if the rest of it is spent as fast as its start.
const pace = (limit: Limit, left: number): { text: string; isHot: boolean } | undefined => {
  const length = windowMs(limit.kind)
  if (length === undefined || left <= 0 || limit.percentUsed <= 0) return undefined
  const elapsed = length - left
  if (elapsed < length * 0.05) return undefined
  const rate = limit.percentUsed / elapsed
  const projected = limit.percentUsed + rate * left
  if (limit.percentUsed >= 100) return undefined
  if (projected >= 100) {
    return { text: `limit in ~${span((100 - limit.percentUsed) / rate)} at this pace`, isHot: true }
  }

  return { text: `on pace for ~${whole(projected)} by reset`, isHot: false }
}

const limitMeter = (limit: Limit, now: number): Meter => {
  const resetsAt = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)
  const left = resetsAt - now
  // A window whose reset has passed is empty until the next reply says otherwise.
  if (left <= 0) {
    return {
      key: limit.kind,
      label: labelOf(limit.kind),
      percent: 0,
      hues: restHues(limit.kind),
      brief: 'reset',
      detail: 'window has reset',
    }
  }
  const ahead = pace(limit, left)
  const resets = Number.isNaN(left) ? '' : `resets in ${span(left)}`

  return {
    key: limit.kind,
    label: labelOf(limit.kind),
    percent: limit.percentUsed,
    hues: huesOf(limit.kind, limit.percentUsed, ahead?.isHot),
    brief: Number.isNaN(left) ? '' : span(left),
    detail: [resets, limit.percentUsed >= 100 ? 'limit reached' : ahead?.text]
      .filter(part => part !== undefined && part !== '')
      .join(' · '),
  }
}

const contextMeter = (context: ContextFill): Meter | undefined => {
  if (context.percent === undefined) return undefined

  return {
    key: 'context',
    label: 'Context',
    percent: context.percent,
    hues: huesOf('context', context.percent),
    brief: '',
    detail:
      context.tokens === undefined
        ? `of a ${tokens(context.window)} window`
        : `${tokens(context.tokens)} of ${tokens(context.window)} tokens`,
  }
}

const metersOf = (data: Reading, now: number): Meter[] => {
  const meters = data.limits.map(limit => limitMeter(limit, now))
  const context = data.context === undefined ? undefined : contextMeter(data.context)

  return context === undefined ? meters : [...meters, context]
}

const sessionLine = (data: Reading, now: number): string =>
  [
    data.startedAt === undefined ? undefined : `This chat ${span(now - data.startedAt)}`,
    data.costUsd === undefined || data.costUsd <= 0
      ? undefined
      : `$${data.costUsd.toFixed(2)} at API rates`,
  ]
    .filter(part => part !== undefined)
    .join(' · ')

const summary = (data: Reading | null, now: number): string => {
  const meters = data === null ? [] : metersOf(data, now)
  if (data === null || meters.length === 0) return 'No usage reading yet: it arrives with the first reply.'

  return [
    ...meters.map(m => `${m.label}: ${whole(m.percent)}${m.detail === '' ? '' : ` (${m.detail})`}`),
    sessionLine(data, now),
  ]
    .filter(line => line !== '')
    .join('\n')
}

// What Clawd says when hovered: lines made from the reading itself, so they
// change as the numbers do.
const sayings = (data: Reading, now: number): string[] => {
  const lines: string[] = []
  for (const limit of data.limits) {
    const name =
      limit.kind === 'five_hour'
        ? 'session'
        : limit.kind === 'seven_day'
          ? 'weekly'
          : labelOf(limit.kind).toLowerCase()
    const left = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt) - now
    if (left <= 0) {
      lines.push(`The ${name} limit just reset. Fresh claws, full tank.`)
      continue
    }
    const percent = limit.percentUsed
    const used = whole(percent)
    lines.push(
      percent >= 100
        ? `The ${name} limit is spent. Time to bask on a rock.`
        : percent >= 90
          ? `${used} of the ${name} limit gone. Pinching every token now.`
          : percent >= 75
            ? `${used} of the ${name} limit used. Getting snappy, pace yourself.`
            : percent >= 50
              ? `${used} into the ${name} limit. Steady as she scuttles.`
              : percent >= 25
                ? `${whole(100 - percent)} of the ${name} limit still free. Cruising sideways.`
                : `Only ${used} of the ${name} limit used. Plenty of room in the shell.`,
    )
    if (Number.isNaN(left)) continue
    lines.push(
      left < 30 * MINUTE
        ? `The ${name} limit resets in ${span(left)}. Fresh claws incoming.`
        : percent >= 75
          ? `${span(left)} until the ${name} limit resets. Hang in there.`
          : `${span(left)} until the ${name} limit resets. No rush.`,
    )
    const ahead = pace(limit, left)
    if (ahead?.isHot === true) {
      lines.push(`Careful: ${ahead.text} on the ${name} limit. Maybe slow the scuttle.`)
    } else if (ahead !== undefined) {
      lines.push(`You are ${ahead.text} on the ${name} limit. Carry on.`)
    }
  }

  const context = data.context
  if (context?.percent !== undefined) {
    const size =
      context.tokens === undefined ? '' : ` (${tokens(context.tokens)} of ${tokens(context.window)})`
    lines.push(
      context.percent >= 80
        ? `Context is ${whole(context.percent)} full${size}. A /compact would feel nice.`
        : context.percent >= 50
          ? `Context is ${whole(context.percent)} full${size}. Getting cosy in here.`
          : `Context is ${whole(context.percent)} full${size}. Lots of room to think.`,
    )
  }
  if (data.costUsd !== undefined && data.costUsd > 0) {
    lines.push(`$${data.costUsd.toFixed(2)} of tokens at API rates this chat. I am not judging.`)
  }
  if (data.startedAt !== undefined) {
    const age = now - data.startedAt
    lines.push(
      age >= 2 * HOUR
        ? `${span(age)} in this chat. Stretch your claws.`
        : `${span(age)} into this chat. Nice and fresh.`,
    )
  }

  return lines.length === 0 ? ['Snip snip.'] : lines
}

// JSON data only: a field the engine left out is left out, never `undefined`.
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-band',
      description: 'Show, hide or expand the usage band above the prompt',
      argumentHint: '[show|hide|compact|full]',
      immediate: true,
    })

    const kept = await $.store.get('mode').catch(() => undefined)
    if (kept === 'compact' || kept === 'full' || kept === 'hidden') {
      await update($, mode, () => kept)
    }

    // Rate limits are the account's, so the last session's reading stands in
    // until this one's first reply; context and cost are this session's alone.
    const last = (await $.store.get('limits').catch(() => undefined)) as Limit[] | undefined
    const usage = await $.session.usage().catch(() => undefined)
    const limits = usage !== undefined && usage.rateLimits.length > 0 ? usage.rateLimits : last
    await update($, reading, held =>
      plain<Reading>({
        limits: limits ?? held?.limits ?? [],
        context: usage?.context ?? held?.context,
        costUsd: usage?.cost?.usd ?? held?.costUsd,
        startedAt: usage?.startedAt ?? held?.startedAt,
      }),
    )

    // The countdowns move with the clock, not with a reply.
    $.clock.every(30_000, () => void update($, tick, n => n + 1))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const held = await read($, reading)
    const limits = e.rateLimits.length > 0 ? e.rateLimits : (held?.limits ?? [])
    await update($, reading, was =>
      plain<Reading>({
        limits,
        context: { window: e.context.window, tokens: e.context.tokens, percent: e.context.percent },
        costUsd: e.cost?.usd ?? was?.costUsd,
        startedAt: was?.startedAt,
      }),
    )

    if (e.rateLimits.length > 0) {
      await $.store.set('limits', plain(e.rateLimits)).catch(() => undefined)
    }

    // One warning per threshold per window: the key carries the reset, so the
    // next window warns afresh.
    const now = await $.clock.now()
    const seen = await read($, alerted)
    const nextSeen: Record<string, number> = {}
    for (const limit of e.rateLimits) {
      const key = `${limit.kind}@${limit.resetsAt ?? ''}`
      const before = seen[key] ?? 0
      const crossed = THRESHOLDS.filter(t => limit.percentUsed >= t).pop() ?? 0
      nextSeen[key] = Math.max(before, crossed)
      if (crossed > before) {
        const meter = limitMeter(limit, now)
        $.ui.toast(
          `${meter.label} limit ${whole(limit.percentUsed)} used${meter.detail === '' ? '' : ` · ${meter.detail}`}`,
          { timeoutMs: 8000 },
        )
      }
    }
    await update($, alerted, () => nextSeen)

    return next(e)
  })

  on('command.run', { command: 'usage-band' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const wanted: Mode | undefined =
      arg === 'hide' || arg === 'off'
        ? 'hidden'
        : arg === 'full' || arg === 'details'
          ? 'full'
          : arg === 'compact' || arg === 'show' || arg === 'on'
            ? 'compact'
            : undefined

    if (arg !== '' && wanted === undefined) {
      return { text: `Unknown option "${arg}". Use /usage-band show, hide, compact or full.` }
    }

    // Bare, it reports and brings a hidden band back.
    const current = await read($, mode)
    const target = wanted ?? (current === 'hidden' ? 'compact' : current)
    await update($, mode, () => target)
    await $.store.set('mode', target).catch(() => undefined)

    if (target === 'hidden') return { text: `Usage band hidden. /usage-band brings it back.` }

    return { text: summary(await read($, reading), await $.clock.now()) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const view = await read($, mode)
    if (e.props.hasSurvey || view === 'hidden') return next(e)

    const data = await read($, reading)
    const beat = await read($, tick)
    const now = await $.clock.now()
    const meters = data === null ? [] : metersOf(data, now)
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    // Pixels where the surface draws them, glyphs on the terminal.
    const Svg = e.surface !== 'terminal' && 'Svg' in table ? table.Svg : undefined

    const setMode = async (to: Mode) => {
      await update($, mode, () => to)
      await $.store.set('mode', to).catch(() => undefined)
    }
    const hide = async () => {
      await setMode('hidden')
      $.ui.toast(`Usage hidden · /usage-band brings it back`)
    }

    if (data === null || meters.length === 0) {
      return (
        <Box gap={2}>
          <Text dimColor>Usage appears after the first reply.</Text>
          <Button key="hide" role="dismiss" dimColor label="Hide" onPress={hide} />
        </Box>
      )
    }

    const columns = e.props.bodyColumns
    const fullest = Math.max(...meters.map(meter => meter.percent))
    const lines = sayings(data, now)
    const saying = lines[(beat + Math.floor(now / 30_000)) % lines.length] ?? ''
    // Hovering Clawd shows what it has to say in a talk bubble laid over the
    // meters beside it, so nothing in the band moves. The terminal has no Clawd.
    const clawd = Svg !== undefined && (
      <Box key="clawd" position="relative" alignItems="center" flexShrink={0}>
        <Svg source={clawdSvg(fullest >= 75)} alt="Clawd" width={24} height={18} />
        <Box
          position="absolute"
          top={0}
          left={4}
          display="none"
          hover={{ display: 'flex' }}
          paddingX={1}
        >
          <Text color="claude">
            {'◂ '}
          </Text>
          <Text color="text" wrap="truncate-end">
            {saying}
          </Text>
        </Box>
      </Box>
    )
    const bar = (meter: Meter, width: number) => {
      const filled =
        meter.percent <= 0 ? 0 : Math.min(width, Math.max(1, Math.round((meter.percent / 100) * width)))

      // The fill runs from the meter's hue to its lighter shade, cell by cell.
      const cells = Array.from({ length: filled }, (_, at) =>
        blend(meter.hues, filled === 1 ? 0 : at / (filled - 1)),
      )

      return (
        <Text>
          {cells.map(colour => (
            <Text color={colour}>{FILL}</Text>
          ))}
          <Text color="subtle">{FILL.repeat(width - filled)}</Text>
        </Text>
      )
    }

    if (view === 'compact') {
      // One line, always: a proportional font draws the bar's glyphs wide, so
      // the desktop gets fewer of them, and nothing here may wrap.
      const width = Svg !== undefined ? 5 : columns >= 100 ? 8 : columns >= 72 ? 5 : 0

      return (
        <Box columnGap={2} flexWrap="nowrap" alignItems="center">
          {clawd}
          {meters.map(meter => (
            <Box gap={1} flexShrink={0}>
              <Text dimColor wrap="truncate-end">
                {meter.label}
              </Text>
              {width > 0 && bar(meter, width)}
              <Text bold color={meter.hues[0]}>
                {whole(meter.percent)}
              </Text>
              {meter.brief !== '' && (
                <Text dimColor wrap="truncate-end">
                  {meter.brief}
                </Text>
              )}
            </Box>
          ))}
          <Button key="details" plain dimColor label="Details" onPress={() => setMode('full')} />
        </Box>
      )
    }

    const labelWidth = Math.max(...meters.map(meter => meter.label.length)) + 2
    const width = Math.max(8, Math.min(28, columns - labelWidth - 48))
    const footer = sessionLine(data, now)

    return (
      <Box flexDirection="column">
        {meters.map(meter => (
          <Box gap={1}>
            <Box width={labelWidth}>
              <Text>{meter.label}</Text>
            </Box>
            {bar(meter, width)}
            <Box width={5} justifyContent="flex-end">
              <Text bold color={meter.hues[0]}>
                {whole(meter.percent)}
              </Text>
            </Box>
            <Text dimColor wrap="truncate-end">
              {meter.detail}
            </Text>
          </Box>
        ))}
        <Box gap={2}>
          {clawd}
          {footer !== '' && <Text dimColor>{footer}</Text>}
          <Button key="compact" dimColor label="Less" onPress={() => setMode('compact')} />
          <Button key="hide" role="dismiss" dimColor label="Hide" onPress={hide} />
        </Box>
      </Box>
    )
  })
}
