# Userscripts

A collection of userscripts maintained by <https://github.com/krkn-s>.

Install a userscript manager first. These scripts are used with the Safari
[Userscripts](https://github.com/quoid/userscripts) extension, and should also
work with userscript managers that support standard userscript metadata.

## Available Scripts

| Script | Site | Description | Install | Docs |
| --- | --- | --- | --- | --- |
| Perplexity Hide Space Threads | Perplexity | Adds a Library toggle to hide threads attached to Spaces or Bookmarks. | [Raw install](https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/perplexity-hide-non-space-threads.user.js) | [Docs](docs/perplexity-hide-non-space-threads.md) |
| YouTube Default to My Subscriptions | YouTube | Redirects signed-in YouTube home visits to the Subscriptions page. | [Raw install](https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/youtube-default-to-subscriptions.user.js) | [Docs](docs/youtube-default-to-subscriptions.md) |
| YouTube Transcript Copy & Download | YouTube | Adds copy and download controls for timestamped YouTube transcripts. | [Raw install](https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/youtube-transcript-copy-download.user.js) | [Docs](docs/youtube-transcript-copy-download.md) |

## Repository Layout

```text
.
├── README.md
├── userscripts/
│   ├── perplexity-hide-non-space-threads.user.js
│   ├── youtube-default-to-subscriptions.user.js
│   └── youtube-transcript-copy-download.user.js
└── docs/
    ├── perplexity-hide-non-space-threads.md
    ├── youtube-default-to-subscriptions.md
    └── youtube-transcript-copy-download.md
```

- `userscripts/` contains installable `.user.js` files only.
- `docs/` contains one detailed Markdown document per userscript.
- The root `README.md` is the collection index.

## Installing a Script

1. Open the raw install link for the script you want.
2. Confirm the installation in your userscript manager.
3. Make sure the script is enabled for the target website.
4. Reload the target website.

## Development

Before publishing a userscript change, check its JavaScript syntax:

```sh
node --check userscripts/perplexity-hide-non-space-threads.user.js
node --check userscripts/youtube-default-to-subscriptions.user.js
node --check userscripts/youtube-transcript-copy-download.user.js
```

Also search the repository for stale owner names, retired dated filenames, and
outdated version notes before release.

## License

MIT
