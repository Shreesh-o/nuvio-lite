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

## Included Providers (`35` Total)

### Newly Added & Upgraded Live-Tested Providers (`12`)
- **New (`9`, non-obfuscated):** `bingr` (`flix-dlp` v1.6.1, `en/hi/ja/multi`), `cinejoy` (`Skywave22` v1.0.9, `en/hi`), `movy` (`phuanh004` v1.0.4, `en`), `redflix` (`SA7ANI` v1.0.0, `en`), `castle` (`flix-dlp` v1.6.1, `hi/en/ta/te`), `movieblast` (`yoruix` v1.0.0, `te/hi/en`), `net77` (`flix-dlp` v1.6.1, `en/hi/multi` — replaces slow `netmirror`), `7movies` (`phuanh004` v1.0.6, `en`), `reanime` (`NuvioPlugin` v1.0.0, `en` anime)
- **Upgraded (`3`, non-obfuscated):** `4khdhub` (`yoruix` v1.0.2), `hdhub4u` (`SA7ANI` v1.1.0), `uhdmovies` (`NuvioPlugin` v1.2.1)

### Base Curated Providers (`23`)
- `michat88/nuvio-providers`: `kisskh`, `cinevibe`, `dahmermovies`, `moviesmod`, `vidlink`
- `PirateZoro9/asura-providers`: `vegamovies`, `movieshunt`, `biavox`, `moviesdrive`, `animetsu`, `anikototv`, `zinkmovies`, `hdfilme`, `playimdb`, `hindmovie`
- `Abinanthankv/NuvioRepo`: `tamilblasters`, `tamilian`, `moviesda`, `movies4u`, `isaidub`, `toonhub` *(QuickJS `atob` patch)*, `animelok`, `xdmovies`

## Optional Stremio HTTP Addons (Separate from `manifest.json`)

Nuvio's `manifest.json` only loads local QuickJS JS plugins (**Settings → Plugins**). If you want even more stream sources alongside `nuvio-lite`, you can add standard Stremio HTTP addons separately in **Settings → Addons**:
- **WebStreamr** — HTTPS direct streams (no Debrid or torrents needed).
- **NuvioStreams** — Stremio HTTP addon companion.
- **Torrentio** — Only recommended if you have a Debrid key (without Debrid, raw P2P torrents often stall on mobile).

## Compatibility Testing & Audit Data

- Full technical audit: [`REPORT.md`](REPORT.md)
- Per-provider dataset: [`results.csv`](results.csv)
- Nuvio QuickJS sandbox test harness:
  ```bash
  node harness/run_phase2.mjs
  ```
