# Nuvio Plugin Repositories — Technical Compatibility, Security & Performance Audit

**Audit Date:** 2026-11-27  
**Environment:** Omarchy (Arch Linux), Node.js `v26.12.0`, Python `3.14.8`, ADB installed (`/usr/bin/adb`) — zero large dependencies or emulators installed, no system modifications made.  
**Full Per-Provider Dataset:** [`results.csv`](file:///home/shreesh/nuvio-audit/results.csv) (all 57 manifest entries)

---

## Executive Summary

| Repository | Declared Scrapers | JS Available (HTTP 200) | Valid JS Syntax (`node --check`) | Nuvio-Sandbox Load+Exec OK (Mock) | Preferred Langs (`hi`/`en`/`mr`) |
| --- | ---: | ---: | ---: | ---: | --- |
| `michat88/nuvio-providers` | 30 | 29 (1 HTTP 404: `moviebox`) | 29 (`myflixer-extractor` fails Nuvio IIFE wrapper) | 27 / 29 | 30 `en` (`videasy` mentions `hi`/`mr` in code; `hdhub4u`, `dvdplay`, `mallumv`, `vidnest-anime` mention `hi` in code) |
| `PirateZoro9/asura-providers` | 17 | 17 | 17 | 17 / 17 | 8 `en`+`hi`, 6 `en`-only, 2 `en`+`ja`, 1 `de`-only |
| `Abinanthankv/NuvioRepo` | 10 | 10 | 10 | 9 / 10 (`dramafull` crashes on `require('axios')`) | 4 `hi`+`en` (incl. `movies4u`, `toonhub`, `animelok`, `xdmovies`), 6 `ta`+`en` (code in `tamilian`, `moviesda`, `isaidub` also targets `hindi`/`dubbed`) |
| **Total** | **57** | **56 / 57** | **56 / 56** (`node --check`) | **53 / 56** | **0 declare `mr` in manifest; 12 declare `hi`** |

### Key Findings (Observed vs. Inferred)

1. **Nuvio's Actual Runtime Has Shifted from Hermes to QuickJS:**
   - **Observed in `tapframe/nuvio-providers` `DOCUMENTATION.md`:** Legacy React Native Nuvio builds used **Hermes**, which throws `SyntaxError: async functions are unsupported` on un-transpiled `async`/`await`.
   - **Observed in `NuvioMedia/NuvioMobile` (`cmp-rewrite`), `NuvioMedia/NuvioDesktop` (`Dev`), and `NuvioMedia/NuvioTV` (`dev`):** Current official Nuvio apps use **Kotlin Multiplatform + `quickjs-kt`** (`QuickJS`), which natively executes `async`/`await` and injects shims via `JsBindings.kt` (`fetch`, `cheerio`, `CryptoJS`, `URL`, `AbortController`, `TextEncoder`/`TextDecoder`, `atob`/`btoa`, `crypto`, `setTimeout`, and a placeholder `WebAssembly`).
   - **Impact:** 10 of 56 providers contain raw `async`/`await` (`michat88`: `moviesmod`, `myflixer-extractor`, `uhdmovies`, `vidsrc`; `asura`: `vegamovies`, `movieshunt`, `zinkmovies`, `cinefreak`, `4khdhub`, `hdhub4u`). These will work in modern QuickJS Nuvio builds (assuming no other errors) but **fail in legacy Hermes builds**.
2. **Hard Load-Time Crashes in Nuvio Sandbox (Observed in Phase 2):**
   - `michat88/moviebox`: **HTTP 404** (`providers/moviebox.js` missing from repo).
   - `michat88/myflixer-extractor`: Not a Nuvio plugin — a Node CLI script (`#!/usr/bin/env node` causes `SyntaxError: Invalid or unexpected token` inside Nuvio's `(function(){ ... })()` wrapper; also uses `require('axios')`, `require('url')`, `process.exit(1)`, and does not export `getStreams`).
   - `michat88/vidsrc`: Top-level `process.env.VIDSRC_PROXY_URL` throws `ReferenceError: process is not defined` in Nuvio (passes in Node.js!).
   - `abinanthankv/dramafull`: Top-level `require("axios")` throws `Error: Module 'axios' is not available` in Nuvio (passes in Node.js!).
3. **Runtime API Traps Observed in Nuvio's `JsBindings.kt` vs. Provider Code:**
   - `michat88/dvdplay`: Calls `AbortSignal.timeout(timeout)` inside `validateVideoUrl`, which is missing from Nuvio's `AbortSignal` polyfill (`TypeError`).
   - `michat88/streamflix`: Attempts `WebSocket` / `require('ws')`, neither of which exists in Nuvio's QuickJS runtime (caught gracefully, rejects with `WebSocket implementation not available`).
   - `abinanthankv/toonhub`: Calls `Buffer.from(..., "base64")` inside a `try/catch` (silently fails in Nuvio because `Buffer` is unpolyfilled).
   - `michat88/vidrock`: Calls `fetch('http://localhost:3050/decrypt', ...)` (plaintext localhost sidecar unreachable on end-user devices).
   - `michat88/animekai`: Manifest declares `["movie", "tv"]`, but `getStreams()` returns `[]` immediately when `mediaType !== 'tv'`.
   - `michat88/showbox`: Requires user-supplied `uiToken` cookie in `SCRAPER_SETTINGS`; returns `[]` in `0.29 ms` when unconfigured.
   - `michat88/videasy`: Explicitly disabled by default in `NuvioTV`'s `PluginSafety.isVideoEasyScraper`.
4. **Timeout Gap Across Nuvio's Own Fetch Polyfill (Observed in Source + Measured in Phase 2):**
   - In `NuvioMobile`/`NuvioDesktop` (`JsBindings.kt` lines 185–221), `fetch()` **ignores `options.signal`**. In `NuvioTV` (`TV_PluginRuntime.kt` lines 772–794), `fetch()` only checks `signal.aborted` before and after the blocking `__native_fetch()` call.
   - Therefore, `AbortController` timeouts do **not** cancel an in-flight HTTP socket in Nuvio; only `Promise.race` timeouts (observed cleanly terminating at `10,070 ms` in `asura/playimdb` and `asura/4khdhub`) or Nuvio's native coroutine ceiling (`60,000 ms` in `PluginRuntime.kt`, `120,000 ms` in `TV_PluginManager.kt`) bound execution time.
5. **Security & Auditability Concerns:**
   - **100% of `PirateZoro9/asura-providers` (17/17)** are obfuscated with `_0x...` hex-string arrays, preventing static source transparency without deobfuscation.
   - Multiple providers relay metadata, cookies, or decryption payloads to unverified third-party APIs (`enc-dec.app`, `aesdec.nuvioapp.space`, `febapi.nuvioapp.space`, `script.google.com/macros/s/...`, `greenmountmotors.com`, `search.pingora.fyi`) or fetch unsigned dynamic domain lists from GitHub (`phisher98/TVVVV/domains.json`, `PirateZoro9/asura-providers/urls.json`).
   - None of the 56 files execute `eval()` or `new Function()` directly (`tamilmv` and `tamilblasters` only regex-match `"eval(function(p,a,c,k,e,d)"` strings inside HTML).

---

## Phase 1 — Repository Audit

### 1.1 Manifest & Architecture Verification

- **Manifest Schema (`PluginManifestParser.kt` & `PluginMediaType.kt`):**
  - Required non-blank fields: `name`, `version`, non-empty `scrapers` array. Unknown keys (e.g., `settings` in `asura`, `limited` in `asura/vegamovies`, `supportsExternalPlayer` in all 10 `abinanthankv` entries) are ignored (`ignoreUnknownKeys = true`).
  - `supportedTypes`: Nuvio maps `"movie"` and `"tv"` (and `PluginMediaType.kt` maps `"tv"` -> `"series"` when `"series"` is declared). `asura/animetsu` and `asura/anikototv` declare non-standard `"anime"`.
- **Supported `require()` Modules (`JsBindings.kt` lines 1057–1067):**
  - Only `'cheerio'`, `'cheerio-without-node-native'`, `'react-native-cheerio'`, and `'crypto-js'` are shimmed. Any other `require(...)` (`axios`, `url`, `ws`, `crypto`, `fs`, `node-forge`) throws `Error("Module '<name>' is not available")`.

### 1.2 Duplicate IDs & Overlapping Implementations

- **4 Duplicate Provider IDs (`michat88/nuvio-providers` vs `PirateZoro9/asura-providers`):**
  - Zero identical SHA-256 hashes exist across the 56 available JS files. Each duplicate ID has **distinct source code and target domains**:
    - `4khdhub`: `michat88` (`4khdhub.fans`, `12,687 B`, `["en"]`) vs `asura` (`4khdhub.one`, `10,275 B` obfuscated, `["en", "hi"]`).
    - `hdhub4u`: `michat88` (`hdhub4u.frl`, `59,747 B`, `["en"]`) vs `asura` (`new2.hdhub4u.cl` + `search.pingora.fyi` + `greenmountmotors.com`, `21,915 B` obfuscated, `["en", "hi"]`).
    - `kisskh`: `michat88` (`kisskh.ovh` + `script.google.com`, `5,884 B`, `["en", "id"]`) vs `asura` (`kisskh.nl` + `aiometadata.elfhosted.com`, `16,850 B` obfuscated, `["en"]`).
    - `uhdmovies`: `michat88` (`uhdmovies.email`, `46,254 B`, `["en"]`) vs `asura` (`uhdmovies.casa`, `22,325 B` obfuscated, `["en"]`).
  - *Note:* In Nuvio (`TV_PluginManager.kt` line 1115), scrapers are namespaced internally as `"$repoId:${info.id}"`, so duplicate IDs across repos do not overwrite each other in storage, though they create duplicate UI entries and redundant network scrapes if both are enabled.
- **Intra-Repo Overlap:** `michat88/myflixer-extractor` targets `watch32.sx` and `videostr.net`, overlapping directly with `michat88/watch32`.

### 1.3 Preferred Language Coverage (`Hindi`, `Hindi-dubbed`, `English`, `Marathi`)

- **Hindi (`hi`):** Declared by 8 `asura` providers (`vegamovies`, `movieshunt`, `moviesdrive`, `zinkmovies`, `cinefreak`, `4khdhub`, `hindmovie`, `hdhub4u`) and 4 `abinanthankv` providers (`movies4u`, `toonhub`, `animelok`, `xdmovies`). Additionally, `michat88` (`hdhub4u`, `dvdplay`, `mallumv`, `videasy`, `vidnest-anime`) and `abinanthankv` (`tamilian`, `moviesda`, `isaidub`) contain Hindi/multi-audio/dubbed logic in code despite omitting `"hi"` in `manifest.json` (`michat88` auto-generated `["en"]` across 29/30 entries).
- **English (`en`):** Declared by 56/57 providers (only `asura/hdfilme` is `de`-only).
- **Marathi (`mr`):** **Not declared in any `manifest.json`.** Only `michat88/videasy.js` contains explicit Marathi language mapping (`'mr': 'Marathi'`, `'marathi': 'Marathi'` at lines 286–288, 460).

### 1.4 Network Timeout, Retry, Concurrency & Error Handling

- **Timeouts:** 38 / 56 available providers have **no JS-side timeout** (`AbortController`, `Promise.race`, or `setTimeout`), relying entirely on Nuvio's 60s/120s host timeout. 18 / 56 implement JS timeout helpers.
- **Retries:** 5 / 56 implement retry/backoff logic (`michat88/dvdplay`, `michat88/mallumv`, `michat88/netmirror`, `michat88/vidsrc`, `abinanthankv/animelok`).
- **Concurrency:** 25 / 56 use `Promise.all` or `Promise.allSettled` internally; Nuvio itself bounds concurrent plugin execution via `Semaphore(10)` (`MAX_CONCURRENT_PLUGINS = 10` in `PluginRuntime.kt`).
- **Error Handling:** 53 / 56 load and catch errors cleanly to return `[]` on mock HTTP 500; `abinanthankv/animelok` entered a linear TMDB retry backoff loop (`1000ms * (attempt + 1)`) exceeding 2.2s on HTTP 500.

---

## Phase 2 — Runtime Compatibility & Sandboxed Benchmark

### 2.1 Can Nuvio's Runtime Be Reproduced in Node.js?

**Partially — suitable for syntax, module-resolution, and control-flow testing, NOT for exact JS-engine parity.**

- **What was reproduced safely:** Using Node.js built-ins (`node:vm`, `node:http`, `node:crypto`), we created [`harness/run_phase2.mjs`](file:///home/shreesh/nuvio-audit/harness/run_phase2.mjs) which isolates each untrusted script in a fresh `vm.Context` without `process`, `Buffer`, `fs`, `net`, or `child_process`, injects only Nuvio's `JsBindings.kt` global surface and restricted `require()`, and routes all `fetch()` calls to a local `127.0.0.1` mock server (returning mock TMDB JSON, HTML/JSON media stubs with public-domain `BigBuckBunny.mp4` sample URLs, HTTP 500s, or delayed responses).
- **Node.js vs. Nuvio Runtime Differences (Directly Observed):**
  1. **Node built-ins & npm modules:** `vidsrc` (`process.env`) and `dramafull` (`require('axios')`) passed under a Node-like `vm` context, yet **crashed immediately on load** inside the Nuvio-faithful sandbox.
  2. **Engine semantics:** Node V8 executes `async`/`await`, `AbortSignal.timeout`, full `URL` parsing, and full `cheerio`. Legacy Nuvio (Hermes) rejects `async`/`await`; modern Nuvio (QuickJS + `Ksoup` `DomBridge`) supports only the subset of Cheerio selectors/methods in `DomBridge.kt` (no `parent()`, no arbitrary jQuery pseudo-selectors beyond `:contains(...)`), omits `AbortSignal.timeout` and `Buffer`, and stubs `WebAssembly.instantiate` as a no-op.
  3. **Fetch cancellation:** Node's `fetch` honours `AbortSignal` mid-flight; Nuvio's `JsBindings.kt` `fetch` does **not** forward `options.signal` to `__native_fetch()`.

### 2.2 Benchmark Measurements (Mock Endpoints, Sandboxed)

- **Mock-Fast Run (`ok` server, 56 available scripts):**
  - **53 / 56** loaded and returned `[]` or stream arrays cleanly without unhandled exceptions.
  - **3 / 56** failed at load time: `michat88/myflixer-extractor` (`0.54 ms`, `SyntaxError`), `michat88/vidsrc` (`2.17 ms`, `ReferenceError: process is not defined`), `abinanthankv/dramafull` (`1.15 ms`, `Error: Module 'axios' is not available`).
  - **Measured Latency (53 passing scripts, local mock):** Min `0.29 ms` (`showbox` early-exit), Median `14.30 ms`, Max `174.29 ms` (`cinevibe`, 3 mock fetches + CryptoJS/token generation). Per-repo averages: `michat88` `61.01 ms` (27 OK), `asura` `12.47 ms` (17 OK), `abinanthankv` `13.14 ms` (9 OK).
- **Mock HTTP 500 Run (`fail` server):**
  - **52 / 56** degraded gracefully (`[]`). 3 failed load (same as above); `abinanthankv/animelok` exceeded the `2.2 s` cap due to retry backoff sleeping.
- **Mock Slow/Hang Run (`slow` server — `2.2 s` initial cap, plus `12.5 s` targeted cap against `15 s` hang on the 18 timeout-capable providers via [`harness/test_timeouts.mjs`](file:///home/shreesh/nuvio-audit/harness/test_timeouts.mjs)):**
  - `asura/playimdb` (`10,070.2 ms`) and `asura/4khdhub` (`10,071.0 ms`) terminated cleanly before `12.5 s` via `Promise.race` timeout.
  - 7 `abinanthankv` providers (`tamilmv`, `tamilblasters`, `moviesda`, `movies4u`, `isaidub`, `toonhub`, `animelok`) fired `AbortController` (`1x–3x` aborts observed) during the `12.5 s` window and moved to fallback/retry steps that exceeded `12.5 s`.
  - The remaining 9 timeout-referencing providers hit the `12.5 s` cap (`aborts=0`, either longer timeouts or blocked on sequential steps).

*Assumptions / Limitations:* Mock server latencies exclude real-world DNS/TLS/CDN latency, Cloudflare/Turnstile challenges, and domain uptime; `CryptoJS` and `cheerio` were lightweight shims, so real regex/DOM extraction branches on live HTML could surface additional edge-case errors (such as `michat88/dvdplay` hitting `AbortSignal.timeout()` once a candidate link is parsed).

---

## Phase 3 — Native Application & Verification Strategy

### 3.1 What Build Do You Need on Omarchy (Arch Linux)?

| Option | Runtime Parity | Verdict for Your Laptop |
| --- | --- | --- |
| **`NuvioDesktop` Linux (`0.1.39-alpha` AppImage / Flatpak)** | **High** — uses the exact same Kotlin Multiplatform `fullCommonMain` `PluginRuntime.kt`, `JsBindings.kt`, `DomBridge.kt`, `FetchBridge.kt`, `CryptoBridge.kt`, and QuickJS engine as `NuvioMobile`. | **Best first native check on Omarchy** without Android hardware/emulators, *noting it is marked Alpha (`0.1.39-alpha`)* and uses desktop JVM/QuickJS networking rather than Android OkHttp/Cronet TLS fingerprints. |
| **Physical Android Device + `NuvioMobile` (`-full-release.apk`) or `NuvioTV` (`-full-release.apk`)** | **Exact production parity** (Android `quickjs-kt-android-1.0.5-nuvio.aar`, Android TLS stack, ExoPlayer/libmpv playback). | **Recommended for final end-to-end verification** (especially for TLS/Cloudflare sensitivity and native media playback). **Do not use Play Store variants** (`androidPlaystore` strips out plugin support). |
| **Android Emulator** | Good QuickJS/Kotlin parity, poor media-playback/DRM parity, heavy disk/CPU footprint. | **Not needed** if you have `NuvioDesktop` Linux or an Android phone via USB/Wi-Fi ADB. |
| **Legacy React Native `debug.apk` (Hermes)** | Legacy Hermes engine only. | **Only needed** if auditing compatibility with older pre-KMP Nuvio versions. |

### 3.2 Using Nuvio's Built-in Plugin Tester & Collecting ADB Logs

1. **In Modern Nuvio (`NuvioMobile` `-full-`, `NuvioDesktop`, `NuvioTV` `-full-`):**
   - Add a local or remote `manifest.json` in **Settings → Plugins** (you can serve your local edited manifest over LAN with `python3 -m http.server 3000` inside your repo directory — no `npm install` needed).
   - Tap the **Test Provider** (`Test`) button directly on the provider card. Per `PluginRepository.kt` line 343, this calls `getStreams("603", "movie", null, null)` (or `"tv", 1, 1` for TV-only providers) bypassing search pause, and displays stream count or errors inline (plus `TestDiagnostics` on `NuvioTV`).
   - *Legacy React Native debug build difference:* In older Hermes-based builds, the tester lived at **Settings → Developer → Plugin Tester** (with `Individual Plugin` and `Repo Tester` tabs and an in-app `Logs` tab).
2. **Collecting Logs via ADB (`/usr/bin/adb` is already installed):**
   Enable USB/Wireless Debugging on the Android device, connect, and filter on the exact logcat tags observed in Nuvio's runtime source (`HostFunctions.kt`, `FetchBridge.kt`, `TV_PluginRuntime.kt`, `TV_PluginManager.kt`):
   ```bash
   adb logcat -c
   adb logcat -v time PluginRuntime:* PluginManager:* *:S
   ```
   To capture console output from a specific provider (`Log.d("Plugin:<scraperId>", ...)` in `TV_PluginRuntime.kt` / `Plugin:$scraperId` message prefix in `HostFunctions.kt`):
   ```bash
   adb logcat -v time | grep -E "PluginRuntime|PluginManager|Plugin:"
   ```

---

## Phase 4 — Recommendations & Next Steps

1. **For your preferred languages (`Hindi`, `Hindi-dubbed`, `English`, `Marathi`):**
   - Start with `PirateZoro9/asura-providers` (`vegamovies`, `movieshunt`, `moviesdrive`, `4khdhub`, `hindmovie`, `hdhub4u`, `cinefreak`, `zinkmovies`) and `Abinanthankv/NuvioRepo` (`movies4u`, `toonhub`, `animelok`, `xdmovies`) — excluding `dramafull` (broken in Nuvio) — plus `michat88/videasy` (if Marathi/multi-language streams are needed and you verify/accept its third-party `enc-dec.app` dependency).
2. **Exclude / Disable Broken & High-Risk Entries:**
   - Remove or disable `michat88/moviebox` (404), `michat88/myflixer-extractor` (Node CLI script), `michat88/vidsrc` (crashes on `process.env`), `abinanthankv/dramafull` (crashes on `require('axios')`), `michat88/vidrock` (requires `localhost:3050`), and `michat88/streamflix` (`WebSocket` unsupported).
   - Treat `PirateZoro9/asura-providers` with caution due to universal `_0x` obfuscation and third-party metadata/domain URLs; if you want native playback verification on Omarchy without installing Android SDKs, test with the portable `Nuvio-Linux-x86_64-0.1.39-alpha.AppImage` or a physical Android device over `adb`.


---

## Expanded Architecture, Compatibility & Reliability Audit (Phases 1–7)

**Audit Extension Date:** 2026-11-27  
**Additional Inspected Sources:**
- `NuvioMedia/NuvioMobile` (`cmp-rewrite`): [`StreamsRepository.kt`](file:///home/shreesh/nuvio-audit/sources/nuvio_mobile/StreamsRepository.kt), [`StreamSearchSessions.kt`](file:///home/shreesh/nuvio-audit/sources/nuvio_mobile/StreamSearchSessions.kt), [`StreamFetchSupport.kt`](file:///home/shreesh/nuvio-audit/sources/nuvio_mobile/StreamFetchSupport.kt), [`AddonRepository.kt`](file:///home/shreesh/nuvio-audit/sources/nuvio_mobile/AddonRepository.kt), [`AddonHttpClient.kt`](file:///home/shreesh/nuvio-audit/sources/nuvio_mobile/AddonHttpClient.kt), [`PlayerEngine.kt`](file:///home/shreesh/nuvio-audit/sources/nuvio_mobile/PlayerEngine.kt), [`AutoPlaybackEngineResolver.kt`](file:///home/shreesh/nuvio-audit/sources/nuvio_mobile/AutoPlaybackEngineResolver.kt)
- `luckynumb3rs/stremio-perfect-setup` (`main`): [`wizard/README.md`](file:///home/shreesh/nuvio-audit/sources/numb3rs_wizard/README.md), [`wizard/config.json`](file:///home/shreesh/nuvio-audit/sources/numb3rs_wizard/config.json), [`wizard/core/adapters/nuvio.js`](file:///home/shreesh/nuvio-audit/sources/numb3rs_wizard/nuvio.js), [`wizard/core/adapters/aiostreams.js`](file:///home/shreesh/nuvio-audit/sources/numb3rs_wizard/aiostreams.js)
- `Viren070/AIOStreams` (`main`, commit `89f03f6f1e6696dcee032e47c06ca5211249e776`): [`fetcher.ts`](file:///home/shreesh/nuvio-audit/sources/aiostreams/fetcher.ts), [`deduplicator.ts`](file:///home/shreesh/nuvio-audit/sources/aiostreams/deduplicator.ts), [`cache.ts`](file:///home/shreesh/nuvio-audit/sources/aiostreams/cache.ts), [`caches.ts`](file:///home/shreesh/nuvio-audit/sources/aiostreams/caches.ts), [`wrapper.ts`](file:///home/shreesh/nuvio-audit/sources/aiostreams/wrapper.ts), [`languages.ts`](file:///home/shreesh/nuvio-audit/sources/aiostreams/languages.ts), [`nuviostreams.ts`](file:///home/shreesh/nuvio-audit/sources/aiostreams/nuviostreams.ts), [`server_stream.ts`](file:///home/shreesh/nuvio-audit/sources/aiostreams/server_stream.ts), [`compose.yaml`](file:///home/shreesh/nuvio-audit/sources/aiostreams/compose.yaml)
- `Tam-Taro/SEL-Filtering-and-Sorting` (`main`): [`Tamtaro-complete-setup-template.json`](file:///home/shreesh/nuvio-audit/sources/external/tamtaro_template.json)
- Controlled Benchmark Data: [`sources/phase5_benchmarks.json`](file:///home/shreesh/nuvio-audit/sources/phase5_benchmarks.json), [`harness/benchmark_architectures.mjs`](file:///home/shreesh/nuvio-audit/harness/benchmark_architectures.mjs), [`results_architectures.csv`](file:///home/shreesh/nuvio-audit/results_architectures.csv)

---

### Executive Summary (Expanded Findings)

1. **Nuvio Renders Results Progressively, Not Blocking on Slow Providers:**
   - Observed in `StreamSearchSessions.kt` (lines 229–311) and `StreamsRepository.kt` (lines 427–483): Nuvio launches all Stremio HTTP addons, server sources, and native JS plugins concurrently and emits each `StreamLoadCompletion` into `_uiState` as soon as it finishes. A single slow provider does **not** delay faster providers from appearing in the UI.
   - **However**, Nuvio performs **no cross-addon/cross-plugin stream deduplication** (`StreamsRepository.kt`, `StreamFetchSupport.kt`), and its QuickJS `fetch()` polyfill ignores `AbortSignal` in-flight (`JsBindings.kt` lines 185–221), meaning cancelled or slow native JS plugins still hold sockets open until the 60s/120s coroutine ceiling.
2. **AIOStreams Solves Deduplication, Language Normalization & Socket Cancellation—at the Cost of Single-Response Fan-Out:**
   - AIOStreams (`wrapper.ts` line 232) uses `AbortSignal.any([signal, AbortSignal.timeout(fetchTimeout)])` in Node.js, **genuinely cancelling slow upstream sockets**, and provides DSU-based deduplication (`deduplicator.ts`), ISO/regex language normalization (`languages.ts`), and memory/SQL/Redis caching (`cache.ts`).
   - Because Nuvio treats AIOStreams as a single Stremio HTTP addon (`/:type/:id.json`), Nuvio cannot progressively render individual upstreams inside AIOStreams; however, AIOStreams' `dynamicAddonFetching` exit conditions (`fetcher.ts` lines 288–483) and warm cache mitigate this.
3. **Numb3rs Wizard (`numb3rs.stream/wizard/`) Is a Configuration Automator, Not a Performance Layer:**
   - It pushes JSON templates to `api.nuvio.tv` and community AIOStreams instances, routing AIOStreams `POST /api/v1/user` calls (including user API keys, debrid keys, and passwords) through a third-party CORS proxy (`https://proxy.numb3rs.stream`). It does **not** configure Nuvio's native JS plugins or perform runtime diagnostics.
4. **Recommended Architecture:**
   - **Balanced Setup (Recommended):** A single, tightly-scoped **AIOStreams** instance (self-hosted via Docker Compose on Omarchy or a trusted instance) configured with a minimal `Hindi > Hindi-dubbed > English > Marathi` language filter and DSU deduplication, paired with **0–3 curated, non-obfuscated, non-duplicate native JS plugins** (only if needed for regional Hindi/Marathi streams missing from Stremio HTTP addons).

---

### Phase 1 (Continued) — Nuvio Architecture Deep Dive

| Capability | Verified Nuvio Behaviour | Source Reference |
| --- | --- | --- |
| **Progressive Rendering** | **Yes.** `StreamSearchSessions.launchStreamSearchTasks` runs all HTTP addons and JS plugins in parallel and emits `StreamLoadCompletion` items immediately to `StreamsRepository.kt` (`publishAddonGroup` / `_uiState.update`). | [`StreamSearchSessions.kt#L229-L311`](file:///home/shreesh/nuvio-audit/sources/nuvio_mobile/StreamSearchSessions.kt#L229-L311), [`StreamsRepository.kt#L427-L483`](file:///home/shreesh/nuvio-audit/sources/nuvio_mobile/StreamsRepository.kt#L427-L483) |
| **Duplicate Provider IDs** | Stored/namespaced internally (`"addon:$manifestId:$manifestUrl"`, `"plugin:${scraper.id}"`, or `"$repoId:${info.id}"` on TV), so repos do not overwrite each other. **No stream-level deduplication** (`url`/`infoHash`) exists across groups. | [`StreamFetchSupport.kt#L20-L62`](file:///home/shreesh/nuvio-audit/sources/nuvio_mobile/StreamFetchSupport.kt#L20-L62), [`TV_PluginManager.kt#L1115`](file:///home/shreesh/nuvio-audit/sources/nuvio_runtime/TV_PluginManager.kt#L1115) |
| **Caching & Expiration** | `StreamSearchSessions` holds memory-only sessions for `COMPLETED_TTL_MS = 15 * 60 * 1_000L` (15 min), max `MAX_SESSIONS = 12`, keyed by `(profileId, type, videoId, season, episode, sourceConfiguration)`. `forceRefresh` sends `Cache-Control: no-cache` for addons. | [`StreamSearchSessions.kt#L74-L81`](file:///home/shreesh/nuvio-audit/sources/nuvio_mobile/StreamSearchSessions.kt#L74-L81), [`AddonHttpClient.kt#L3-L14`](file:///home/shreesh/nuvio-audit/sources/nuvio_mobile/AddonHttpClient.kt#L3-L14) |
| **Concurrency & Timeouts** | Native JS plugins bounded by `Semaphore(10)` and `60,000 ms` (`PluginRuntime.kt`) or `120,000 ms` (`TV_PluginManager.kt`). QuickJS `fetch()` ignores `AbortSignal` in-flight. | [`PluginRuntime.kt#L40-L45`](file:///home/shreesh/nuvio-audit/sources/nuvio_runtime/PluginRuntime.kt#L40-L45), [`JsBindings.kt#L185-L221`](file:///home/shreesh/nuvio-audit/sources/nuvio_runtime/JsBindings.kt#L185-L221) |
| **Native Video Player** | Android uses **ExoPlayer** (default, including HDR/Dolby Vision) and **libmpv** (auto-selected for anime/Japanese animation or ASS subtitles). Headers are sanitized (`Range` stripped). | [`AutoPlaybackEngineResolver.kt#L7-L45`](file:///home/shreesh/nuvio-audit/sources/nuvio_mobile/AutoPlaybackEngineResolver.kt#L7-L45), [`PlayerEngine.kt#L55-L68`](file:///home/shreesh/nuvio-audit/sources/nuvio_mobile/PlayerEngine.kt#L55-L68) |

---

### Phase 2 — Numb3rs Wizard Investigation (`numb3rs.stream/wizard/`)

- **Source Repository:** [`luckynumb3rs/stremio-perfect-setup`](https://github.com/luckynumb3rs/stremio-perfect-setup) (`wizard/`).
- **Actual Purpose:** A static Vite + React configuration generator that collects user preferences/API keys, resolves JSON templates (`templates/AIOStreams.json`, `AIOMetadata-All.json`, `Nuvio-Collections.json`, `Nuvio-Settings.json`), and installs them into Stremio or Nuvio accounts.
- **Nuvio Support & Compatibility:** Supports both `stremio` and `nuvio` (`wizard/config.json` lines 6–9; up to 6 Nuvio profiles via `https://api.nuvio.tv` in `nuvio.js` line 3–6). Generates standard Stremio-compatible addon manifests; does **not** configure Nuvio's native JS plugins (`doneStepNotifications` links out to `nuvio-plugin-library.vercel.app`).
- **Diagnostics vs. Config Convenience:** Purely configuration convenience—performs **no** runtime stream diagnostics, latency benchmarking, or playback verification.
- **External Dependencies & Security/Privacy Findings:**
  - Relays `POST /api/v1/user` (containing user TMDB/TVDB/RPDB/Debrid API keys and AIOStreams passwords) through **`https://proxy.numb3rs.stream`** (`aiostreams.js` lines 133–160, `config.json` line 14) to bypass missing CORS headers on community AIOStreams instances.
  - Embeds AES-GCM obfuscated shared fallback keys in `wizard/config.json` (lines 15–51) using the block name `"main"` as the passphrase (documented in `$comment` as *"obfuscation for convenience, not real secret storage"*).
  - Sends GA4 telemetry (`wizard_completed`, `wizard_account_created`, and `aio_*` non-password settings).

---

### Phase 3 — Reddit Setup Guide Verification (`r/nuvioaddons`)

| Component | Purpose & Role | Dependencies & Maintenance | Nuvio Compatibility | Security / Privacy | Verdict (Essential vs. Optional) |
| --- | --- | --- | --- | --- | --- |
| **AIOStreams** (`Viren070/AIOStreams`) | Server-side Stremio addon aggregator, deduplicator, filter/sorter, and cache (`streams` + `catalog`). | Node.js `>=24`, SQLite/Postgres, optional Redis. Actively maintained (commit `89f03f6f`, 2026-11-24). | **Full** (standard Stremio HTTP addon `/manifest.json`). | **High trust if self-hosted**; public instances see your Debrid/TMDB keys in encrypted config payloads. | **Recommended** for deduplication, language filtering, and timeout control. |
| **Tamtaro Preset** (`Tam-Taro/SEL-Filtering-and-Sorting`, `v3.2.13`) | Pre-built AIOStreams SEL filtering, sorting, and formatting template (`Tamtaro-complete-setup-template.json`). | Depends on AIOStreams + external auto-synced regex URLs (`Vidhin05/Releases-Regex`). Actively maintained. | **Full** (via AIOStreams). | Pulls external regex/SEL lists; `languageInference.sources` defaults to `[]` unless configured; auto-adds `Original/Dual Audio/Multi/Dubbed/Unknown` unless `strictLanguage` is enabled. | **Optional** (powerful, but over-engineered for a minimal 4-language setup). |
| **TMDB Integration** | Metadata, posters, and title/year matching (`api.themoviedb.org`). | Free TMDB API v3 key. | **Built-in / Full**. | Low risk (free read-only API key). | **Essential** for accurate metadata and language/year matching. |
| **Xperience** (`xperience-app.com`) | Web-based home-screen catalog/layout builder for Nuvio/Stremio. | Hosted Cloudflare + Supabase (`ocbakprgaplrwgtnmnxq.supabase.co`), Cloudflare Turnstile. | **Compatible** (generates Stremio-style catalog manifests). | Closed-source hosted service; Turnstile/CSP observed in HTTP headers. | **Optional** (cosmetic catalog organization; does not fix stream reliability or fetch speed). |
| **Torrentio / HTTP Add-ons** | Upstream torrent/debrid or HTTP stream providers inside AIOStreams or Nuvio. | External public instances (subject to 429/403 rate limits and downtime). | **Full**. | Public instances see queried IMDb/TMDB IDs and client/aggregator IP. | **Essential** (1–2 reliable upstreams; avoid P2P without Debrid if buffering is an issue). |

*Evidence check:* Claimed speedups in the Reddit post come from **limiting upstream count, sorting by seeders/cached status, and deduplicating via AIOStreams**—not from Xperience or Tamtaro's visual formatters.

---

### Phase 4 — AIOStreams Deep Dive & Self-Hosting Estimate

- **Architecture (`Viren070/AIOStreams`):**
  - **Concurrency & Fan-Out (`fetcher.ts`):** Parallel `Promise.all` by default; supports **sequential/parallel groups** (`groupings`) and **`dynamicAddonFetching`** (`ExitConditionEvaluator`) to return early once quality/count/time thresholds are met (marking slow upstreams `cut_off`).
  - **Timeouts & Socket Cancellation (`wrapper.ts` line 232):** Uses `AbortSignal.any([signal, AbortSignal.timeout(fetchTimeout)])`—**fixes Nuvio's uncancelled QuickJS `fetch()` problem** for any HTTP addons proxied behind AIOStreams.
  - **Caching (`cache.ts`, `caches.ts`):** `MemoryCacheBackend`, `SQLCacheBackend`, or `RedisCacheBackend` with `getOrRevalidate` and negative/failure caching (`manifestFailureCache`).
  - **Deduplication (`deduplicator.ts`):** Disjoint Set Union (DSU) over normalized `filename`, `infoHash` (+ `fileIdx`), and `smartDetect` (geometric-rounded size/bitrate + parsed attributes).
  - **Language Normalization (`languages.ts`):** Normalizes ISO 639-1/639-2 codes and release tags into canonical names (`Hindi`, `Marathi`, `English`, `Dual Audio`, `Multi`, `Dubbed`).
- **Hosted vs. Self-Hosted on Omarchy (Intel Core Ultra 5 125H, 16 GB RAM, Docker Compose):**
  - **Official Image:** `ghcr.io/viren070/aiostreams:latest` (`compose.yaml`, port `3000`, volume `./data:/app/data`).
  - **Estimated Resource Footprint (single-user / household):** ~150–300 MB RAM (Node.js + in-memory/SQLite cache; +30–50 MB if Redis is added), `<1–3%` CPU idle / brief bursts during scrapes, `<500 MB` disk. Easily handled by 16 GB RAM / Core Ultra 5 125H.
  - **Trade-off:** Public hosted instances require zero maintenance but share rate-limit IP pools (higher HTTP 429 risk) and see your Debrid/API keys; self-hosting on Omarchy gives full privacy and dedicated rate-limit budget, requiring occasional `docker compose pull && docker compose up -d` updates (and Tailscale/LAN access if used from Android TV/Mobile).

---

### Phase 5 — Controlled Architecture Benchmarks (Mock + Public-Domain Media)

Measured across 10 iterations per baseline scenario and 5 iterations per failure scenario (`harness/benchmark_architectures.mjs`, `sources/phase5_benchmarks.json`):

| Architecture | Cache | TTFR Median | Total Median | Total P95 | Success % | Duplicate % | Lang Accuracy % | CPU (ms) | RAM RSS (MB) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **A. Nuvio Native JS (10 providers)** | Cold | `24.65 ms` | `84.05 ms` | `116.76 ms` | `100%` | `9.1%` | `90.9%` | `314.14` | `77.91` |
| **B. Nuvio HTTP Add-ons (6 addons)** | Cold | `28.02 ms` | `62.76 ms` | `65.02 ms` | `100%` | `14.3%` | `100.0%` | `119.89` | `82.73` |
| **C. AIOStreams Aggregator (6 addons)** | Cold | `63.87 ms` | `63.87 ms` | `67.89 ms` | `100%` | **`0.0%`** | **`100.0%`** | `173.09` | `85.37` |
| **D. Minimal Hybrid (Agg + 2 native)** | Cold | `32.66 ms` | **`43.54 ms`** | **`44.73 ms`** | `100%` | `40.0%`* | `80.0%`* | **`96.40`** | `87.12` |
| **C. AIOStreams Aggregator** | Warm | `0.83 ms` | `0.83 ms` | `63.68 ms` | `100%` | `0.0%` | `100.0%` | `17.43` | `89.35` |

*\*Note on D (Minimal Hybrid):* In the test, `native_hi_1` intentionally overlapped `addon_1` and omitted its `language` field to demonstrate why native JS providers should **only** be added for non-overlapping regional sources; when non-overlapping, duplicates drop to `0%`.

- **Failure Scenario Isolation (5 iterations each, 800 ms timeout):**
  - **Slow upstream (`2500 ms`):** Both Client and Aggregator bounded total latency at `801.78 ms` / `805.01 ms` (`50%` ok, `50%` timeout) without crashing healthy upstreams.
  - **Unavailable (`ECONNREFUSED`), HTTP `403`/`429`/`500`, Malformed JSON, Network Interrupt:** Healthy upstreams still returned `100%` of their streams (`22.07–24.54 ms`).
  - **Empty / Invalid Metadata:** Filtered cleanly (`100%` ok, `0%` errors).
  - **Expired Media URL:** Stream metadata fetch succeeded (`100%`), while media probe returned **HTTP `410`** (proving URL expiry is only caught at playback time).
  - **Duplicates:** Client emitted **`33.3%` duplicates**; Aggregator emitted **`0.0%` duplicates**.

---

### Phase 6 & 7 — Security, Robustness, Native Verification & Rollback Strategy

- **Security of Obfuscated Scripts & External Services:**
  - `PirateZoro9/asura-providers` (17/17 `_0x` obfuscated) and multiple `michat88` providers depend on unverified third-party decryption/domain endpoints (`enc-dec.app`, `aesdec.nuvioapp.space`, `script.google.com`, `greenmountmotors.com`). While Nuvio's QuickJS sandbox blocks filesystem/process access, untrusted scripts can still exfiltrate TMDB/user tokens (`SCRAPER_SETTINGS`) or silently redirect streams.
  - **Mitigation:** Prefer open-source, non-obfuscated HTTP add-ons inside AIOStreams; only enable 1–3 audited native JS plugins if regional Hindi/Marathi coverage is missing.
- **Native Application Verification Status:**
  - **Verified from Kotlin source:** QuickJS `fetch()` `AbortSignal` gap, `Semaphore(10)`, `StreamSearchSessions` 15-min cache, progressive `channelFlow` rendering, ExoPlayer/libmpv auto-selection.
  - **Requires native runtime/device testing (not executed here per no-install rule):** Real-world TLS/Cloudflare behavior, ExoPlayer vs. libmpv codec/ASS subtitle rendering, and `NuvioDesktop` (`0.1.39-alpha` AppImage) / Android `-full-release.apk` ADB logcat playback checks.
- **Maintenance & Rollback Strategy:**
  - Export AIOStreams config JSON + Nuvio addon URL list before any change (`backups/`).
  - Pin Docker image digest/tag (not floating `:latest` without backup) if self-hosting AIOStreams; rollback is `docker compose down` + restoring previous image tag and JSON config.
  - Maintain a minimal local `manifest.json` if using native JS plugins so broken upstream repo pushes never auto-break your setup.
