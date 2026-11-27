# Nuvio-Lite

A curated, QuickJS-compatible Nuvio plugin repository (`manifest.json`) consolidating working providers from three audited Nuvio repositories:

- `michat88/nuvio-providers`
- `PirateZoro9/asura-providers`
- `Abinanthankv/NuvioRepo`

> **Pure native Nuvio plugins only:** No AIOStreams, Debrid, Docker, or backend server required.

## Usage in Nuvio

1. Open **Nuvio** (**Settings → Plugins**).
2. Add the raw `manifest.json` URL:
   ```text
   https://raw.githubusercontent.com/Shreesh-o/nuvio-lite/main/manifest.json
   ```
3. **Recommended on mobile/ISP networks:** Enable Android **Private DNS** (`one.one.one.one` or `dns.adguard-dns.com`) so ISP DNS/TLS resets don't block TMDB or provider domains.

## Curation Summary (57 → 27 Providers)

| Category | Count | Details |
| --- | ---: | --- |
| **Original entries audited** | 57 | `30` (`michat88`) + `17` (`asura`) + `10` (`abinanthankv`) |
| **Duplicates removed** | 5 | `4` duplicate IDs (`asura`: `4khdhub`, `hdhub4u`, `kisskh`, `uhdmovies`) + `1` functional duplicate (`michat88/myflixer-extractor`) |
| **Broken / Incompatible / Disabled removed** | 9 | `moviebox` (404), `vidsrc` (`process.env`), `dvdplay` (`AbortSignal.timeout`), `streamflix` (`WebSocket`), `vidrock` (`localhost:3050`), `showbox` (`uiToken`), `dramafull` (`axios`), `animekai` (broken movie support), `videasy` (disabled in `NuvioTV` + dead `api2.videasy.net`) |
| **Dead domains / 403 / 404 pruned** | 16 | `adimoviebox`, `castle`, `cinefreak`, `cinemm`, `hdrezka`, `idlix`, `mallumv`, `mapple`, `peachify`, `tamilmv`, `vidnest`, `vidnest-anime`, `vixsrc`, `watch32`, `xprime`, `yflix` |
| **Final providers in `manifest.json`** | **27** | `9` (`michat88`) + `10` (`asura`) + `8` (`abinanthankv`) |

## Retained Providers (`27`)

- **`michat88/nuvio-providers` (`9`):** `kisskh`, `4khdhub`, `cinevibe`, `dahmermovies`, `hdhub4u`, `moviesmod`, `netmirror`, `uhdmovies`, `vidlink`
- **`PirateZoro9/asura-providers` (`10`):** `vegamovies`, `movieshunt`, `biavox`, `moviesdrive`, `animetsu`, `anikototv`, `zinkmovies`, `hdfilme`, `playimdb`, `hindmovie`
- **`Abinanthankv/NuvioRepo` (`8`):** `tamilblasters`, `tamilian`, `moviesda`, `movies4u`, `isaidub`, `toonhub` *(patched `Buffer.from` → `atob` for QuickJS)*, `animelok`, `xdmovies`

## Compatibility Testing & Audit Data

- Full technical audit: [`REPORT.md`](REPORT.md)
- Per-provider dataset: [`results.csv`](results.csv)
- Nuvio QuickJS sandbox test harness:
  ```bash
  node harness/run_phase2.mjs
  ```
