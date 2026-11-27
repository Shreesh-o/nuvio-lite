# Nuvio-Lite

A curated, QuickJS-compatible Nuvio plugin repository (`manifest.json` v1.1.0, **35 providers**) consolidating live-tested English, Hindi, and regional providers for Nuvio Mobile, Desktop, and TV.

> **Pure native Nuvio plugins only:** No AIOStreams, Debrid, Docker, or backend server required.

## Usage in Nuvio

1. Open **Nuvio** (**Settings → Plugins**).
2. Add the raw `manifest.json` URL:
   ```text
   https://raw.githubusercontent.com/Shreesh-o/nuvio-lite/main/manifest.json
   ```
3. **Recommended on mobile/ISP networks:** Enable Android **Private DNS** (`one.one.one.one` or `dns.adguard-dns.com`) so ISP DNS/TLS resets don't block TMDB or provider domains.

## Priority Ordering in `manifest.json`

Nuvio launches plugins in manifest order bounded by `Semaphore(10)` (`PluginRuntime.kt` / `StreamSearchSessions.kt`), so providers are ordered by **verified live reliability, speed, and EN/HI/TV coverage**:

1. **Tier 1 (#1–#12 — Fast, Live-Verified EN/HI/TV Powerhouses):**
   `4khdhub`, `castle`, `vidlink`, `dahmermovies`, `bingr`, `movy`, `redflix`, `net77`, `hdhub4u`, `uhdmovies`, `movieblast`, `7movies`
2. **Tier 2 (#13–#22 — Verified Slower & Hindi/EN Auto-Domain Providers):**
   `cinejoy`, `moviesmod`, `moviesdrive`, `vegamovies`, `hindmovie`, `movieshunt`, `zinkmovies`, `xdmovies`, `movies4u`, `playimdb`
3. **Tier 3 (#23–#35 — Asian Drama, Anime, Regional & Niche):**
   `kisskh`, `biavox`, `toonhub` *(QuickJS `atob` patch)*, `animelok`, `reanime`, `animetsu`, `anikototv`, `tamilblasters`, `isaidub`, `tamilian`, `moviesda`, `cinevibe`, `hdfilme`

## Recommended Companion Addons (**Settings → Addons**)

Nuvio's `manifest.json` only loads local QuickJS JS plugins (**Settings → Plugins**). Add these Stremio HTTP addons separately in **Settings → Addons** (using `https://`):
- **DesiFlix HTTP:** `https://manifest.desitvhub.eu.org/manifest.json` (direct 1080p/720p HTTPS MKVs for Hindi & English)
- **OpenSubtitles v3:** `https://opensubtitles-v3.strem.io/manifest.json` (subtitles)
- **IndiaStreams:** `https://indiastreams.rdata.in/manifest.json` (Indian OTT trending & platform rows)
- **TMDB Addon:** `https://tmdb.elfhosted.com/manifest.json` (language/year/popularity catalogs)
- **Streaming Catalogs:** `https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/manifest.json` (Netflix/Disney+/Max rows)

## Compatibility Testing & Audit Data

- Full technical audit: [`REPORT.md`](REPORT.md)
- Per-provider dataset: [`results.csv`](results.csv)
- Nuvio QuickJS sandbox test harness:
  ```bash
  node harness/run_phase2.mjs
  ```
