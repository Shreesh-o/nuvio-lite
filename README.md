# Nuvio-Lite

A curated, QuickJS-compatible Nuvio plugin repository (`manifest.json`) consolidating working providers from three audited Nuvio repositories:

- `michat88/nuvio-providers`
- `PirateZoro9/asura-providers`
- `Abinanthankv/NuvioRepo`

> **Pure native Nuvio plugins only:** No AIOStreams, Debrid, Docker, or backend server required.

## Usage in Nuvio

1. Open **Nuvio** (**Settings → Plugins**).
2. Add the raw `manifest.json` URL from your GitHub repository:
   ```text
   https://raw.githubusercontent.com/<username>/<repo>/main/manifest.json
   ```
   Or test locally over LAN without any extra dependencies:
   ```bash
   python3 -m http.server 3000
   # Then add: http://<your-lan-ip>:3000/manifest.json
   ```

## Curation Summary (57 → 43 Providers)

| Category | Count | Details |
| --- | ---: | --- |
| **Original entries audited** | 57 | `30` (`michat88`) + `17` (`asura`) + `10` (`abinanthankv`) |
| **Duplicates removed** | 5 | `4` duplicate IDs (`asura`: `4khdhub`, `hdhub4u`, `kisskh`, `uhdmovies` — retained `michat88`'s non-obfuscated implementations) + `1` functional duplicate (`michat88/myflixer-extractor` overlapping `watch32`) |
| **Broken / Incompatible removed** | 7 | `moviebox` (404), `vidsrc` (`process.env`), `dvdplay` (`AbortSignal.timeout`), `streamflix` (`WebSocket`/`ws`), `vidrock` (`localhost:3050`), `showbox` (`uiToken` cookie + `febapi.nuvioapp.space`), `dramafull` (`require('axios')`) |
| **Partially broken / Disabled removed** | 2 | `michat88/animekai` (returns `[]` for movies despite declaring `movie`+`tv`), `michat88/videasy` (disabled by default in `NuvioTV` `PluginSafety`) |
| **Final providers in `manifest.json`** | **43** | `21` (`michat88`) + `13` (`asura`) + `9` (`abinanthankv`) |

## Retained Providers (`43`)

- **`michat88/nuvio-providers` (`21`):** `4khdhub`, `adimoviebox`, `castle`, `cinevibe`, `dahmermovies`, `hdhub4u`, `hdrezka`, `idlix`, `kisskh`, `mallumv`, `mapple`, `moviesmod`, `netmirror`, `uhdmovies`, `vidlink`, `vidnest`, `vidnest-anime`, `vixsrc`, `watch32`, `xprime`, `yflix`
- **`PirateZoro9/asura-providers` (`13`):** `vegamovies`, `movieshunt`, `biavox`, `cinemm`, `peachify`, `moviesdrive`, `animetsu`, `anikototv`, `zinkmovies`, `cinefreak`, `hdfilme`, `playimdb`, `hindmovie` *(note: upstream scripts use `_0x` obfuscation)*
- **`Abinanthankv/NuvioRepo` (`9`):** `tamilmv`, `tamilblasters`, `tamilian`, `moviesda`, `movies4u`, `isaidub`, `toonhub`, `animelok`, `xdmovies`

## Compatibility Testing & Audit Data

- Full technical audit: [`REPORT.md`](REPORT.md)
- Per-provider dataset: [`results.csv`](results.csv)
- Nuvio QuickJS sandbox test harness:
  ```bash
  node harness/run_phase2.mjs
  ```
