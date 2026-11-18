# YouTube Transcript Copy & Download

A userscript that adds two compact controls to YouTube watch pages:

- **Copy transcript** copies the current video's transcript, followed by its comments, to the clipboard.
- **Download .txt** saves the same text as a plain text file.

The exported text includes basic video metadata, the video link, timestamped transcript lines, and a comments section.

## Current Version

- Script file: `userscripts/youtube-transcript-copy-download.user.js`
- Script version: `2026.11.18.1`
- Owner: <https://github.com/krkn-s>
- Repository: <https://github.com/krkn-s/userscripts>

## Features

- Adds copy and download buttons directly on YouTube video pages.
- Preserves transcript timestamps.
- Includes video title, channel name, publish date when available, and video URL.
- Appends the video comments after the transcript: top-level comments plus their replies, with author, relative publish time, and like count.
- Uses multiple transcript retrieval strategies:
  - timed text caption endpoints when caption tracks are available;
  - YouTube Innertube transcript data when available;
  - visible YouTube transcript panel parsing as a fallback.
- Prefers data sources over DOM scraping so UI-only YouTube changes are less likely to break extraction.
- Fetches comments through the YouTube Innertube `next` endpoint, one continuation per page, so the page does not have to be scrolled.
- Caps comment retrieval at 100 requests and 3000 entries per export, then marks the output with `comments-truncated="true"`.
- Keeps the transcript usable when comments cannot be fetched: the section then holds a `comments-status` line instead of failing the export.
- Shows progress on the button while comments load, and caches transcripts and comments per video during the current page session.
- Includes a small debug helper exposed as `window.SYTER_DEBUG()` for troubleshooting.

## Installation

Install a userscript manager first. This script is used with the Safari
[Userscripts](https://github.com/quoid/userscripts) extension, and should also work with userscript managers that support standard userscript metadata and clipboard grants.

Then install:

1. Open `userscripts/youtube-transcript-copy-download.user.js`.
2. Add it to your userscript manager.
3. Make sure it is enabled for `youtube.com` pages.
4. Open or reload a YouTube video page.

If your userscript manager supports direct raw URLs, use:

```text
https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/youtube-transcript-copy-download.user.js
```

## Usage

1. Open a YouTube video.
2. Wait for the page to finish loading.
3. Use **Copy transcript** to copy the transcript and comments.
4. Use **Download .txt** to save the same text locally.

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
----------------------------------------
comments-count="3"

[@alice] 2 months ago · 42 likes
Super video, merci !

  [@bob] 3 hours ago
  Reply to the first comment.

[@carol] 1 day ago · 1 like
Second comment.
```

Comments use YouTube's relative publish time (`2 months ago`) because that is what the API returns. Replies sit under their parent comment, indented by two spaces.

When comments cannot be fetched, the section is replaced by a single status line:

```text
----------------------------------------
comments-status="unavailable"
```

## Compatibility Notes

- The script runs on `youtube.com` and subdomains such as `www.youtube.com`.
- It depends on transcripts or captions being available for the video.
- The script now prefers YouTube transcript or caption data first and only falls back to DOM parsing when needed.
- Comments come from the same Innertube surface YouTube uses. Loading a video with many comments takes several seconds and stops at the request cap, which sets `comments-truncated="true"`.
- Comments are read-only: the script never posts, likes, or replies.
- YouTube changes its DOM and transcript APIs frequently, so fallback paths are included but cannot guarantee every video will work.
- Clipboard access depends on the userscript manager and browser permissions.

## Troubleshooting

- Reload the video page if the buttons do not appear.
- Open the YouTube transcript panel manually if transcript extraction fails.
- Confirm that the video actually has captions or a transcript.
- When comments are missing, check the `comments-status` line: `no comments` means the video has none, `unavailable` means no comment continuation was found, `fetch failed` means a request was rejected.
- Check that the userscript manager allows clipboard access.
- In the browser console, run `SYTER_DEBUG()` to inspect the last extraction strategy, attempt order, caption-track availability, transcript param state, DOM transcript candidates, comments status, and recent error state.

## Development

This repository keeps installable userscripts under `userscripts/` and per-script documentation under `docs/`.

Before publishing a change, run:

```sh
bun build --no-bundle userscripts/youtube-transcript-copy-download.user.js >/dev/null
```

Also search the repository for stale owner names, retired dated filenames, and outdated version notes before release.

## License

MIT
