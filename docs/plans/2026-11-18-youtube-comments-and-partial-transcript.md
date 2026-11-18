# Fix comments and short transcripts in the YouTube userscript

## Objective
Comments never load, and some videos export a single transcript line. Both
come from the same root cause: the userscript runs in an isolated world, so
`window.ytcfg`, `window.ytInitialData` and `ytd-watch-flexy.playerResponse`
are invisible, and every Innertube strategy is skipped.

## Steps
- [x] Read Innertube config (API key, client name/version) from the page HTML and expose one cached connection used by transcripts and comments
- [x] Read caption tracks, transcript params and the comments continuation from the same HTML snapshot
- [x] Keep the comments continuation fallback through a `next` request
- [x] Add a DOM comments reader (rendered threads, no scrolling) used when both Innertube attempts return nothing
- [x] Reset a stale transcript search filter before reading the panel, and restore it afterwards
- [x] Treat a single-line transcript as suspicious: keep other strategies running without opening the panel, then keep the longest result
- [x] Bump the version, update the docs, verify with a harness built on the captured page HTML

## Risks
- The HTML snapshot is read once per video: a navigation must invalidate it.
- Comment parsing must keep working for both the modern `yt-comment-view-model` markup and the legacy renderer.
- The DOM comments fallback can only return what is rendered: partial output must be marked, not silently passed as complete.
- Existing transcript strategy order must stay the same, and the panel must still stay closed when a source already returned lines.

## Follow-up

The one-line transcript was not a filter problem: the panel renders the active
segment first, then the rest, and the reader took the first rendered node.
On the reported video the saved page holds 424 segments (0:00 to 27:06), so the
full transcript was always available a second later.

The reader now accumulates segments until the rendered list stops growing, sweeps
the list to its end to pull the last batch, sorts by timestamp, and restores the
scroll position. The panel path is also allowed when every other source returned
a single line, which is the case that produced the one-line export.

## Outcome

Shipped in `2026.11.18.4`.

The comments failure came from a missing Innertube configuration: `window.ytcfg`
and `window.ytInitialData` are not visible from the userscript context, so every
API path was skipped and the export printed `comments-status="innertube
unavailable"`. The configuration, the caption tracks, the transcript parameters
and the comments continuation are now read from the page HTML, which also
revealed a second bug: modern threads carry the comment under
`commentThreadRenderer.commentViewModel`, not `commentThreadRenderer.comment`,
so the parser returned nothing even with a valid response.

Checks: harness run against the watch page HTML and a real `/youtubei/v1/next`
comments payload captured from youtube.com. The exported continuation token was
verified end to end with a direct API call (HTTP 200, 21 threads).

Not verified: a live copy on a poToken-protected video, and whether the
transcript panel ever paginates its segments. If a single line still shows up,
`SYTER_DEBUG().attempts` will show which source produced it.
