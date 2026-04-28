# YouTube Transcript Copy & Download

A userscript that adds two compact controls to YouTube watch pages:

- **Copy transcript** copies the current video's transcript to the clipboard.
- **Download .txt** saves the transcript as a plain text file.

The exported transcript includes basic video metadata, the video link, and timestamped transcript lines.

## Current Version

- Script file: `youtubecom-transcript-copy-download.user.js`
- Script version: `2026-04-24`
- Owner: <https://github.com/krkn-s>
- Repository: <https://github.com/krkn-s/userscripts-youtube_com-transcript_copy_download>

## Features

- Adds copy and download buttons directly on YouTube video pages.
- Preserves transcript timestamps.
- Includes video title, channel name, publish date when available, and video URL.
- Uses multiple transcript retrieval strategies:
  - visible YouTube transcript panel parsing;
  - YouTube Innertube transcript data when available;
  - timed text caption endpoints as a fallback.
- Caches transcript data per video during the current page session.
- Includes a small debug helper exposed as `window.SYTER_DEBUG()` for troubleshooting.

## Installation

Install a userscript manager first. This script is used with the Safari
[Userscripts](https://github.com/quoid/userscripts) extension, and should also work with userscript managers that support standard userscript metadata and clipboard grants.

Then install:

1. Open `youtubecom-transcript-copy-download.user.js`.
2. Add it to your userscript manager.
3. Make sure it is enabled for `youtube.com` pages.
4. Open or reload a YouTube video page.

If your userscript manager supports direct raw URLs, use:

```text
https://raw.githubusercontent.com/krkn-s/userscripts-youtube_com-transcript_copy_download/main/youtubecom-transcript-copy-download.user.js
```

## Usage

1. Open a YouTube video.
2. Wait for the page to finish loading.
3. Use **Copy transcript** to copy the transcript text.
4. Use **Download .txt** to save it locally.

The downloaded file name is based on the video title and channel name.

## Output Format

The copied or downloaded text uses this structure:

```text
video-title="Example Video Title"
video-author="Example Channel"
video-published="2026-04-24"
video-link="https://www.youtube.com/watch?v=..."
----------------------------------------

00:00 First transcript line
00:04 Second transcript line
00:08 Third transcript line
```

## Compatibility Notes

- The script runs on `youtube.com` and subdomains such as `www.youtube.com`.
- It depends on transcripts or captions being available for the video.
- YouTube changes its DOM and transcript APIs frequently, so fallback paths are included but cannot guarantee every video will work.
- Clipboard access depends on the userscript manager and browser permissions.

## Troubleshooting

- Reload the video page if the buttons do not appear.
- Open the YouTube transcript panel manually if transcript extraction fails.
- Confirm that the video actually has captions or a transcript.
- Check that the userscript manager allows clipboard access.
- In the browser console, run `SYTER_DEBUG()` to inspect the last extraction strategy, cached line count, DOM transcript candidates, and recent error state.

## Development

This repository intentionally keeps only the latest userscript file. Dated historical copies are not maintained in the working tree.

Before publishing a change, run:

```sh
node --check youtubecom-transcript-copy-download.user.js
```

Also search the repository for stale owner names, retired dated filenames, and outdated version notes before release.

## License

MIT
