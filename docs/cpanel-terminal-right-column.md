# cPanel Terminal Right Column

Stretches the cPanel Terminal panel over the right column of the page, below
the page description.

cPanel's Terminal app renders its xterm panel inside a narrow box. The script
keeps the terminal the page already provides and repositions the existing
`.cp-terminal` panel: fixed position, 10 px margins, top aligned under the page
description, left aligned with the content area. A `resize` event follows each
placement so xterm's fit addon reflows the terminal to the new width.

## Current Version

- Script file: `userscripts/cpanel-terminal-right-column.user.js`
- Script version: `2026.11.11.1`
- Owner: <https://github.com/krkn-s>
- Repository: <https://github.com/krkn-s/userscripts>

## Features

- Works with the terminal the page renders. Nothing is created, and nothing is
  injected into the terminal itself.
- Recomputes the offsets at load and during the first seconds after the page
  renders, which covers terminals mounted after `document-end`.
- Refits the xterm rows after every placement by dispatching `resize`.
- No userscript API, no network request, no dependency.

## Installation

Install a userscript manager first. This script is used with the Safari
[Userscripts](https://github.com/quoid/userscripts) extension, and should also
work with userscript managers that support standard userscript metadata.

Then install:

1. Open `userscripts/cpanel-terminal-right-column.user.js`.
2. Add it to your userscript manager.
3. Make sure it is enabled for your cPanel host.
4. Open the Terminal app of that host.

If your userscript manager supports direct raw URLs, use:

```text
https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/cpanel-terminal-right-column.user.js
```

## Usage

1. Open the cPanel Terminal app, for example
   `https://<server>.o2switch.net:2083/cpsess<id>/frontend/<theme>/terminal/index.html`.
2. The terminal fills the right column, from under the page description to the
   bottom of the window.
3. Resize the window and the terminal follows on the next placement. Nothing
   else changes in the terminal: the shell session, colors and history are the
   ones cPanel provides.

## Compatibility Notes

- `@match` is `*://*.o2switch.net/*/frontend/*/terminal/*`. The server name, the
  `cpsess` token and the theme directory change per account, so they stay
  wildcards. Ports are not part of match patterns, `2083` works without being
  listed.
- The placement reads two cPanel page anchors: `#content` and
  `.body-content > .description`. If cPanel renames either of them, `place()`
  returns without writing the offsets and the panel keeps its original layout.
  The stylesheet alone does not move anything, it only supplies the properties.
- The script polls every 400 ms and stops after seven successful placements. A
  page that never renders `.cp-terminal` leaves the interval running, which
  costs a `querySelector` every 400 ms and nothing else.
- Tested on the o2switch cPanel host. Another host needs its own `@match`.

## Development

This repository keeps installable userscripts under `userscripts/` and
per-script documentation under `docs/`.

Before publishing a change, run:

```sh
bun build --no-bundle userscripts/cpanel-terminal-right-column.user.js >/dev/null
```

Also search the repository for stale owner names, retired source repository
links, and outdated version notes before release.

## License

MIT
