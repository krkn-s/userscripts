# Userscripts

A collection of userscripts maintained by <https://github.com/krkn-s>.

Install a userscript manager first. These scripts are used with the Safari
[Userscripts](https://github.com/quoid/userscripts) extension, and should also
work with userscript managers that support standard userscript metadata.

## Available Scripts

| Script | Site | Description | Install | Docs |
| --- | --- | --- | --- | --- |
| YouTube Transcript Copy & Download | YouTube | Adds copy and download controls for timestamped YouTube transcripts. | [Raw install](https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/youtube-transcript-copy-download.user.js) | [Docs](docs/youtube-transcript-copy-download.md) |

## Repository Layout

```text
.
├── README.md
├── userscripts/
│   └── youtube-transcript-copy-download.user.js
└── docs/
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
node --check userscripts/youtube-transcript-copy-download.user.js
```

Also search the repository for stale owner names, retired dated filenames, and
outdated version notes before release.

## License

MIT
