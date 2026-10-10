# Usage Band for Claude Code

A Claude Code mod that shows your plan usage right above the prompt, so you never have to dig through settings to find out how much of your limit is left.

```
▐▛███▜▌   Session ━━━━━━━━━━ 34% 2h 14m   Week ━━━━━━━━━━ 12% 3d 8h   Context ━━━━━━━━━━ 41%   Details  Hide
```

Works in the Claude Code terminal and in the Claude desktop app's Code tab.

## Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install usage-band --marketplace Tanish-Dev/claude-usage-band
```

Answer `y` to add the marketplace, then pick the user scope. The band appears in that session straight away and in every session you start afterwards, the desktop app's included.

## What it shows

- **Session limit** (the 5-hour window): percentage used and time until it resets.
- **Weekly limit**: percentage used and time until it resets.
- **Context**: how full the current conversation's context window is.

Each meter has its own colour (blue, purple, green) and turns orange at 75% and red at 90%.

## Extras

- **Details view**: press `Details` for one row per meter, with the reset countdown, token counts, and how long the chat has run.
- **Pace**: the details view projects where each window will land, for example `on pace for ~57% by reset` or `limit in ~1h 20m at this pace`. A meter turns orange early when your pace would hit the limit.
- **Limit warnings**: a toast when a limit crosses 75%, 90% and 95%, once per threshold per window.
- **Remembers**: your chosen view and the last limit reading carry over, so a new session shows numbers before its first reply.
- **Clawd**: the little crab at the start of the band is there for moral support. Poke it.

## Command

| Command | What it does |
| --- | --- |
| `/usage-band` | Prints a usage summary and brings a hidden band back |
| `/usage-band full` | Detailed view |
| `/usage-band compact` | One-line view |
| `/usage-band hide` | Hides the band |

## Good to know

- Limits are read from Claude Code itself, so they need a Claude subscription (Pro, Max, Team). With an API key the band shows context only.
- Numbers refresh after each reply; countdowns tick every 30 seconds.
- Nothing leaves your machine: the mod makes no network requests.
- Claude Code mods are an early-access API that may change between releases. Written against Claude Code 2.1.295.

## Develop

```
claude plugin validate .
claude plugin test .
```

To run a working copy, start a session with `claude --plugin-dir <this folder>`.

## License

MIT. An unofficial community mod, not affiliated with or endorsed by Anthropic.
