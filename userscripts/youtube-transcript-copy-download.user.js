// ==UserScript==
// @name         YouTube.com — Transcript Copy & Download
// @description  Copy or download the transcript of the current YouTube video with timestamps and basic metadata.
// @version      2026.05.07.1
// @author       https://github.com/krkn-s
// @namespace    https://github.com/krkn-s
// @homepageURL  https://github.com/krkn-s/userscripts
// @supportURL   https://github.com/krkn-s/userscripts/issues
// @downloadURL  https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/youtube-transcript-copy-download.user.js
// @updateURL    https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/youtube-transcript-copy-download.user.js
// @match        https://youtube.com/*
// @match        https://*.youtube.com/*
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @run-at       document-idle
// @inject-into  content
// @license      MIT
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const PREFIX = 'SYTER';
    const HOST_ID = `${PREFIX}-button-bar`;
    const BUTTON_IDS = ['copy', 'download'];
    const TIMEDTEXT_MARKER = '/api/timedtext?';
    const DEBUG_REQUEST_EVENT = `${PREFIX}:debug-request`;
    const DEBUG_ATTR = 'data-syter-debug';
    const FORBIDDEN_TRANSCRIPT_CONTAINER_SELECTORS = [
        '#secondary',
        '#secondary-inner',
        '#related',
    ];
    const FORBIDDEN_TRANSCRIPT_SUBTREE_SELECTORS = [
        'ytd-compact-video-renderer',
        'ytd-playlist-panel-renderer',
        'ytd-comments',
        'ytd-comment-thread-renderer',
        'ytd-thumbnail',
        'ytd-thumbnail-overlay-time-status-renderer',
        'yt-thumbnail-view-model',
    ];
    const YT_HOSTS = new Set([
        'www.youtube.com',
        'youtube.com',
        'youtu.be',
        'm.youtube.com',
        'music.youtube.com'
    ]);
    const TRANSCRIPT_BUTTON_SELECTORS = [
        'button[aria-label*="transcript" i]',
        'button[aria-label*="transcription" i]',
        'tp-yt-paper-item[aria-label*="transcript" i]',
        'tp-yt-paper-item[aria-label*="transcription" i]',
        'yt-formatted-string[aria-label*="transcript" i]',
        'yt-formatted-string[aria-label*="transcription" i]',
    ];
    const TRANSCRIPT_TAB_KEYWORDS = [
        'transcript',
        'transcription',
        'transcripcion',
        'transcricao',
        'transkripsjon',
        'transkript',
        'trascrizione',
    ];

    const state = {
        videoId: null,
        transcriptCache: null,
        buttonRetryTimer: null,
        styleInjected: false,
        poToken: null,
        potCaptureInFlight: null,
        transcriptsByVideo: new Map(),
        transcriptParamsByVideo: new Map(),
        transcriptLanguagesByVideo: new Map(),
        lastStrategy: null,
        lastError: null,
        lastDomDebug: null,
        debugBridgeInjected: false,
        attemptLog: [],
    };

    const style = `
        .${PREFIX}-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 6px 12px;
            margin: 0;
            border: 1px solid var(--yt-spec-10-percent-layer, rgba(255, 255, 255, 0.2));
            border-radius: 16px;
            font: 500 13px/1.4 "Roboto","Arial",sans-serif;
            color: var(--yt-spec-text-primary, #fff);
            background: var(--yt-spec-static-overlay-background-brand, rgba(255, 255, 255, 0.12));
            cursor: pointer;
            transition: background 0.2s ease;
            white-space: nowrap;
        }
        html:not([dark]) .${PREFIX}-btn {
            color: var(--yt-spec-text-primary, #0f0f0f);
            background: rgba(15, 15, 15, 0.08);
            border-color: rgba(15, 15, 15, 0.16);
        }
        .${PREFIX}-btn:hover {
            background: var(--yt-spec-static-overlay-background-brand, rgba(255, 255, 255, 0.24));
        }
        html:not([dark]) .${PREFIX}-btn:hover {
            background: rgba(15, 15, 15, 0.16);
        }
        .${PREFIX}-bar {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
            margin: 0 0 0 12px;
        }
        .${PREFIX}-bar--fallback {
            margin: 12px 0;
        }
        .${PREFIX}-toast {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            padding: 10px 18px;
            border-radius: 18px;
            font: 500 14px/1.4 "Roboto","Arial",sans-serif;
            color: #fff;
            background: rgba(0, 0, 0, 0.85);
            z-index: 9999;
            opacity: 0;
            transition: opacity 0.2s ease;
        }
        .${PREFIX}-toast.--show {
            opacity: 1;
        }
        .${PREFIX}-toast.--error {
            background: rgba(187, 20, 20, 0.9);
        }
    `;

    init();

    function init() {
        log('script ready');
        injectStyleOnce();
        exposeDebugHelper();
        handleNavigation();
        window.addEventListener('yt-navigate-finish', handleNavigation);
        window.addEventListener('yt-page-data-updated', handleNavigation);
    }

    function extractVideoId(fromUrl = window.location.href) {
        if (!fromUrl) return null;
        let input = fromUrl;
        if (!/^https?:\/\//i.test(input)) {
            input = `https://${input}`;
        }
        try {
            const url = new URL(input);
            const host = url.hostname;
            if (!YT_HOSTS.has(host)) return null;

            const path = url.pathname;
            const params = url.searchParams;

            if (host === 'youtu.be') {
                const candidate = path.slice(1);
                return candidate || null;
            }

            if (host.includes('youtube.com')) {
                if (path === '/watch' && params.has('v')) {
                    return params.get('v') || null;
                }
                if (path.startsWith('/embed/') || path.startsWith('/v/')) {
                    return path.split('/')[2] || null;
                }
                if (path.startsWith('/shorts/') || path.startsWith('/live/')) {
                    return path.split('/')[2] || null;
                }
            }
        } catch (error) {
            return null;
        }
        return null;
    }

    function handleNavigation() {
        const videoId = extractVideoId();
        if (!videoId) {
            resetState();
            return;
        }

        if (videoId !== state.videoId) {
            state.videoId = videoId;
            const cachedLines = state.transcriptsByVideo.get(videoId);
            state.transcriptCache = Array.isArray(cachedLines) ? cachedLines : null;
            state.poToken = null;
            state.potCaptureInFlight = null;
            state.lastStrategy = null;
            state.lastError = null;
            state.lastDomDebug = null;
            state.attemptLog = [];
            log(`navigated to video ${videoId}`);
        }

        ensureButtons();
    }

    function resetState() {
        state.videoId = null;
        state.transcriptCache = null;
        state.poToken = null;
        state.potCaptureInFlight = null;
        state.lastStrategy = null;
        state.lastError = null;
        state.lastDomDebug = null;
        state.attemptLog = [];
        clearTimeout(state.buttonRetryTimer);
        state.buttonRetryTimer = null;
        destroyButtonHost();
    }

    function injectStyleOnce() {
        if (state.styleInjected) return;
        const el = document.createElement('style');
        el.textContent = style;
        document.head.appendChild(el);
        state.styleInjected = true;
    }

    function exposeDebugHelper() {
        try {
            window.SYTER_DEBUG = getDebugSnapshot;
            document.addEventListener(DEBUG_REQUEST_EVENT, writeDebugSnapshotToDom);
            writeDebugSnapshotToDom();
            injectPageDebugBridge();
        } catch (error) {
            logError('debug helper error', error);
        }
    }

    function getDebugSnapshot() {
        const roots = queryTranscriptRoots();
        const nodes = queryTranscriptNodes();
        return {
            videoId: state.videoId,
            url: window.location.href,
            lastStrategy: state.lastStrategy,
            lastError: state.lastError,
            cachedLines: state.transcriptCache?.length || 0,
            buttonHost: Boolean(document.getElementById(HOST_ID)),
            modernTranscriptRoot: describeNode(getModernTranscriptRoot()),
            modernSegmentCount: queryModernTranscriptSegments().length,
            transcriptRoots: roots.map(node => describeNode(node)).slice(0, 12),
            panelCandidates: buildPanelCandidateDebug(),
            rejectedRoots: collectRejectedTranscriptRootDebug(),
            transcriptRootCount: roots.length,
            transcriptNodeCount: nodes.length,
            visibleTimestampCount: countVisibleTranscriptTimestamps(roots),
            dom: state.lastDomDebug,
            textBlob: buildTextBlobDebug(roots),
            captionTracks: getCaptionTrackDebug(),
            transcriptParams: getTranscriptParamDebug(),
            attempts: state.attemptLog.slice(-16),
        };
    }

    function writeDebugSnapshotToDom() {
        try {
            document.documentElement.setAttribute(DEBUG_ATTR, JSON.stringify(getDebugSnapshot()));
        } catch (error) {
            document.documentElement.setAttribute(DEBUG_ATTR, JSON.stringify({
                error: error.message || String(error),
            }));
        }
    }

    function injectPageDebugBridge() {
        if (state.debugBridgeInjected) return;
        state.debugBridgeInjected = true;

        try {
            if (typeof unsafeWindow !== 'undefined') {
                unsafeWindow.SYTER_DEBUG = () => {
                    document.dispatchEvent(new Event(DEBUG_REQUEST_EVENT));
                    return JSON.parse(document.documentElement.getAttribute(DEBUG_ATTR) || '{}');
                };
            }
        } catch (error) {
            // Safari Userscripts may not expose unsafeWindow; the script bridge below covers that case.
        }

        try {
            const script = document.createElement('script');
            script.textContent = `
                window.SYTER_DEBUG = function () {
                    document.dispatchEvent(new Event(${JSON.stringify(DEBUG_REQUEST_EVENT)}));
                    try {
                        return JSON.parse(document.documentElement.getAttribute(${JSON.stringify(DEBUG_ATTR)}) || '{}');
                    } catch (error) {
                        return { error: error.message || String(error) };
                    }
                };
            `;
            (document.head || document.documentElement).appendChild(script);
            script.remove();
        } catch (error) {
            logError('debug bridge injection error', error);
        }
    }

    function ensureButtons() {
        const host = ensureButtonHost();
        if (!host) {
            scheduleButtonRetry();
            return;
        }

        if (BUTTON_IDS.every(id => document.getElementById(`${PREFIX}-${id}`))) {
            return;
        }

        clearButtons();
        const copyBtn = createButton('copy', 'Copy transcript', onCopy);
        const downloadBtn = createButton('download', 'Download .txt', onDownload);
        host.appendChild(copyBtn);
        host.appendChild(downloadBtn);

        log('buttons attached');
    }

    function scheduleButtonRetry() {
        clearTimeout(state.buttonRetryTimer);
        state.buttonRetryTimer = setTimeout(() => {
            if (state.videoId) ensureButtons();
        }, 400);
    }

    function ensureButtonHost() {
        let host = document.getElementById(HOST_ID);
        const target = getButtonHostTarget();

        if (target) {
            if (!host) {
                host = document.createElement('div');
                host.id = HOST_ID;
            }
            host.className = `${PREFIX}-bar`;
            if (host.parentNode !== target.parent || host.previousElementSibling !== target.after) {
                target.parent.insertBefore(host, target.after.nextSibling);
            }
            return host;
        }

        if (host) return host;

        const player = document.querySelector('ytd-watch-flexy #player');
        const below = document.querySelector('ytd-watch-flexy #below');
        if (!player?.parentNode && !below?.parentNode) return null;

        host = document.createElement('div');
        host.id = HOST_ID;
        host.className = `${PREFIX}-bar ${PREFIX}-bar--fallback`;

        if (below?.parentNode) {
            below.parentNode.insertBefore(host, below);
        } else {
            player.parentNode.insertBefore(host, player.nextSibling);
        }

        return host;
    }

    function getButtonHostTarget() {
        const watchMetadata = document.querySelector('ytd-watch-metadata');
        const topRow = watchMetadata?.querySelector('#top-row');
        if (!topRow) return null;

        const subscribeButton = topRow.querySelector('#subscribe-button');
        if (subscribeButton?.parentNode) {
            return {
                parent: subscribeButton.parentNode,
                after: subscribeButton,
            };
        }

        const owner = topRow.querySelector('#owner');
        if (owner?.parentNode) {
            return {
                parent: owner.parentNode,
                after: owner,
            };
        }

        return null;
    }

    function createButton(id, label, handler) {
        const btn = document.createElement('button');
        btn.id = `${PREFIX}-${id}`;
        btn.className = `${PREFIX}-btn`;
        btn.type = 'button';
        btn.textContent = label;
        btn.addEventListener('click', handler);
        return btn;
    }

    function clearButtons() {
        const host = document.getElementById(HOST_ID);
        if (!host) return;
        BUTTON_IDS.forEach(id => {
            const btn = document.getElementById(`${PREFIX}-${id}`);
            if (btn?.parentNode === host) host.removeChild(btn);
        });
    }

    function destroyButtonHost() {
        const host = document.getElementById(HOST_ID);
        if (!host) return;
        host.remove();
    }

    async function onCopy() {
        try {
            const text = await buildTranscriptText();
            await writeToClipboard(text);
            showToast('Transcript copied.');
        } catch (error) {
            rememberError(error);
            writeDebugSnapshotToDom();
            logDebugSnapshot();
            logError('copy failed', error);
            showToast(error.message || 'Unable to copy transcript.', true);
        }
    }

    async function onDownload() {
        try {
            const text = await buildTranscriptText();
            const info = getVideoInfo();
            const fileName = `${sanitize(info.title)}-${sanitize(info.channel)}.txt`;
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('Transcript downloaded.');
        } catch (error) {
            rememberError(error);
            writeDebugSnapshotToDom();
            logDebugSnapshot();
            logError('download failed', error);
            showToast(error.message || 'Unable to download transcript.', true);
        }
    }

    async function buildTranscriptText() {
        if (!state.videoId) {
            throw new Error('No video detected.');
        }

        const lines = await loadTranscriptLines();
        if (!lines.length) {
            throw new Error('Transcript is empty.');
        }

        const info = getVideoInfo();
        const headerParts = [
            `video-title="${info.title}"`,
            `video-author="${info.channel}"`,
        ];
        if (info.published) {
            headerParts.push(`video-published="${info.published}"`);
        }
        headerParts.push(`video-link="${info.url}"`, '----------------------------------------', '');
        return headerParts.join('\n') + lines.join('\n');
    }

    async function loadTranscriptLines() {
        if (state.transcriptCache) {
            if (!isContaminatedTranscriptLines(state.transcriptCache)) {
                return state.transcriptCache;
            }
            state.transcriptCache = null;
            state.transcriptsByVideo.delete(state.videoId);
        }

        const cached = state.transcriptsByVideo.get(state.videoId);
        if (cached?.length) {
            if (!isContaminatedTranscriptLines(cached)) {
                state.transcriptCache = cached;
                return cached;
            }
            state.transcriptsByVideo.delete(state.videoId);
        }

        recordAttempt('api:caption-tracks', 'start', getCaptionTrackDebug());
        const viaCaptionTrack = await fetchCaptionTrackTranscript();
        if (viaCaptionTrack?.length) {
            rememberError(null);
            recordAttempt('api:caption-tracks', 'success', { lines: viaCaptionTrack.length });
            state.transcriptCache = viaCaptionTrack;
            cacheTranscript(state.videoId, viaCaptionTrack);
            return viaCaptionTrack;
        }
        recordAttempt('api:caption-tracks', 'miss', getCaptionTrackDebug());

        recordAttempt('api:innertube', 'start', getTranscriptParamDebug());
        const viaInnertube = await fetchInnertubeTranscriptLines();
        if (viaInnertube?.length) {
            rememberError(null);
            recordAttempt('api:innertube', 'success', { lines: viaInnertube.length });
            state.transcriptCache = viaInnertube;
            return viaInnertube;
        }
        recordAttempt('api:innertube', 'miss', getTranscriptParamDebug());

        recordAttempt('dom:existing', 'start');
        const viaDomExisting = await fetchDomTranscript({ allowOpen: false });
        if (viaDomExisting.length) {
            rememberError(null);
            recordAttempt('dom:existing', 'success', { lines: viaDomExisting.length });
            state.transcriptCache = viaDomExisting;
            cacheTranscript(state.videoId, viaDomExisting);
            return viaDomExisting;
        }
        recordAttempt('dom:existing', 'miss');

        recordAttempt('dom:open-panel', 'start');
        const viaDomOpened = await fetchDomTranscript({ allowOpen: true });
        if (viaDomOpened.length) {
            rememberError(null);
            recordAttempt('dom:open-panel', 'success', { lines: viaDomOpened.length });
            state.transcriptCache = viaDomOpened;
            cacheTranscript(state.videoId, viaDomOpened);
            return viaDomOpened;
        }
        recordAttempt('dom:open-panel', 'miss');

        throw new Error('Transcript unavailable.');
    }

    async function fetchCaptionTrackTranscript() {
        rememberStrategy('api:timedtext');
        const track = pickCaptionTrack();
        if (!track || !track.baseUrl) {
            return null;
        }

        const baseUrl = track.baseUrl;
        const initialUrls = [];
        const fmtUrl = appendFmt(baseUrl);
        if (fmtUrl) initialUrls.push(fmtUrl);
        initialUrls.push(baseUrl);

        let pot = state.poToken || readPoTokenFromPerformance();
        if (pot) {
            state.poToken = pot;
            initialUrls.unshift(appendPoToken(fmtUrl, pot));
            initialUrls.unshift(appendPoToken(baseUrl, pot));
        }

        let lines = await fetchTranscriptFromUrls(initialUrls);
        if (lines?.length) {
            cacheTranscript(state.videoId, lines);
            return lines;
        }

        pot = await ensurePoToken();
        if (pot) {
            state.poToken = pot;
            const potUrls = [
                appendPoToken(appendFmt(baseUrl), pot),
                appendPoToken(baseUrl, pot),
            ];
            lines = await fetchTranscriptFromUrls(potUrls);
            if (lines?.length) {
                cacheTranscript(state.videoId, lines);
                return lines;
            }
        }

        return null;
    }

    async function fetchInnertubeTranscriptLines() {
        rememberStrategy('api:innertube');
        return fetchTranscriptFromInnertube(state.videoId);
    }

    function appendFmt(baseUrl) {
        if (!baseUrl) return baseUrl;
        try {
            const url = new URL(baseUrl);
            if (!url.searchParams.has('fmt')) {
                url.searchParams.set('fmt', 'json3');
            }
            return url.toString();
        } catch {
            if (/[\?&]fmt=/.test(baseUrl)) return baseUrl;
            const separator = baseUrl.includes('?') ? '&' : '?';
            return `${baseUrl}${separator}fmt=json3`;
        }
    }

    function appendPoToken(baseUrl, pot) {
        if (!baseUrl || !pot) return baseUrl;
        try {
            const url = new URL(baseUrl);
            url.searchParams.set('pot', pot);
            return url.toString();
        } catch {
            if (/[\?&]pot=/.test(baseUrl)) return baseUrl;
            const separator = baseUrl.includes('?') ? '&' : '?';
            return `${baseUrl}${separator}pot=${encodeURIComponent(pot)}`;
        }
    }

    function hasTranscriptEvents(data) {
        return !!(data && Array.isArray(data.events) && data.events.length);
    }

    function createLinesFromEvents(events) {
        const lines = [];
        for (const event of events) {
            if (!event?.segs?.length) continue;
            const text = event.segs.map(seg => seg?.utf8 || '').join('').replace(/\s+/g, ' ').trim();
            if (!text) continue;
            const time = formatTimestamp((event.tStartMs || 0) / 1000);
            lines.push(`${time} ${text}`);
        }
        return lines;
    }

    function uniqueUrls(urls) {
        const seen = new Set();
        const result = [];
        for (const url of urls) {
            if (!url) continue;
            if (seen.has(url)) continue;
            seen.add(url);
            result.push(url);
        }
        return result;
    }

    function parseTimedTextXml(xmlString) {
        if (typeof DOMParser === 'undefined') {
            return null;
        }
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlString, 'text/xml');
            if (!doc || doc.documentElement?.nodeName?.toLowerCase() === 'parsererror') {
                return null;
            }
            const textNodes = Array.from(doc.getElementsByTagName('text'));
            if (!textNodes.length) return null;

            const events = textNodes.map(node => {
                const startAttr = node.getAttribute('start');
                const tAttr = node.getAttribute('t');
                let startMs = 0;
                if (typeof tAttr === 'string') {
                    const tVal = Number(tAttr);
                    if (Number.isFinite(tVal)) {
                        startMs = Math.round(tVal);
                    }
                } else if (typeof startAttr === 'string') {
                    const startVal = Number(startAttr);
                    if (Number.isFinite(startVal)) {
                        startMs = Math.round(startVal * 1000);
                    }
                }
                const segText = node.textContent?.replace(/\s+/g, ' ').trim() || '';
                return {
                    tStartMs: startMs,
                    segs: [{ utf8: segText }],
                };
            });

            return { events };
        } catch (error) {
            logError('timedtext xml parse error', error);
            return null;
        }
    }

    async function downloadTimedText(url) {
        try {
            const res = await fetch(url, { credentials: 'same-origin' });
            if (!res.ok) {
                logError('timedtext fetch error', new Error(`HTTP ${res.status}`));
                return null;
            }
            const raw = await res.text();
            const cleaned = raw.replace(/^\)\]\}'\s*/, '').trim();
            if (!cleaned) {
                return null;
            }
            const firstChar = cleaned[0];
            if (firstChar === '{' || firstChar === '[') {
                try {
                    return JSON.parse(cleaned);
                } catch (error) {
                    logError('timedtext json parse error', error);
                    return null;
                }
            }
            if (cleaned.startsWith('<')) {
                return parseTimedTextXml(cleaned);
            }
            logError('timedtext parse warning', new Error('Unknown transcript format'));
            return null;
        } catch (error) {
            logError('timedtext fetch error', error);
            return null;
        }
    }

    async function fetchTranscriptFromUrls(urls) {
        const unique = uniqueUrls(urls);
        for (const url of unique) {
            const data = await downloadTimedText(url);
            if (!hasTranscriptEvents(data)) {
                continue;
            }
            const lines = createLinesFromEvents(data.events);
            if (lines.length) {
                return lines;
            }
        }
        return null;
    }

    function getCaptionTracks() {
        const response = getPlayerResponse();
        const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        return Array.isArray(tracks) ? tracks : [];
    }

    function pickCaptionTrack() {
        const tracks = getCaptionTracks();
        if (!tracks.length) return null;

        const preferredLanguage = navigator.language?.toLowerCase();
        const directMatch = preferredLanguage
            ? tracks.find(track => track.languageCode?.toLowerCase() === preferredLanguage)
            : null;
        return directMatch || tracks.find(track => !track.kind) || tracks[0];
    }

    function getCaptionTrackDebug() {
        const tracks = getCaptionTracks();
        const picked = pickCaptionTrack();
        return {
            count: tracks.length,
            languages: tracks.slice(0, 8).map(track => track?.languageCode || track?.name?.simpleText || ''),
            pickedLanguage: picked?.languageCode || '',
            pickedKind: picked?.kind || '',
            hasBaseUrl: Boolean(picked?.baseUrl),
        };
    }

    async function ensurePoToken() {
        if (state.poToken) return state.poToken;
        if (state.potCaptureInFlight) return state.potCaptureInFlight;

        const existing = readPoTokenFromPerformance();
        if (existing) {
            state.poToken = existing;
            return existing;
        }

        if (!window.performance || typeof performance.getEntriesByType !== 'function') {
            return null;
        }

        const capture = (async () => {
            const toggle = findSubtitleToggle();
            if (!toggle) return null;

            const initialPressed = toggle.getAttribute('aria-pressed');
            try {
                performance.clearResourceTimings?.();
            } catch (error) {
                // ignore environments that disallow clearing resource timings
            }

            toggle.click();
            await sleep(120);
            toggle.click();

            const pot = await waitForPoToken(1500);

            const currentPressed = toggle.getAttribute('aria-pressed');
            if (initialPressed === 'true' && currentPressed !== 'true') {
                toggle.click();
            } else if (initialPressed !== 'true' && currentPressed === 'true') {
                toggle.click();
            }

            return pot || readPoTokenFromPerformance();
        })();

        state.potCaptureInFlight = capture;
        const result = await capture;
        state.potCaptureInFlight = null;
        if (result) {
            state.poToken = result;
        }
        return result || null;
    }

    function readPoTokenFromPerformance() {
        if (!window.performance || typeof performance.getEntriesByType !== 'function') {
            return null;
        }
        const entries = performance.getEntriesByType('resource');
        for (let i = entries.length - 1; i >= 0; i -= 1) {
            const entry = entries[i];
            if (!entry?.name || typeof entry.name !== 'string') continue;
            if (!entry.name.includes(TIMEDTEXT_MARKER)) continue;
            try {
                const url = new URL(entry.name);
                const pot = url.searchParams.get('pot');
                if (pot) return pot;
            } catch (error) {
                // ignore malformed URLs
            }
        }
        return null;
    }

    function waitForPoToken(timeoutMs = 1500) {
        const deadline = Date.now() + timeoutMs;
        return new Promise(resolve => {
            (function poll() {
                const pot = readPoTokenFromPerformance();
                if (pot) {
                    resolve(pot);
                    return;
                }
                if (Date.now() >= deadline) {
                    resolve(null);
                    return;
                }
                setTimeout(poll, 80);
            })();
        });
    }

    function findSubtitleToggle() {
        return document.querySelector('button.ytp-subtitles-button');
    }

    function getPlayerResponse() {
        const flexy = document.querySelector('ytd-watch-flexy');
        if (flexy?.playerResponse) return flexy.playerResponse;
        if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;
        try {
            const responseText = document.querySelector('script#ytInitialPlayerResponse')?.textContent;
            if (responseText) return JSON.parse(responseText);
        } catch (error) {
            logError('player response parse error', error);
        }
        return null;
    }

    async function fetchDomTranscript(options = {}) {
        const { allowOpen = true } = options;

        rememberStrategy(allowOpen ? 'dom:existing' : 'dom:existing-only');
        await ensureTranscriptTabSelected();

        let modernLines = parseModernTranscript();
        if (modernLines.length) {
            state.lastDomDebug = buildDomDebug(queryModernTranscriptSegments(), modernLines.map(line => ({ line })));
            return modernLines;
        }

        let nodes = queryTranscriptNodes();
        if (nodes.length) {
            modernLines = parseModernTranscript();
            if (modernLines.length) {
                state.lastDomDebug = buildDomDebug(queryModernTranscriptSegments(), modernLines.map(line => ({ line })));
                return modernLines;
            }
            nodes = queryTranscriptNodes();
        } else if (allowOpen) {
            rememberStrategy('dom:open-panel');
            await openTranscriptPanel();
            await ensureTranscriptTabSelected();
            await waitForElement(() => (
                queryModernTranscriptSegments().length
                || queryTranscriptNodes().length
                || getModernTranscriptRoot()?.querySelector?.('[panel-content-visible], transcript-segment-view-model')
            ), 7000);

            rememberStrategy('dom:modern-opened');
            modernLines = parseModernTranscript();
            if (modernLines.length) {
                state.lastDomDebug = buildDomDebug(queryModernTranscriptSegments(), modernLines.map(line => ({ line })));
                return modernLines;
            }

            nodes = await waitForTranscriptNodes(7000);
        }
        if (!nodes.length) {
            rememberStrategy('dom:parse-text-blob');
            const blobLines = parseTranscriptTextBlob();
            if (blobLines.length) {
                state.lastDomDebug = buildDomDebug([], []);
                return blobLines;
            }
            state.lastDomDebug = buildDomDebug([], []);
            rememberError('transcript panel opened but no transcript segment nodes were found');
            return [];
        }

        rememberStrategy('dom:parse-segments');
        const parsed = nodes.map(parseTranscriptNode).filter(Boolean);
        const lines = dedupeLines(parsed.map(item => `${item.time} ${item.text}`));
        state.lastDomDebug = buildDomDebug(nodes, parsed);
        if (lines.length) {
            return lines;
        }

        rememberStrategy('dom:parse-text-blob');
        const blobLines = parseTranscriptTextBlob();
        if (blobLines.length) {
            return blobLines;
        }

        rememberError('dom parse produced no transcript lines');
        return [];
    }

    function queryTranscriptNodes() {
        const roots = queryTranscriptRoots();
        const segmentSelectors = [
            'transcript-segment-view-model',
            'ytd-transcript-segment-renderer',
            'yt-transcript-segment-renderer',
            'ytd-transcript-body-renderer ytd-transcript-segment-renderer',
            'yt-transcript-segment-list-renderer yt-transcript-segment-renderer',
            'ytd-transcript-segment-list-renderer ytd-transcript-segment-renderer',
            '.cue-group',
            '[class*="transcript"][class*="segment"]',
            '[class*="segment"][role="button"]',
            'button[aria-label*="transcript" i]',
        ];

        for (const root of roots) {
            for (const selector of segmentSelectors) {
                const nodes = Array.from(root.querySelectorAll(selector)).filter(isLikelyTranscriptNode);
                if (nodes.length) return nodes;
            }
        }
        return queryTimestampBackedTranscriptNodes(roots);
    }

    function queryTimestampBackedTranscriptNodes(roots) {
        const nodes = [];
        const timestampSelector = '.segment-timestamp, .cue-group-start-offset, .cue-time, .timestamp, [class*="timestamp"], [class*="time"]';
        roots.forEach(root => {
            root.querySelectorAll(timestampSelector).forEach(timeEl => {
                const candidate = findTranscriptSegmentContainer(timeEl, root);
                if (candidate && isLikelyTranscriptNode(candidate) && !nodes.includes(candidate)) {
                    nodes.push(candidate);
                }
            });
        });
        return nodes;
    }

    function findTranscriptSegmentContainer(timeEl, root) {
        let current = timeEl;
        while (current && current !== root && current !== document.body) {
            const tag = current.tagName?.toLowerCase() || '';
            if (/transcript.*segment|segment.*renderer|cue-group/.test(tag) || current.matches?.('[role="button"], [class*="segment"], [class*="cue"]')) {
                return current;
            }
            current = current.parentElement;
        }
        return timeEl.parentElement || null;
    }

    function getModernTranscriptRoot() {
        const scoredRoots = getScoredTranscriptRoots();
        const modern = scoredRoots.find(item => item.node.querySelector('transcript-segment-view-model'));
        return modern?.node || scoredRoots[0]?.node || null;
    }

    function queryModernTranscriptSegments() {
        const root = getModernTranscriptRoot();
        if (!root) return [];
        return Array.from(root.querySelectorAll('transcript-segment-view-model'));
    }

    function parseModernTranscript() {
        const lines = dedupeLines(queryModernTranscriptSegments()
            .map(parseModernTranscriptSegment)
            .filter(Boolean)
            .map(item => `${item.time} ${item.text}`));
        return isContaminatedTranscriptLines(lines) ? [] : lines;
    }

    function parseModernTranscriptSegment(node) {
        if (!node || isHiddenNode(node)) return null;
        const time = normalizeTimestamp(node.querySelector('.ytwTranscriptSegmentViewModelTimestamp')?.textContent)
            || extractTimestampFromText(node.textContent || '');
        if (!time) return null;

        const text = Array.from(node.querySelectorAll('.ytAttributedStringHost[role="text"], span[role="text"]'))
            .map(el => normalizeWhitespace(el.textContent || ''))
            .filter(Boolean)
            .join(' ');
        const cleaned = cleanTranscriptText(text || removeTimestampFromText(node.textContent || '', time), time);
        if (!cleaned) return null;
        return { time, text: cleaned };
    }

    function queryTranscriptRoots() {
        return getScoredTranscriptRoots().map(item => item.node);
    }

    function getScoredTranscriptRoots() {
        return findTranscriptPanelCandidates()
            .map(node => ({ node, score: scoreTranscriptRoot(node) }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score);
    }

    function findTranscriptPanelCandidates() {
        const selectors = [
            'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]',
            'yt-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]',
            'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
            'ytd-engagement-panel-section-list-renderer[target-id*="transcript" i]',
            'yt-engagement-panel-section-list-renderer[target-id*="transcript" i]',
            'ytd-transcript-search-panel-renderer',
            'ytd-transcript-renderer',
            'yt-transcript-renderer',
            'ytd-transcript-segment-list-renderer',
            'yt-transcript-segment-list-renderer',
            '#segments-container',
            'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]',
            'yt-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]',
            'ytd-engagement-panel-section-list-renderer',
            'yt-engagement-panel-section-list-renderer',
        ];
        const candidates = [];
        selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(node => {
                if (isLikelyTranscriptRoot(node) && !candidates.includes(node)) {
                    candidates.push(node);
                }
            });
        });
        return candidates;
    }

    function isLikelyTranscriptRoot(node) {
        if (!node || node === document) return false;
        return scoreTranscriptRoot(node) > 0;
    }

    function isForbiddenTranscriptNode(node) {
        if (!node || node === document) return false;
        const forbiddenContainer = FORBIDDEN_TRANSCRIPT_CONTAINER_SELECTORS.some(selector => {
            try {
                return Boolean(node.matches?.(selector));
            } catch {
                return false;
            }
        });
        if (forbiddenContainer) return true;

        return FORBIDDEN_TRANSCRIPT_SUBTREE_SELECTORS.some(selector => {
            try {
                return node.matches?.(selector) || Boolean(node.closest?.(selector));
            } catch {
                return false;
            }
        });
    }

    function hasTranscriptHeader(node) {
        const headerText = normalizeString(Array.from(node.querySelectorAll?.('h1, h2, h3, [id*="header" i], [class*="header" i], [role="heading"]') || [])
            .map(el => el.textContent || '')
            .join(' ')
            .slice(0, 1000));
        return TRANSCRIPT_TAB_KEYWORDS.some(keyword => headerText.includes(keyword));
    }

    function hasVisibleTranscriptContent(node) {
        if (!node || typeof node.querySelector !== 'function') return false;
        return Boolean(node.querySelector(
            'transcript-segment-view-model, [panel-content-visible], textarea[aria-label*="transcript" i], textarea[placeholder*="transcript" i], [role="tablist"] button[role="tab"]'
        ));
    }

    function isExplicitlyHiddenNode(node) {
        if (!node || node === document) return false;
        return node.hidden
            || node.getAttribute?.('hidden') !== null
            || node.getAttribute?.('aria-hidden') === 'true'
            || node.getAttribute?.('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN';
    }

    function isHiddenNode(node) {
        if (!node || node === document) return false;
        if (hasVisibleTranscriptContent(node)) return false;
        return isExplicitlyHiddenNode(node);
    }

    function scoreTranscriptRoot(node) {
        if (!node || node === document) return 0;
        if (isForbiddenTranscriptNode(node)) return 0;

        const hasVisibleContent = hasVisibleTranscriptContent(node);
        if (isExplicitlyHiddenNode(node) && !hasVisibleContent) return 0;

        const id = node.id || '';
        const tag = node.tagName?.toLowerCase() || '';
        const targetId = node.getAttribute?.('target-id') || '';
        const visibility = node.getAttribute?.('visibility') || '';
        const text = normalizeWhitespace(node.textContent || '').slice(0, 2500);
        const normalizedText = normalizeString(text);
        const segmentCount = node.querySelectorAll?.('transcript-segment-view-model').length || 0;
        const timestampNodeCount = node.querySelectorAll?.('.ytwTranscriptSegmentViewModelTimestamp, .segment-timestamp, .cue-group-start-offset, .cue-time, .timestamp').length || 0;
        const hasSearchInput = Boolean(node.querySelector?.('textarea[aria-label*="transcript" i], textarea[placeholder*="transcript" i]'));
        const hasTablist = Boolean(node.querySelector?.('[role="tablist"] button[role="tab"]'));
        const hasPanelVisible = Boolean(node.querySelector?.('[panel-content-visible]'));
        const hasSpinner = Boolean(node.querySelector?.('yt-content-loading-renderer, tp-yt-paper-spinner, tp-yt-paper-spinner-lite'));
        let score = 0;

        if (/PAmodern_transcript_view|engagement-panel-searchable-transcript|transcript/i.test(targetId)) score += 60;
        if (/transcript/.test(tag)) score += 20;
        if (id === 'segments-container') score += 20;
        if (visibility === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') score += 30;
        if (hasPanelVisible) score += 40;
        if (segmentCount) score += 120 + Math.min(segmentCount, 60);
        if (!segmentCount && timestampNodeCount) score += Math.min(timestampNodeCount * 3, 30);
        if (hasSearchInput) score += 20;
        if (hasTablist) score += 20;
        if (hasTranscriptHeader(node)) score += 10;
        if (TRANSCRIPT_TAB_KEYWORDS.some(keyword => normalizedText.includes(keyword))) score += 10;
        if (hasSpinner && !segmentCount && !hasPanelVisible) score -= 20;

        return Math.max(0, score);
    }

    function isLikelyTranscriptNode(node) {
        if (!node || typeof node.textContent !== 'string') return false;
        if (isForbiddenTranscriptNode(node) || isHiddenNode(node)) return false;

        const text = normalizeWhitespace(node.textContent);
        if (!text || text.length < 3) return false;
        const timestamps = text.match(/(?:^|\s)(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\s|$)/g) || [];
        const tag = node.tagName?.toLowerCase() || '';
        if (timestamps.length > 2 && !/transcript-segment-renderer|transcript-segment-view-model|cue-group/.test(tag)) {
            return false;
        }
        return extractTimestampFromText(text) !== null
            || !!node.querySelector?.('.segment-timestamp, .cue-group-start-offset, .cue-time, .timestamp, [class*="timestamp"], [class*="time"]');
    }

    function parseTranscriptNode(node) {
        if (!node) return null;
        if ((node.tagName || '').toLowerCase() === 'transcript-segment-view-model') {
            return parseModernTranscriptSegment(node);
        }

        const rawText = normalizeWhitespace(node.textContent || '');
        if (!rawText) return null;

        const timeEl = node.querySelector?.('.segment-timestamp, .cue-group-start-offset, .cue-time, .timestamp, [class*="timestamp"], [class*="time"]');
        const time = normalizeTimestamp(timeEl?.textContent) || extractTimestampFromText(rawText);
        if (!time) return null;

        const textEl = node.querySelector?.('.segment-text, .cue, .cue-text, yt-formatted-string.segment-text, yt-formatted-string:not(.segment-timestamp), [class*="segment-text"], [class*="cue-text"]');
        let text = normalizeWhitespace(textEl?.textContent || '');
        if (!text || text === time) {
            text = removeTimestampFromText(rawText, time);
        }
        text = cleanTranscriptText(text, time);
        if (!text) return null;

        return { time, text };
    }

    function extractTimestampFromText(text) {
        const match = normalizeWhitespace(text).match(/(?:^|\s)((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\s|$)/);
        return match ? normalizeTimestamp(match[1]) : null;
    }

    function normalizeTimestamp(value) {
        const text = normalizeWhitespace(value || '');
        const match = text.match(/(?:^|\s)((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\s|$)/);
        if (!match) return '';

        const parts = match[1].split(':').map(part => part.padStart(2, '0'));
        if (parts.length === 2) return `${parts[0]}:${parts[1]}`;
        if (parts.length === 3) return `${parts[0]}:${parts[1]}:${parts[2]}`;
        return match[1];
    }

    function removeTimestampFromText(text, time) {
        const normalized = normalizeWhitespace(text);
        const escaped = escapeRegExp(time.replace(/^0(?=\d:)/, ''));
        return normalizeWhitespace(normalized
            .replace(new RegExp(`(?:^|\\s)${escapeRegExp(time)}(?:\\s|$)`, 'g'), ' ')
            .replace(new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, 'g'), ' '));
    }

    function cleanTranscriptText(text, time) {
        return normalizeWhitespace(removeTimestampFromText(text, time)
            .replace(/\b(?:Replay|Play|Pause|More actions|Show more|Show less|Search|Transcript)\b/gi, ' ')
            .replace(/\s*-\s*$/, ''));
    }

    function parseTranscriptTextBlob() {
        const root = findBestTranscriptTextRoot();
        if (!root) return [];
        if (!isSafeTextBlobTranscriptRoot(root)) return [];

        const raw = getCleanTranscriptRootText(root);
        const matches = collectTimestampMatches(raw);
        if (matches.length < 1) return [];

        const lines = [];
        for (let i = 0; i < matches.length; i += 1) {
            const current = matches[i];
            const next = matches[i + 1];
            const chunk = raw.slice(current.end, next ? next.start : raw.length);
            const text = cleanTranscriptTextBlobChunk(chunk);
            if (!text) continue;
            lines.push(`${normalizeTimestamp(current.value)} ${text}`);
        }
        const deduped = dedupeLines(lines);
        return isContaminatedTranscriptLines(deduped) ? [] : deduped;
    }

    function findBestTranscriptTextRoot() {
        const candidates = queryTranscriptRoots().filter(node => node && node !== document && !isForbiddenTranscriptNode(node) && !isHiddenNode(node) && isSafeTextBlobTranscriptRoot(node));
        if (!candidates.length) {
            const fallbackSelectors = [
                'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]',
                'yt-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]',
                'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
                'ytd-engagement-panel-section-list-renderer[target-id*="transcript" i]',
                'ytd-transcript-search-panel-renderer',
                'ytd-transcript-renderer',
                'yt-transcript-renderer',
                '#segments-container',
            ];
            fallbackSelectors.forEach(selector => {
                document.querySelectorAll(selector).forEach(node => {
                    if (isLikelyTranscriptRoot(node) && isSafeTextBlobTranscriptRoot(node) && !candidates.includes(node)) {
                        candidates.push(node);
                    }
                });
            });
        }

        let best = null;
        let bestScore = 0;
        candidates.forEach(node => {
            const text = getCleanTranscriptRootText(node);
            const timestampCount = countTimestampsInText(text);
            if (!timestampCount) return;
            if (!isLikelyTranscriptRoot(node)) return;

            const transcriptHint = TRANSCRIPT_TAB_KEYWORDS.some(keyword => normalizeString(text).includes(keyword)) ? 10 : 0;
            const targetBonus = /transcript/i.test(node.getAttribute?.('target-id') || '') ? 20 : 0;
            const score = timestampCount + transcriptHint + targetBonus - Math.min(8, Math.floor(text.length / 5000));
            if (score > bestScore) {
                best = node;
                bestScore = score;
            }
        });
        return best;
    }

    function isSafeTextBlobTranscriptRoot(node) {
        if (!node || node === document) return false;
        if (isForbiddenTranscriptNode(node) || isHiddenNode(node)) return false;
        const tag = node.tagName?.toLowerCase() || '';
        const targetId = node.getAttribute?.('target-id') || '';
        const id = node.id || '';
        return /PAmodern_transcript_view|engagement-panel-searchable-transcript|transcript/i.test(targetId)
            || /transcript/.test(tag)
            || id === 'segments-container';
    }

    function getCleanTranscriptRootText(root) {
        if (!root) return '';
        const clone = root.cloneNode(true);
        FORBIDDEN_TRANSCRIPT_SUBTREE_SELECTORS.forEach(selector => {
            try {
                clone.querySelectorAll(selector).forEach(node => node.remove());
            } catch {
                // ignore invalid selectors in older userscript engines
            }
        });
        return normalizeWhitespace(clone.textContent || '');
    }

    function collectTimestampMatches(text) {
        const matches = [];
        const regex = /(^|\s)((?:\d{1,2}:)?\d{1,2}:\d{2})(?=\s|$)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const start = match.index + match[1].length;
            matches.push({
                value: match[2],
                start,
                end: start + match[2].length,
            });
        }
        return matches;
    }

    function countTimestampsInText(text) {
        return collectTimestampMatches(normalizeWhitespace(text || '')).length;
    }

    function countVisibleTranscriptTimestamps(roots = queryTranscriptRoots()) {
        return roots.reduce((count, root) => count + countTimestampsInText(root.textContent || ''), 0);
    }

    function cleanTranscriptTextBlobChunk(chunk) {
        const text = normalizeWhitespace(chunk)
            .replace(/\b(?:Transcript|Search|Search transcript|More actions|Show more|Show less|Chapters|Chapter)\b/gi, ' ')
            .replace(/\b(?:Replay|Play|Pause|Mute|Settings|Subtitles\/closed captions)\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!text) return '';
        if (countTimestampsInText(text) > 0) return '';
        if (text.length < 2) return '';
        return text;
    }

    function buildDomDebug(nodes, parsed) {
        const roots = queryTranscriptRoots();
        const modernSegments = queryModernTranscriptSegments();
        return {
            modernTranscriptRoot: describeNode(getModernTranscriptRoot()),
            modernSegmentCount: modernSegments.length,
            modernSamples: modernSegments.slice(0, 5).map(node => {
                const parsed = parseModernTranscriptSegment(node);
                return parsed ? `${parsed.time} ${parsed.text}` : normalizeWhitespace(node.textContent || '').slice(0, 240);
            }),
            roots: roots.map(node => describeNode(node)).slice(0, 8),
            panelCandidates: buildPanelCandidateDebug(),
            rejectedRoots: collectRejectedTranscriptRootDebug(),
            nodeCount: nodes.length,
            parsedCount: parsed.length,
            visibleTimestampCount: countVisibleTranscriptTimestamps(roots),
            textBlob: buildTextBlobDebug(roots),
            samples: nodes.slice(0, 5).map(node => ({
                node: describeNode(node),
                text: normalizeWhitespace(node.textContent || '').slice(0, 240),
            })),
        };
    }

    function buildTextBlobDebug(roots = queryTranscriptRoots()) {
        const root = findBestTranscriptTextRoot();
        const text = root ? getCleanTranscriptRootText(root) : '';
        return {
            bestRoot: describeNode(root),
            rootCount: roots.length,
            timestampCount: text ? countTimestampsInText(text) : 0,
            sample: text.slice(0, 500),
        };
    }

    function buildPanelCandidateDebug() {
        return findTranscriptPanelCandidates().slice(0, 10).map(node => {
            const text = getCleanTranscriptRootText(node);
            return {
                node: describeNode(node),
                score: scoreTranscriptRoot(node),
                targetId: node.getAttribute?.('target-id') || '',
                visibility: node.getAttribute?.('visibility') || '',
                hidden: isHiddenNode(node),
                forbidden: isForbiddenTranscriptNode(node),
                segmentCount: node.querySelectorAll?.('transcript-segment-view-model').length || 0,
                hasPanelVisible: Boolean(node.querySelector?.('[panel-content-visible]')),
                hasTablist: Boolean(node.querySelector?.('[role="tablist"] button[role="tab"]')),
                timestampCount: countTimestampsInText(text),
                sample: text.slice(0, 220),
            };
        });
    }

    function collectRejectedTranscriptRootDebug() {
        const selectors = [
            'ytd-engagement-panel-section-list-renderer',
            'yt-engagement-panel-section-list-renderer',
            '#panels',
            '#secondary-inner',
        ];
        const rejected = [];
        selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(node => {
                if (rejected.length >= 8) return;
                if (isLikelyTranscriptRoot(node)) return;
                const text = getCleanTranscriptRootText(node);
                rejected.push({
                    node: describeNode(node),
                    forbidden: isForbiddenTranscriptNode(node),
                    hidden: isHiddenNode(node),
                    timestampCount: countTimestampsInText(text),
                    sample: text.slice(0, 180),
                });
            });
        });
        return rejected;
    }

    async function waitForTranscriptNodes(timeout = 5000) {
        const existing = queryTranscriptNodes();
        if (existing.length) {
            return existing;
        }

        return new Promise(resolve => {
            const observer = new MutationObserver(() => {
                const nodes = queryTranscriptNodes();
                if (nodes.length) {
                    cleanup();
                    resolve(nodes);
                }
            });

            const timer = setTimeout(() => {
                cleanup();
                resolve(queryTranscriptNodes());
            }, timeout);

            const cleanup = () => {
                observer.disconnect();
                clearTimeout(timer);
            };

            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    async function openTranscriptPanel() {
        const existingNodes = queryTranscriptNodes();
        if (existingNodes.length) return;

        const button = findTranscriptButton();
        if (button) {
            button.click();
            return;
        }

        const overflow = document.querySelector('#menu button[aria-label*="more actions" i], #actions button[aria-label*="more actions" i]');
        if (overflow) {
            overflow.click();
            const item = await waitForTranscriptMenuItem(1500);
            if (item) item.click();
        }
    }

    function findTranscriptButton() {
        const scopes = [
            document.querySelector('ytd-watch-metadata'),
            document.querySelector('#actions'),
            document.querySelector('#primary'),
            document,
        ].filter(Boolean);

        for (const scope of scopes) {
            for (const selector of TRANSCRIPT_BUTTON_SELECTORS) {
                const el = scope.querySelector(selector);
                const clickable = closestClickable(el);
                if (clickable) return clickable;
            }
        }
        return null;
    }

    function closestClickable(el) {
        if (!el) return null;
        if (typeof el.click === 'function' && /^(button|tp-yt-paper-item)$/i.test(el.tagName || '')) {
            return el;
        }
        return el.closest?.('button, tp-yt-paper-item, ytd-menu-service-item-renderer, a') || null;
    }

    function waitForTranscriptMenuItem(timeout = 1500) {
        return waitForElement(() => findTranscriptButton(), timeout);
    }

    async function ensureTranscriptTabSelected() {
        const tablist = await waitForElement(() => {
            const root = getModernTranscriptRoot() || queryTranscriptRoots()[0];
            return root?.querySelector?.('[role="tablist"]')
                || document.querySelector('chip-bar-view-model [role="tablist"], ytd-transcript-search-panel-renderer [role="tablist"]');
        }, 2000);
        if (!tablist) return;

        const tabs = Array.from(tablist.querySelectorAll('button[role="tab"], tp-yt-paper-tab'));
        if (!tabs.length) return;

        const chapterTab = tabs.find(tab => {
            const label = (tab.getAttribute('aria-label') || tab.textContent || '').trim();
            if (!label) return false;
            const normalized = normalizeString(label);
            return normalized.includes('chapitre')
                || normalized.includes('chapters')
                || normalized.includes('chapter')
                || normalized.includes('capit')
                || normalized.includes('kapitel');
        });

        const transcriptTab = tabs.find(tab => {
            const label = (tab.getAttribute('aria-label') || tab.textContent || '').trim();
            if (!label) return false;
            const normalized = normalizeString(label);
            return TRANSCRIPT_TAB_KEYWORDS.some(keyword => normalized.includes(keyword));
        });

        if (chapterTab && transcriptTab && transcriptTab.getAttribute('aria-selected') !== 'true') {
            chapterTab.click();
            await sleep(800);
            transcriptTab.click();
            await sleep(300);
        } else if (transcriptTab && transcriptTab.getAttribute('aria-selected') !== 'true') {
            transcriptTab.click();
            await sleep(120);
        }
    }

    async function fetchTranscriptFromInnertube(videoId) {
        if (!videoId) return null;

        const params = await ensureTranscriptParams(videoId);
        if (!params) return null;

        const apiKey = getInnertubeApiKey();
        const context = getInnertubeContext();
        if (!apiKey || !context) return null;

        const headers = getInnertubeHeaders();

        try {
            const triedParams = new Set();
            triedParams.add(params);

            const first = await requestInnertubeTranscript(apiKey, context, headers, params);
            if (first) {
                if (first.defaultParam) {
                    storeTranscriptParam(videoId, first.defaultParam);
                }
                if (first.languageParams.length) {
                    state.transcriptLanguagesByVideo.set(videoId, first.languageParams);
                    if (state.transcriptLanguagesByVideo.size > 6) {
                        const oldestLangKey = state.transcriptLanguagesByVideo.keys().next().value;
                        if (oldestLangKey && oldestLangKey !== videoId) {
                            state.transcriptLanguagesByVideo.delete(oldestLangKey);
                        }
                    }
                    first.languageParams.forEach(item => {
                        if (item.selected && item.params) {
                            storeTranscriptParam(videoId, item.params);
                        }
                    });
                }
                if (first.lines.length) {
                    cacheTranscript(videoId, first.lines);
                    state.transcriptCache = first.lines;
                    return first.lines;
                }

                for (const item of first.languageParams) {
                    if (!item?.params || triedParams.has(item.params)) continue;
                    triedParams.add(item.params);
                    const alt = await requestInnertubeTranscript(apiKey, context, headers, item.params);
                    if (!alt) continue;
                    if (alt.defaultParam) {
                        storeTranscriptParam(videoId, alt.defaultParam);
                    }
                    if (alt.lines.length) {
                        cacheTranscript(videoId, alt.lines);
                        state.transcriptCache = alt.lines;
                        return alt.lines;
                    }
                }

                const cachedLanguages = state.transcriptLanguagesByVideo.get(videoId) || [];
                for (const item of cachedLanguages) {
                    if (!item?.params || triedParams.has(item.params)) continue;
                    triedParams.add(item.params);
                    const alt = await requestInnertubeTranscript(apiKey, context, headers, item.params);
                    if (!alt) continue;
                    if (alt.defaultParam) {
                        storeTranscriptParam(videoId, alt.defaultParam);
                    }
                    if (alt.lines.length) {
                        cacheTranscript(videoId, alt.lines);
                        state.transcriptCache = alt.lines;
                        return alt.lines;
                    }
                }
            }
        } catch (error) {
            logError('innertube fetch error', error);
        }

        return null;
    }

    async function ensureTranscriptParams(videoId) {
        if (!videoId) return null;

        const existing = state.transcriptParamsByVideo.get(videoId);
        if (existing) return existing;

        const fromInitial = findTranscriptParamInObject(window.ytInitialData) || findTranscriptParamInObject(window.__ytInitialData);
        if (fromInitial) {
            const decoded = decodeParam(fromInitial);
            storeTranscriptParam(videoId, decoded);
            return decoded;
        }

        const fromDocument = extractTranscriptParamFromDocument();
        if (fromDocument) {
            storeTranscriptParam(videoId, fromDocument);
            return fromDocument;
        }

        const fromFetch = await fetchTranscriptParamFromWatch(videoId);
        if (fromFetch) {
            storeTranscriptParam(videoId, fromFetch);
            return fromFetch;
        }

        return null;
    }

    function parseTranscriptResponse(data) {
        const result = {
            lines: [],
            defaultParam: null,
            languageParams: [],
        };

        const panels = collectTranscriptPanels(data);
        panels.forEach(panel => {
            if (!panel || typeof panel !== 'object') return;

            const renderer = panel.transcriptSearchPanelRenderer || panel.transcriptRenderer || panel;
            if (!renderer || typeof renderer !== 'object') return;

            const header = renderer.header?.transcriptSearchBoxRenderer;
            const headerParam = header?.onTextChangeCommand?.getTranscriptEndpoint?.params;
            if (headerParam && !result.defaultParam) {
                result.defaultParam = decodeParam(headerParam);
            }

            const bodyRenderer = renderer.body?.transcriptSegmentListRenderer
                || renderer.transcriptSegmentListRenderer
                || renderer.segmentListRenderer
                || renderer;
            const segments = bodyRenderer?.segments || bodyRenderer?.initialSegments || [];
            segments.forEach(item => {
                const segRenderer = item?.transcriptSegmentRenderer
                    || item?.transcriptSearchPanelSegmentRenderer?.segment
                    || item?.segment
                    || item;
                if (!segRenderer || typeof segRenderer !== 'object') return;
                const startMs = Number(segRenderer.startMs ?? segRenderer.startTimeMs ?? segRenderer.tStartMs ?? segRenderer.startTime ?? 0);
                const runs = segRenderer.snippet?.runs || segRenderer.subtitleText?.runs || segRenderer.bodyText?.runs || [];
                const text = extractTextFromRuns(runs);
                if (!text) return;
                const time = formatTimestamp(startMs / 1000);
                result.lines.push(`${time} ${text}`);
            });

            const footer = renderer.footer?.transcriptFooterRenderer || renderer.transcriptFooterRenderer;
            const subMenuItems = footer?.languageMenu?.sortFilterSubMenuRenderer?.subMenuItems || [];
            subMenuItems.forEach(item => {
                const label = item?.title || '';
                const continuation = item?.continuation?.reloadContinuationData?.continuation;
                if (!label || !continuation) return;
                const decoded = decodeParam(continuation);
                result.languageParams.push({
                    label,
                    params: decoded,
                    selected: Boolean(item.selected),
                });
                if (item.selected && decoded) {
                    result.defaultParam = decoded;
                }
            });
        });

        result.lines = dedupeLines(result.lines);
        return result;
    }

    function collectTranscriptPanels(data) {
        const panels = [];
        if (!data || typeof data !== 'object') return panels;

        const queue = [data];
        const seen = new Set();

        while (queue.length) {
            const current = queue.shift();
            if (!current || typeof current !== 'object') continue;
            if (seen.has(current)) continue;
            seen.add(current);

            if (current.transcriptSearchPanelRenderer && current.transcriptSearchPanelRenderer.body) {
                panels.push(current.transcriptSearchPanelRenderer);
            } else if (current.transcriptRenderer && current.transcriptRenderer.body) {
                panels.push(current.transcriptRenderer);
            } else if (current.body?.transcriptSegmentListRenderer) {
                panels.push(current);
            }

            for (const value of Object.values(current)) {
                if (!value) continue;
                if (Array.isArray(value)) {
                    value.forEach(item => {
                        if (item && typeof item === 'object') queue.push(item);
                    });
                } else if (typeof value === 'object') {
                    queue.push(value);
                }
            }
        }

        return panels;
    }

    function decodeParam(param) {
        if (typeof param !== 'string') return param;
        return param.replace(/\\u0026/g, '&').replace(/\u0026/g, '&');
    }

    function ytcfgGet(key) {
        try {
            if (typeof window.ytcfg?.get === 'function') {
                const value = window.ytcfg.get(key);
                if (value !== undefined) return value;
            }
        } catch (error) {
            logError('ytcfg get error', error);
        }
        const dataStore = window.ytcfg?.data_;
        if (dataStore && Object.prototype.hasOwnProperty.call(dataStore, key)) {
            return dataStore[key];
        }
        return undefined;
    }

    function getInnertubeApiKey() {
        return ytcfgGet('INNERTUBE_API_KEY');
    }

    function getInnertubeContext() {
        const context = ytcfgGet('INNERTUBE_CONTEXT');
        if (!context) return null;
        return cloneData(context);
    }

    function getInnertubeHeaders() {
        const headers = {
            'Content-Type': 'application/json',
        };
        const clientName = ytcfgGet('INNERTUBE_CONTEXT_CLIENT_NAME');
        const clientVersion = ytcfgGet('INNERTUBE_CONTEXT_CLIENT_VERSION');
        if (clientName) headers['X-Youtube-Client-Name'] = String(clientName);
        if (clientVersion) headers['X-Youtube-Client-Version'] = String(clientVersion);
        return headers;
    }

    function cloneData(value) {
        try {
            return value ? JSON.parse(JSON.stringify(value)) : value;
        } catch {
            return value;
        }
    }

    function findTranscriptParamInObject(obj, seen = new Set()) {
        if (!obj || typeof obj !== 'object') return null;
        if (seen.has(obj)) return null;
        seen.add(obj);

        if (obj.getTranscriptEndpoint?.params) {
            return decodeParam(obj.getTranscriptEndpoint.params);
        }

        if (Array.isArray(obj)) {
            for (const item of obj) {
                const found = findTranscriptParamInObject(item, seen);
                if (found) return found;
            }
        } else {
            for (const key of Object.keys(obj)) {
                const value = obj[key];
                if (typeof value !== 'object' || value === null) continue;
                const found = findTranscriptParamInObject(value, seen);
                if (found) return found;
            }
        }

        return null;
    }

    function extractTranscriptParamFromDocument() {
        try {
            const html = document.documentElement?.innerHTML;
            if (!html) return null;
            return extractParamFromHtml(html);
        } catch {
            return null;
        }
    }

    async function fetchTranscriptParamFromWatch(videoId) {
        try {
            const url = `${location.origin}/watch?v=${encodeURIComponent(videoId)}&bp=0`;
            const response = await fetch(url, { credentials: 'same-origin' });
            if (!response.ok) return null;
            const html = await response.text();
            return extractParamFromHtml(html);
        } catch (error) {
            logError('fetch watch error', error);
            return null;
        }
    }

    function extractParamFromHtml(html) {
        if (!html) return null;
        const marker = '"getTranscriptEndpoint":{"params":"';
        const idx = html.indexOf(marker);
        if (idx === -1) return null;
        const start = idx + marker.length;
        const end = html.indexOf('"', start);
        if (end === -1) return null;
        const raw = html.slice(start, end);
        return decodeParam(raw);
    }

    async function requestInnertubeTranscript(apiKey, context, headers, params) {
        if (!apiKey || !context || !params) return null;
        const response = await fetch(`${location.origin}/youtubei/v1/get_transcript?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify({ context: cloneData(context), params }),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        return parseTranscriptResponse(data);
    }

    function cacheTranscript(videoId, lines) {
        if (!videoId || !Array.isArray(lines) || !lines.length) return;
        if (isContaminatedTranscriptLines(lines)) return;
        state.transcriptsByVideo.set(videoId, lines);
        if (state.transcriptsByVideo.size > 6) {
            const oldestKey = state.transcriptsByVideo.keys().next().value;
            if (oldestKey && oldestKey !== videoId) {
                state.transcriptsByVideo.delete(oldestKey);
            }
        }
    }

    function isContaminatedTranscriptLines(lines) {
        if (!Array.isArray(lines) || !lines.length) return false;
        const sample = normalizeString(lines.slice(0, 8).join(' '));
        const contaminationMarkers = [
            'videos similaires',
            'commentaires',
            'a venir',
            'en cours de lecture',
            'j aime',
            'vues',
        ];
        const markerCount = contaminationMarkers.reduce((count, marker) => count + (sample.includes(marker) ? 1 : 0), 0);
        return sample.includes('videos similaires')
            || sample.includes('en cours de lecture')
            || markerCount >= 2;
    }

    function storeTranscriptParam(videoId, param) {
        if (!videoId || !param) return;
        state.transcriptParamsByVideo.set(videoId, param);
        if (state.transcriptParamsByVideo.size > 10) {
            const oldestKey = state.transcriptParamsByVideo.keys().next().value;
            if (oldestKey && oldestKey !== videoId) {
                state.transcriptParamsByVideo.delete(oldestKey);
            }
        }
    }

    function getTranscriptParamDebug() {
        const cached = state.videoId ? state.transcriptParamsByVideo.get(state.videoId) : null;
        return {
            cached: Boolean(cached),
            cachedPreview: typeof cached === 'string' ? cached.slice(0, 32) : '',
            knownLanguages: state.videoId ? (state.transcriptLanguagesByVideo.get(state.videoId)?.length || 0) : 0,
        };
    }

    function extractTextFromRuns(runs) {
        if (!Array.isArray(runs) || !runs.length) return '';
        return runs.map(run => run?.text || '').join('').replace(/\s+/g, ' ').trim();
    }

    function dedupeLines(lines) {
        if (!Array.isArray(lines) || lines.length === 0) return [];
        const seen = new Set();
        const result = [];
        for (const line of lines) {
            if (!line) continue;
            if (seen.has(line)) continue;
            seen.add(line);
            result.push(line);
        }
        return result;
    }

    function waitForElement(getter, timeout = 3000, interval = 100) {
        const result = getter();
        if (result) return Promise.resolve(result);
        return new Promise(resolve => {
            const deadline = Date.now() + timeout;
            (function poll() {
                const value = getter();
                if (value) {
                    resolve(value);
                    return;
                }
                if (Date.now() >= deadline) {
                    resolve(null);
                    return;
                }
                setTimeout(poll, interval);
            })();
        });
    }

    function writeToClipboard(text) {
        const gmClipboard = typeof GM_setClipboard === 'function'
            ? GM_setClipboard
            : (typeof GM !== 'undefined' && typeof GM.setClipboard === 'function' ? GM.setClipboard : null);

        if (navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(text).catch(err => {
                if (gmClipboard) {
                    gmClipboard(text);
                    return;
                }
                throw err;
            });
        }
        if (gmClipboard) {
            gmClipboard(text);
            return Promise.resolve();
        }
        return Promise.reject(new Error('Clipboard API unavailable.'));
    }

    function getVideoInfo() {
        const titleNode = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
        const channelNode = document.querySelector('ytd-video-owner-renderer #text a');
        const dateNode = document.querySelector('#info-strings yt-formatted-string');
        return {
            title: titleNode?.textContent?.trim() || 'N/A',
            channel: channelNode?.textContent?.trim() || 'N/A',
            published: dateNode?.textContent?.trim() || '',
            url: window.location.href,
        };
    }

    function formatTimestamp(seconds) {
        const total = Math.max(0, Math.floor(seconds));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const parts = [
            h > 0 ? String(h).padStart(2, '0') : null,
            String(h > 0 ? m : Math.max(m, 0)).padStart(2, '0'),
            String(s).padStart(2, '0'),
        ].filter(Boolean);
        return parts.join(':');
    }

    function sanitize(str) {
        return str
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/gi, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase() || 'youtube-transcript';
    }

    function normalizeString(str = '') {
        return str
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
    }

    function normalizeWhitespace(str = '') {
        return String(str).replace(/\s+/g, ' ').trim();
    }

    function escapeRegExp(str = '') {
        return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function describeNode(node) {
        if (!node || node === document) return '#document';
        const tag = node.tagName?.toLowerCase() || 'node';
        const id = node.id ? `#${node.id}` : '';
        const classes = typeof node.className === 'string'
            ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 4).map(name => `.${name}`).join('')
            : '';
        const attrs = [
            node.getAttribute?.('target-id') ? `target-id="${node.getAttribute('target-id')}"` : '',
            node.getAttribute?.('visibility') ? `visibility="${node.getAttribute('visibility')}"` : '',
            node.getAttribute?.('aria-label') ? `aria-label="${node.getAttribute('aria-label')}"` : '',
            node.hidden ? 'hidden' : '',
        ].filter(Boolean);
        return `${tag}${id}${classes}${attrs.length ? ` [${attrs.join(' ')}]` : ''}`;
    }

    function rememberStrategy(strategy) {
        state.lastStrategy = strategy;
    }

    function recordAttempt(name, status, details) {
        const entry = { name, status };
        if (details && typeof details === 'object') {
            Object.assign(entry, details);
        }
        state.attemptLog.push(entry);
        if (state.attemptLog.length > 40) {
            state.attemptLog.shift();
        }
    }

    function rememberError(error) {
        if (!error) {
            state.lastError = null;
            return;
        }
        state.lastError = typeof error === 'string'
            ? error
            : (error.message || String(error));
    }

    function logDebugSnapshot() {
        try {
            console.info(`[${PREFIX}] debug snapshot`, getDebugSnapshot());
        } catch (error) {
            console.info(`[${PREFIX}] debug snapshot unavailable`, error);
        }
    }

    function showToast(message, isError = false) {
        const existing = document.querySelector(`.${PREFIX}-toast`);
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `${PREFIX}-toast${isError ? ' --error' : ''}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('--show'));
        setTimeout(() => {
            toast.classList.remove('--show');
            setTimeout(() => toast.remove(), 200);
        }, isError ? 4000 : 2500);
    }

    function log(message) {
        console.log(`[${PREFIX}] ${message}`);
    }

    function logError(message, error) {
        if (
            message.startsWith('timedtext') ||
            message === 'fetch wrapper error' ||
            message === 'fetch watch error' ||
            message === 'ytcfg get error'
        ) {
            console.debug(`[${PREFIX}] ${message}`, error);
            return;
        }
        console.error(`[${PREFIX}] ${message}`, error);
    }
})();
