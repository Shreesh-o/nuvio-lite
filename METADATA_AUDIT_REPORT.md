# Nuvio-Lite Metadata & Episode Verification Audit Report

## 1. Executive Summary & Root Cause

Stream cards produced by Nuvio-Lite JS plugins lack structured technical and episode metadata due to **compounded gaps across both the provider schemas and Nuvio's Kotlin runtime/UI pipeline**:

1. **QuickJS Bridge Truncation (`PluginRuntime.kt` / `TV_PluginRuntime.kt`)**: Nuvio's native JS bridge only deserializes 13 top-level keys (`title`, `name`, `url`, `quality`, `size`, `language`, `provider`, `type`, `seeders`, `peers`, `infoHash`, `headers`, `subtitles`) plus `behaviorHints.audioDelayMs` / `audioDelayLanguage` on TV. Rich fields emitted by providers (`duration`, `runtime`, `season`, `episode`, `languages`, `audio`, `format`, `filename`, `imdbId`, `tmdbId`, `behaviorHints.videoSize`) are **silently discarded**.
2. **Stream Mapping & Card Overwrites (`StreamFetchSupport.kt` / `TV_StreamRepositoryImpl.kt` / `StreamCard.kt`)**:
   - On **Mobile & Desktop JS plugins**, `StreamFetchSupport.toStreamItem()` sets `StreamItem.name = name ?: title` (dropping `title` whenever `name` is present) and formats `description` exclusively from `[scraperName?, quality, size, language]`. Even though `StreamCard` renders `StreamFileSizeBadge` from `behaviorHints.videoSize`, `toStreamItem()` leaves `videoSize = null` and `filename = null`, preventing JS plugins from triggering native size badges or filename regex matching.
   - On **Mobile & Desktop**, `StreamCard` renders regex badges **only** if `badge.imageURL.isNotBlank()`, silently ignoring `STYLE_LABEL` text badges (unlike `TV_StreamBadgeChips.kt`).
   - On **Mobile & Desktop Stremio HTTP addons**, `StreamParser.kt` discards `subtitles[]` completely (whereas `TV_StreamMapper.kt` preserves them).
   - **Pre-playback vs. Post-playback Split**: Codecs, resolution (`videoWidth x videoHeight`), multi-audio language lists, and subtitle tracks are inspected natively via ExoPlayer / `libmpv` (`PlayerEngine.android.kt`, `NuvioDesktop_NativePlayerController.kt`, `PlayerMediaInfo.kt`) **only after playback starts**.
3. **Provider-Side Fabrication & Overload (`providers/*.js`)**: Several scrapers compensate for missing schema fields by packing multi-line emoji strings into `name`/`title` (`redflix.js`, `hdhub4u.js`) or fabricating defaults: `bingr.js` hardcodes `'2.0 GB'`/`'750 MB'`, `net77.js` hardcodes `'2.5 GB'`/`'900 MB'`, `redflix.js` hardcodes `'1080p'` and `formatCholeCard` defaults unknown codecs/languages/extensions to `AVC`/`HEVC`, `AAC`, `Multi-Audio`, and `.mkv` even when the stream is MP4 or HLS.

---

## 2. Supported Metadata Field Matrix

| Metadata Field | QuickJS Plugin Schema (`PluginRuntime`) | Mobile / Desktop Card (`StreamCard`) | TV Card (`TV_StreamScreen`) | Stremio HTTP Addon / Debrid (`StreamParser` / `DebridStreamFormatter`) | Native Player Post-Start (`PlayerMediaInfo` / Modals) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Audio languages & multi-audio tracks** | Single string `language` only | Plain text inside `description`; no multi-track list; text-only badges dropped | Plain text in `description`; `STYLE_LABEL` regex chips supported | `clientResolve...parsed.languages` (Debrid templates / regex badges only) | Full track list (`AudioTrackModal`) |
| **Video resolution** | String `quality` only (`"1080p"`, etc.) | Plain text in `description` or `name`; optional `imageURL` badge | Appended to `name` (`"$name - $quality"`); image/text badges | `name`/`description` regex badge or `{stream.resolution}` (Debrid) | Exact `width x height` (`StreamInfoOverlay`) |
| **Video & audio codecs** | **Not supported** (must be embedded in free-text `name`) | Only via free-text `name` or imported regex `imageURL` badge (`title` dropped if `name` set) | Free-text or regex badge | `{stream.codec}` / `{stream.audio}` / `{stream.channels}` (Debrid only) | Exact codecs, profiles & channels (`StreamInfoOverlay`) |
| **Container format** | `type` = transport (`"direct"`/`"m3u8"`), not rendered; `manifest.formats` ignored in UI | **Not supported** unless embedded in `name` / URL regex | Same as Mobile/Desktop | `{stream.container}` absent; regex against `filename` | Container demuxer format internally (`mpv` / ExoPlayer) |
| **File size** | String `size` only (not numeric bytes); `behaviorHints.videoSize` dropped | Plain text `size` in `description`; `StreamFileSizeBadge` **never fires** (`videoSize=null`) | Plain text `size` in `description`; `StreamFileSizeBadge` **never fires** | `behaviorHints.videoSize` (bytes) triggers `StreamFileSizeBadge` (`SIZE X.YY GB`) | Not emphasized in player overlay |
| **Duration** | **Not supported** (ignored if emitted) | **Not supported** | Page-level show/episode `runtime` only (`LeftContentSection`), not per-stream duration | `clientResolve...parsed.duration` (custom Debrid template only, off by default) | Playback timeline duration (`PlayerPlaybackSnapshot`) |
| **Subtitle languages** | `subtitles[]` parsed (`url`, `language`, `name`, `headers`) | **0 subtitle info on `StreamCard`** (sent only to player) | **0 subtitle info on `StreamCard`** (sent only to player) | **Dropped** on Mobile/Desktop (`StreamParser.kt`); parsed on TV (`TV_StreamMapper.kt`) | Embedded + external tracks (`SubtitleModal`) |
| **Season & episode identifiers** | **Not supported** (`season`/`episode` ignored; only passed in `getStreams` input args) | Page-level header shows requested S/E; no card verification badge | Page-level header shows requested S/E; `FilenameEpisodeMatcher` used for auto-next | `clientResolve.season`/`episode` & `parsed.seasons`/`episodes` (Debrid/next-ep match) | Playback episode selector only |

---

## 3. Experimental Audit Results (Local Media, Authorized Test Streams & QuickJS Sandbox)

All container parsers and verification rules ran inside an isolated `node:vm` sandbox mimicking Nuvio's QuickJS environment (no `process`, `Buffer`, `fs`, or `node:*`; 1 MiB response read cap enforced) against `ffprobe`-measured ground truth.

### 3.1 QuickJS Bounded Range Probe vs. `ffprobe` Ground Truth (Local Fixtures)

| Fixture | Total Size | Transferred (Reqs) | % Downloaded | Measured Container & Video | Measured Duration vs `ffprobe` | Audio Tracks (Provenance) | Subtitles | Container Tags |
| :--- | ---: | ---: | ---: | :--- | :--- | :--- | :--- | :--- |
| `mp4_fast_s01e02` (`+faststart`) | 22,829,476 B | 65,536 B (5 reqs) | **0.29%** | `mp4`, H.264 `1920x1080` | `2649.37s` vs `2649.37s` | `aac` **hi** (`verified`), `aac` **en** (`verified`) | `mov_text` (hi, en) | `S01E02`, `imdb:tt1234567`, `tmdb:999001` |
| `mp4_moov_end_mar` (`moov` at EOF) | 12,026,524 B | 49,788 B (5 reqs) | **0.41%** | `mp4`, H.264 `1280x720` | `2649.37s` vs `2649.37s` | `aac` **mr** (`verified`) | `mov_text` (mr) | *None* |
| `mp4_trailer` | 616,752 B | 49,152 B (4 reqs) | **7.97%** | `mp4`, H.264 `1920x1080` | `120.41s` vs `120.41s` | `aac` **en** (`verified`) | *None* | `Official Season 1 Trailer` |
| `mkv_multi_h265` | 48,322,113 B | 16,384 B (2 reqs) | **0.03%** | `matroska`, HEVC `1280x720` | `2649.39s` vs `2649.39s` | `opus` **hi** (`verified`), `aac` **en** (`verified`), `ac3` **mr** (`verified`), `opus` `und` (**`unknown`**) | `subrip` (hi, en, mr) | `SHOW=Show Alpha`, `SEASON=1`, `EPISODE=2` |
| `mkv_unlabelled_wrong_ep` | 21,885,550 B | 16,384 B (2 reqs) | **0.07%** | `matroska`, H.264 `1920x1080` | `2649.39s` vs `2649.39s` | `aac` `und` (**`unknown`**), `aac` `und` (**`unknown`**) | *None* | `Show Alpha S01E03 - Wrong Episode` |
| `hls_multi_master` | Playlist | 13,843 B (2 reqs) | N/A | `hls`, H.264 `1920x1080` | `2640.0s` vs `2640.0s` | `aac` **hi**, **en**, **mr** (`verified`) | `webvtt` (hi, en, mr) | N/A |
| `hls_unlabelled_master` | Playlist | 12,701 B (2 reqs) | N/A | `hls`, H.264 `1280x720` | `2640.0s` vs `2640.0s` | `aac` unlabelled (**`unknown`**) | *None* | N/A |
| `hls_trailer_master` | Playlist | 1,201 B (2 reqs) | N/A | `hls`, H.264 `1920x1080` | `120.0s` vs `120.0s` | `aac` **en** (`verified`) | *None* | N/A |

- **Non-Range Safety**: When a host returns `Accept-Ranges: none` on a large file (`> 256 KiB`), probing stops after `HEAD` (`0` payload bytes transferred, status `range_unsupported_skipped`).
- **Authorized Public Test Streams**:
  - `test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`: Probed as `hls`, H.264 `1920x1080`, `aac` muxed unlabelled (`unknown`), `634.57s` (vs `ffprobe` `634.58s`) in `232 ms`, `4,422 B` (`2` reqs).
  - `archive.org/download/ElephantsDream/ed_1024_512kb.mp4` (`47,065,346 B`): Probed as `mp4`, H.264 `426x240`, `aac` 2ch `48000Hz` (`und` -> `unknown`), `653.79s` (vs `ffprobe` `653.79s`), **`49,152 B` transferred (`0.104%` of file, `4` reqs)**, `4,905 ms` due to remote RTTs + redirect.
- **MP4 Tree-Skipping Finding**: In full-length MP4s (e.g. `22.8 MB`, 44m), the `moov` box itself reaches `2.85 MB` because of `stbl` (`stsz`/`stco`/`stts`) sample tables. Jumping across `trak` boundaries via `offset + size` in HTTP `Range` requests inspects all tracks + `udta/ilst` tags in `64 KiB` instead of overflowing Nuvio's `1 MiB` `DefaultRawHttpResponseMaxBytes` limit.
- **Desktop Binary Corruption Finding**: `AddonPlatform.android.kt:317` preserves raw `bodyBytes`, whereas `NuvioDesktop_AddonPlatform.desktop.kt:120-130` constructs `RawHttpResponse` without `bodyBytes`, falling back to `body.encodeToByteArray()`. In our test, UTF-8 decoding + re-encoding a `512 B` MP4 header slice mutated length (`553 B`, `+41 B`) and broke `parseMp4Moov`, making raw binary MP4/MKV inspection broken on Nuvio Desktop until `bodyBytes = readResult.bytes` is populated.

### 3.2 Episode Verification & Provenance Matrix (Target: `Show Alpha`, `imdb:tt1234567`, `tmdb:999001`, `S01E02`, expected `2640s`)

| Scenario | Verification Status | Provenance | Runtime Ratio | Key Signals |
| :--- | :--- | :--- | :--- | :--- |
| Correct MP4 (`S01E02` + `tt1234567` tag) | `VERIFIED_MATCH` | `verified` | `1.004` (`within_tolerance`) | `trusted_id_match`, `container_season_episode_match`, `runtime_within_tolerance` |
| Correct MKV (`SEASON=1`, `EPISODE=2`, no IMDb tag) | `CONTAINER_TAG_MATCH` | `verified` | `1.004` (`within_tolerance`) | Container tags match S01E02; explicitly flags `no_trusted_external_id_in_container` |
| Wrong Episode Trap (`S01E03` MKV, **same 2649s runtime**, lying title `S01E02`) | `EPISODE_MISMATCH` | `verified` | `1.004` (`within_tolerance`) | Container `title` `S01E03 != 2` catches fake runtime/title match |
| Wrong Season (`S02E02`, **same 2649s runtime**) | `SEASON_MISMATCH` | `declared` | `1.004` (`within_tolerance`) | `declared_season_2_expected_1` |
| Trailer (`mp4_trailer` / `hls_trailer`, `120s`) | `LIKELY_TRAILER_OR_CLIP` | `verified` | `0.045–0.046` (`trailer_duration`) | Short runtime + trailer keywords |
| Missing S/E Metadata (`mp4_moov_end_mar`, `2649s` matching runtime) | `UNVERIFIED_MISSING_EPISODE_METADATA` | `unknown` | `1.004` (`within_tolerance`) | Explicitly refuses proof: `matching_duration_alone_not_proof` |

### 3.3 Latency, Bandwidth & Resource Measurements

Measured across an 8-stream mixed batch (`166,356,226 B` total binary size, `Concurrency = 4`, `maxTotalBytes = 262 KiB/stream`):

- **Bandwidth transferred**: `291,102 B` total (**`99.83%` savings** vs. downloading binary streams).
- **Local latency & heap overhead**: `39 ms` total (concurrency `4`), `2,969,488 B` (`~2.83 MiB`) pre-GC JS heap delta.
- **Simulated 35 ms WAN RTT**:
  - Blocking sequential inside `getStreams`: `1,065 ms`
  - Blocking concurrency-4 inside `getStreams`: `295 ms` (`3.61x` faster than sequential, though a single slow CDN host like `archive.org` took `4,905 ms`!)
  - **Two-Stage Non-Blocking Pattern**: **`0 ms`** added to initial `StreamCard` render; background enrichment of top 4 candidate streams finishes in `192 ms`.

---

## 4. Boundary: QuickJS Plugin vs. Nuvio Core / Native Player

| Responsibility | Feasibility in Nuvio QuickJS Today | Requires Nuvio Kotlin / Native Player Changes |
| :--- | :--- | :--- |
| Parse HLS `.m3u8` master/media (`RESOLUTION`, `CODECS`, `LANGUAGE`, `#EXTINF` duration) | **Yes** (`fetch()` GET text + pure JS parser) | **UI**: Nuvio must accept & display `duration`, `subtitles` badge, `audioTracks[]`, `container`, and `videoSize` on `StreamCard`. |
| Inspect MP4 (`ftyp`, `mvhd`, `trak`, `udta/ilst`) & MKV (`EBML`, `Info`, `Tracks`, `SeekHead`) via HTTP `Range` | **Yes on Android Mobile/TV** (`arrayBuffer()` preserves `bodyBytes`, up to `1 MiB` per call); **No on Desktop** until `AddonPlatform.desktop.kt` passes `bodyBytes`. | **Fix `NuvioDesktop_AddonPlatform.desktop.kt`**: pass `bodyBytes` cleanly. Long-term, moving pre-playback probing to Kotlin (`OkHttp` + `MediaExtractor`/FFmpeg) avoids QuickJS JSON serialization overhead and supports non-range chunk cancellation cleanly. |
| Enforce bounded requests, concurrency semaphore, and provenance classification (`verified`/`declared`/`estimated`/`unknown`) | **Yes** in JS helper/module (`Semaphore`, byte/request caps). Note `fetch()` `AbortSignal` is ignored mid-flight on Mobile/Desktop (`JsBindings.kt`), so JS uses `Promise.race` timeout + byte budget. | **Core UI**: Distinguish `verified` vs `declared` vs `unknown` badges; currently `StreamFetchSupport.kt` flattens everything into a single unverified string (`quality • size • language`) and drops `title` & `behaviorHints`. |
| Non-blocking progressive card enrichment | **Limited**: `getStreams()` awaits a single batch return `PluginRuntimeResult[]` (`StreamSearchSessions.kt`). Probing inside `getStreams()` delays that provider's entire emission. | **Yes (Required)**: Support progressive `StreamItem` updates in `StreamsRepository`/`TV_StreamRepositoryImpl`, or trigger bounded pre-inspection in Kotlin on top visible/focused cards without delaying `getStreams()`. |
| Read codec profiles, HDR, and audio/sub tracks on encrypted/non-Range/DRM streams | **No** | **Yes (Native Player)**: Already handled post-start in ExoPlayer (`PlayerEngine.android.kt`) and `libmpv` (`NativePlayerController.kt`). |

---

## 5. Sample Stream Responses

See [sample_stream_responses.json](file:///home/shreesh/nuvio-audit/audit/fixtures/sample_stream_responses.json) for both current dropped fields and the backward-compatible extended schema. Key recommended additions alongside legacy Nuvio keys (`name`, `title`, `url`, `quality`, `size`, `language`, `subtitles`):

```json
{
  "name": "DemoProvider",
  "title": "Show Alpha S01E02 [Hindi + English] 1080p x264 AAC",
  "url": "https://cdn.example.invalid/Show.Alpha.S01E02.1080p.mp4",
  "quality": "1080p",
  "size": "2.10 GB",
  "language": "hi,en",
  "behaviorHints": {
    "filename": "Show.Alpha.S01E02.1080p.mp4",
    "videoSize": 2254857830
  },
  "media": {
    "container": { "value": "mp4", "provenance": "verified", "source": "container" },
    "durationSec": { "value": 2640, "provenance": "verified", "source": "container" },
    "video": { "width": 1920, "height": 1080, "codec": "h264", "provenance": "verified" },
    "audioTracks": [
      { "index": 0, "language": "hi", "codec": "aac", "channels": 2, "provenance": "verified" },
      { "index": 1, "language": "en", "codec": "aac", "channels": 2, "provenance": "verified" }
    ],
    "subtitleTracks": [
      { "language": "hi", "codec": "mov_text", "source": "container", "provenance": "verified" }
    ]
  },
  "verification": {
    "status": "VERIFIED_MATCH",
    "provenance": "verified",
    "trustedIds": { "imdbId": "tt1234567", "tmdbId": "999001" },
    "season": 1,
    "episode": 2,
    "runtimeCheck": { "status": "within_tolerance", "expectedSec": 2640, "measuredSec": 2640, "ratio": 1.0 }
  }
}
```

---

## 6. Recommended Implementation Approach

1. **Immediate Zero-UI-Change Improvements (Plugin / Companion Sidecar Safe)**:
   - Never jam fabricated codecs (`AVC`/`AAC`), fake sizes (`"2.0 GB"`), or guessed `.mkv` filenames into cards; emit `"unknown"` or omit unverified specs.
   - Until Nuvio fixes `StreamFetchSupport.toStreamItem()`, plugins returning `name` **and** `title` lose `title` on Mobile/Desktop and lose `title` in TV subtitles whenever `size`/`language` exists; encode verified `resolution • codec • container • languages • duration` concisely into `quality` / `language` / `name` only with truthful markers.
2. **High-Value Minimal Nuvio Kotlin Patches**:
   - Preserve `behaviorHints.videoSize` and `behaviorHints.filename` in `PluginRuntime.parseJsonResults()` + `StreamFetchSupport.toStreamItem()` and `TV_StreamRepositoryImpl.toPluginStream()`, immediately unlocking `StreamFileSizeBadge` and regex badges for JS plugins.
   - Fix `NuvioDesktop_AddonPlatform.desktop.kt` (`RawHttpResponse` missing `bodyBytes`) and parse `subtitles` in Mobile/Desktop `StreamParser.kt`.
   - Render `title` when distinct from `name`, enable `STYLE_LABEL` text chips in `StreamCard.kt`, and display lightweight metadata chips for multi-audio languages, subtitle count/languages, duration, container, and episode verification status (`Verified` vs `Mismatch` vs `Unverified`).
3. **Non-Blocking Asynchronous Media Inspection & Episode Verification**:
   - Render provider-declared cards at `t = 0 ms`.
   - Run bounded `HEAD` + tree-skipping MP4/EBML `Range` / HLS `.m3u8` inspection asynchronously in a background pool (concurrency `<= 4`, byte budget `<= 256 KiB/stream`, `AbortController`/byte-cap cancellation) prioritized on top cards or focused streams, cross-checking container/ID/SxxExx tags against TMDB runtime without ever treating duration alone as identity proof.

---

## 7. Verification Artifacts

- QuickJS-compatible probe & verifier: [media_probe_qjs.mjs](file:///home/shreesh/nuvio-audit/audit/lib/media_probe_qjs.mjs)
- Nuvio UI & parser pipeline simulator: [nuvio_render_sim.mjs](file:///home/shreesh/nuvio-audit/audit/lib/nuvio_render_sim.mjs)
- Fixture generator & `ffprobe` truth builder: [generate_fixtures.py](file:///home/shreesh/nuvio-audit/audit/generate_fixtures.py)
- Comprehensive audit & benchmark runner: [run_audit.mjs](file:///home/shreesh/nuvio-audit/audit/tests/run_audit.mjs) ([audit_results.json](file:///home/shreesh/nuvio-audit/audit/audit_results.json))
- Authorized external stream check: [run_live_authorized.mjs](file:///home/shreesh/nuvio-audit/audit/tests/run_live_authorized.mjs) ([live_authorized_results.json](file:///home/shreesh/nuvio-audit/audit/live_authorized_results.json))
- Sample stream schemas: [sample_stream_responses.json](file:///home/shreesh/nuvio-audit/audit/fixtures/sample_stream_responses.json)
