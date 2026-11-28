<div align="center">

# ⚡ Nuvio-Lite

**Curated, QuickJS-compatible plugin repository for Nuvio Mobile, Desktop & TV**

[![Providers](https://img.shields.io/badge/Providers-35%20Active-10b981?style=for-the-badge)](manifest.json)
[![Runtime](https://img.shields.io/badge/Runtime-Nuvio%20QuickJS-3b82f6?style=for-the-badge)](REPORT.md)
[![Zero Backend](https://img.shields.io/badge/Debrid%20%2F%20Docker-Not%20Required-8b5cf6?style=for-the-badge)](#quick-install)
[![Languages](https://img.shields.io/badge/Languages-EN%20%E2%80%A2%20HI%20%E2%80%A2%20Regional-f59e0b?style=for-the-badge)](#provider-lineup-35-active)

*Dead domains pruned · Duplicates removed · Ordered for Nuvio's 10-slot concurrency (`Semaphore(10)`)*

</div>

---

## Quick Install

1. Open **Nuvio** → **Settings → Plugins**
2. Tap **Add Repository** and paste:
   ```text
   https://raw.githubusercontent.com/Shreesh-o/nuvio-lite/main/manifest.json
   ```
3. Tap **Refresh / Sync**

> [!TIP]
> **Recommended on Mobile / ISP Networks:** Enable **Android Private DNS** (`one.one.one.one` or `dns.adguard-dns.com`) in **Settings → Network & internet → Private DNS** so ISP DNS/TLS resets do not block TMDB lookups or provider domains.

---

## Why Nuvio-Lite?

| Feature | Benefit |
| :--- | :--- |
| **QuickJS-Verified** | Every plugin passes `node --check` and Nuvio's QuickJS sandbox (`process.env`, `axios`, `ws`, `AbortSignal.timeout`, and unpolyfilled `Buffer` traps eliminated or patched). |
| **No Dead-Domain Bottlenecks** | Broken `404` / `403` / `ENOTFOUND` scrapers and bloated telemetry wrappers are excluded so they don't waste Nuvio's `Semaphore(10)` slots. |
| **Speed & Reliability Ordering** | Nuvio launches plugins in `manifest.json` order (`StreamSearchSessions.kt`). Fast, live-verified **English + Hindi + TV** providers sit at `#1–#12` so streams appear first. |
| **Zero Infrastructure** | Pure native QuickJS plugins—no AIOStreams, Debrid keys, Docker containers, or sidecar servers required. |

---

## Provider Lineup (`35` Active)

### Tier 1 — Fast Live-Verified EN / HI / TV Powerhouses (`#1–#12`)
*These grab Nuvio's first `Semaphore(10)` concurrency slots immediately on every search.*

| # | ID | Provider | Version | Types | Languages |
| :---: | :--- | :--- | :---: | :--- | :--- |
| 1 | `4khdhub` | **4KHDHub** | `v1.0.2` | `movie`, `tv` | `en` *(+ multi-audio)* |
| 2 | `bingr` | **Bingr Multi-Source** | `v1.6.1` | `movie`, `tv` | `en`, `ja`, `hi`, `multi` |
| 3 | `vidlink` | **Vidlink** | `v1.0.1` | `movie`, `tv` | `en` |
| 4 | `net77` | **NetMirror (Net77)** | `v1.6.1` | `movie`, `tv` | `en`, `hi`, `ta`, `te`, `multi` |
| 5 | `dahmermovies` | **Dahmermovies** | `v1.0.0` | `movie`, `tv` | `en` |
| 6 | `movy` | **Movy** | `v1.0.4` | `movie`, `tv` | `en` |
| 7 | `hdhub4u` | **HDHub4u** | `v1.1.0` | `movie`, `tv` | `en`, `hi` |
| 8 | `uhdmovies` | **UHDMovies** | `v1.2.1` | `movie`, `tv` | `en` |
| 9 | `castle` | **Castle VIP Streams** | `v1.6.2` | `movie`, `tv` | `hi`, `en`, `ta`, `te` |
| 10 | `redflix` | **RedFlix** | `v1.0.1` | `movie`, `tv` | `en` |
| 11 | `movieblast` | **MovieBlast** | `v1.0.0` | `movie`, `tv` | `te`, `hi`, `en` |
| 12 | `7movies` | **7Movies** | `v1.0.6` | `movie`, `tv` | `en` |

<details>
<summary><strong>Tier 2 — Additional Verified &amp; Hindi/EN Auto-Domain Providers (#13–#22)</strong></summary>

| # | ID | Provider | Version | Types | Languages |
| :---: | :--- | :--- | :---: | :--- | :--- |
| 13 | `cinejoy` | **CineJoy** | `v1.0.9` | `movie`, `tv` | `en`, `hi` |
| 14 | `moviesmod` | **Moviesmod** | `v1.0.0` | `movie`, `tv` | `en` |
| 15 | `moviesdrive` | **MoviesDrive** | `v1.0.1` | `movie`, `tv`, `series` | `en`, `hi` |
| 16 | `vegamovies` | **VegaMovies** | `v1.0.1` | `movie`, `tv`, `series` | `en`, `hi` |
| 17 | `hindmovie` | **HindMovie** | `v1.0.0` | `movie`, `tv`, `series` | `en`, `hi` |
| 18 | `movieshunt` | **MoviesHunt** | `v1.0.1` | `movie`, `tv`, `series` | `en`, `hi`, `ta`, `te` |
| 19 | `zinkmovies` | **ZinkMovies** | `v1.0.1` | `movie`, `tv`, `series` | `en`, `hi`, `ta`, `te`, `bn` |
| 20 | `xdmovies` | **XDmovies** | `v1.0.0` | `movie`, `tv` | `en`, `hi` |
| 21 | `movies4u` | **Movies4u** | `v1.0.1` | `movie` | `en`, `ta`, `hi` |
| 22 | `playimdb` | **PlayIMDb** | `v1.0.0` | `movie`, `tv`, `series` | `en` |

</details>

<details>
<summary><strong>Tier 3 — Asian Drama, Anime, Regional &amp; Niche (#23–#35)</strong></summary>

| # | ID | Provider | Version | Types | Languages |
| :---: | :--- | :--- | :---: | :--- | :--- |
| 23 | `kisskh` | **Kisskh** | `v1.0.1` | `movie`, `tv` | `en`, `id` |
| 24 | `biavox` | **BiaVox** | `v1.0.0` | `movie` | `en`, `fr` |
| 25 | `toonhub` | **ToonHub** *(QuickJS `atob` patched)* | `v1.0.0` | `movie`, `tv` | `hi`, `en` |
| 26 | `animelok` | **Animelok** | `v1.0.0` | `tv`, `movie` | `hi`, `ta`, `te`, `ml`, `en`, `ja` |
| 27 | `reanime` | **Reanime** | `v1.0.0` | `movie`, `tv` | `en` |
| 28 | `animetsu` | **Animetsu** | `v1.0.0` | `movie`, `tv` | `en`, `ja` |
| 29 | `anikototv` | **AnikotoTV** | `v1.0.5` | `movie`, `tv` | `en`, `ja` |
| 30 | `tamilblasters` | **Tamilblasters** | `v1.0.1` | `movie`, `tv` | `ta`, `en` |
| 31 | `isaidub` | **Isaidub** | `v1.0.0` | `movie`, `tv` | `ta`, `en` |
| 32 | `tamilian` | **Tamilian** | `v1.0.0` | `movie` | `ta`, `en` |
| 33 | `moviesda` | **Moviesda** | `v1.0.0` | `movie` | `ta`, `en` |
| 34 | `cinevibe` | **Cinevibe** | `v1.0.0` | `movie`, `tv` | `en` |
| 35 | `hdfilme` | **HDFilme** | `v1.0.0` | `movie`, `tv`, `series` | `de` |

</details>

---

## Companion Addons (**Settings → Addons**)

`manifest.json` loads local QuickJS plugins under **Settings → Plugins**. Pair it with these live-tested Stremio HTTP addons under **Settings → Addons** *(always use `https://`)*:

| Addon | Role | Manifest URL |
| :--- | :--- | :--- |
| **DesiFlix HTTP** | Direct 1080p/720p Hindi & English HTTPS streams | `https://manifest.desitvhub.eu.org/manifest.json` |
| **OpenSubtitles v3** | Multi-language subtitles | `https://opensubtitles-v3.strem.io/manifest.json` |
| **IndiaStreams** | Trending in India, Netflix, Prime, Hotstar, SonyLiv, Zee5 | `https://indiastreams.rdata.in/manifest.json` |
| **TMDB Addon** | Browse by language, year & popularity | `https://tmdb.elfhosted.com/manifest.json` |
| **Streaming Catalogs** | Netflix, Disney+, HBO Max platform rows | `https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/manifest.json` |

---

## Audit, Verification & Local Testing

<details>
<summary><strong>Repository Audit &amp; Harness Details</strong></summary>

- **Full Technical Audit:** [`REPORT.md`](REPORT.md)
- **Per-Provider Dataset:** [`results.csv`](results.csv)
- **Architecture Benchmarks:** [`results_architectures.csv`](results_architectures.csv)
- **Run QuickJS Sandbox Compatibility Harness:**
  ```bash
  node harness/run_phase2.mjs
  ```
- **Serve Locally Over LAN:**
  ```bash
  python3 -m http.server 3000
  # Add http://<your-lan-ip>:3000/manifest.json in Nuvio Settings → Plugins
  ```

</details>

---

<div align="center">

*Built for fast, clean, backend-free streaming in Nuvio.*

</div>
