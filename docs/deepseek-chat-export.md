# DeepSeek Chat Export

A small Safari-compatible userscript for DeepSeek conversations.

It does two things on `https://chat.deepseek.com`:

- It adds two minimalist buttons, `MD` and `JSON`, next to the Share button of
  a conversation. Clicking one downloads the whole conversation as a file.
- It keeps the reasoning panel (`Thought for N seconds`) collapsed. DeepSeek
  opens it by default, and the script closes it once per message through the
  panel's own toggle, so expanding it by hand still works.

`MD` produces a readable Markdown document (title, export metadata, and each
message with French section labels: `Utilisateur`, `DeepSeek`, `Pensée`,
`Réponse`). `JSON` produces the structured dataset with the same content.

Both exports include the **thinking chain** of every assistant message: the
reasoning segments, the `Found N web pages` search steps and the `Read N pages`
steps with their source links. The panels are opened for the duration of the
export and closed again afterwards, so keeping them collapsed never removes the
reasoning from the file.

## Current Version

- Script file: `userscripts/deepseek-chat-export.user.js`
- Script version: `2026.11.11.1`
- Owner: <https://github.com/krkn-s>
- Repository: <https://github.com/krkn-s/userscripts>

## Features

- No dependencies, no network requests, no runtime payloads: everything is
  parsed from the rendered page.
- Reasoning panel collapsed by default: each message is closed once through the
  panel's own toggle, so the chevron and the panel stay in sync with DeepSeek's
  state, and a manual re-expand is not undone.
- Buttons survive in-app navigation: a new conversation, or a thread opened
  without a page reload, gets the `MD` and `JSON` buttons as soon as its header
  is rendered.
- Full-history export, not just the visible messages: the DeepSeek message list
  is DOM-virtualized, so the script sweeps the list (scrolls up and down,
  deduplicating on `data-virtual-list-item-key`) before reading messages.
- Preserves Markdown structure of answers: headings, lists, tables, code
  blocks, links, bold, italics, block quotes and KaTeX expressions (exported
  from the original LaTeX source stored in the page).
- Thinking chain blocks: reasoning text, search steps and read steps with
  source links.
- No content is altered: the only DOM actions are the reasoning toggles, which
  use the page's own control, and the scroll position is restored after the
  scan.

## Installation

Install a userscript manager first. This script is used with the Safari
[Userscripts](https://github.com/quoid/userscripts) extension, and should also
work with userscript managers that support standard userscript metadata.

Then install:

1. Open `userscripts/deepseek-chat-export.user.js`.
2. Add it to your userscript manager.
3. Make sure it is enabled for `chat.deepseek.com`.
4. Open the chat page. No reload is needed after that, new conversations
   included.

If your userscript manager supports direct raw URLs, use:

```text
https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/deepseek-chat-export.user.js
```

## Usage

1. Start a new conversation or open an existing one. The buttons appear as
   soon as the conversation header is rendered.
2. Click `MD` to download the conversation as Markdown, or `JSON` for the
   structured export.
3. The file is named `deepseek-<title-slug>-<date>.<ext>`.

### Exported JSON shape

```json
{
  "title": "Conversation title",
  "url": "https://chat.deepseek.com/a/chat/s/<id>",
  "shareId": "<id>",
  "exportedAt": "2026-08-02T10:00:00.000Z",
  "tool": "deepseek-chat-export/2026.11.11.1",
  "messages": [
    { "role": "user", "content": "…" },
    {
      "role": "assistant",
      "content": "…",
      "thinkingLabel": "Thought for 6 seconds",
      "thinking": [
        { "type": "text", "content": "…" },
        { "type": "search", "text": "Found 59 web pages" },
        { "type": "read", "text": "Read 5 pages", "links": [{ "title": "…", "url": "https://…" }] }
      ]
    }
  ]
}
```

## Compatibility Notes

- Runs on every page of `https://chat.deepseek.com` and only acts where a
  conversation header exists.
- The reasoning panel is recognized by its title (`Thought for N seconds`, plus
  the Chinese labels). Another wording leaves the panel untouched, and the
  export keeps working.
- The extraction relies on DOM classes prefixed `ds-` (`.ds-message`,
  `.ds-assistant-message-main-content`, `.ds-think-content`, `.ds-markdown`);
  DeepSeek keeps those stable, but layout or class changes may require an
  update of the parsing selectors.
- Very old browsers without `URL.createObjectURL` / `Blob` will not download.

## Development

This repository keeps installable userscripts under `userscripts/` and
per-script documentation under `docs/`.

Before publishing a change, run:

```sh
bun build --no-bundle userscripts/deepseek-chat-export.user.js >/dev/null
```

Also search the repository for stale owner names, retired source repository
links, and outdated version notes before release.

## License

MIT