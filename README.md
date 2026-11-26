# Nuvio-Lite

A curated, lightweight, QuickJS-compatible Nuvio plugin repository (`manifest.json`) consolidating eligible providers from three audited Nuvio repositories:

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

## Curation Summary (57 → 21 Providers)

| Category | Count | Details |
| --- | ---: | --- |
| **Original entries audited** | 57 | `30` (`michat88`) + `17` (`asura`) + `10` (`abinanthankv`) |
| **Duplicates removed** | 5 | `4` duplicate IDs (`asura`: `4khdhub`, `hdhub4u`, `kisskh`, `uhdmovies`) + `1` functional duplicate (`michat88/myflixer-extractor` overlapping `watch32`) |
| **Broken / Incompatible removed** | 7 | `moviebox` (404), `vidsrc` (`process.env`), `dvdplay` (`AbortSignal.timeout`), `streamflix` (`WebSocket`/`ws`), `vidrock` (`localhost:3050`), `showbox` (`uiToken` cookie + `febapi.nuvioapp.space`), `dramafull` (`require('axios')`) |
| **Obfuscated scripts removed** | 13 | Remaining 13 unique `PirateZoro9/asura-providers` entries (`_0x` hex-array obfuscation; 17/17 `asura` excluded total) |
| **External dependency / disabled removed** | 11 | `enc-dec.app` (`animekai` [also broken movie support], `videasy` [disabled in NuvioTV `PluginSafety`], `mapple`, `vidlink`, `xprime`, `yflix`), `aesdec.nuvioapp.space` (`castle`, `vidnest`, `vidnest-anime`), `script.google.com` (`kisskh`, `watch32`) |
| **Final curated providers** | **21** | `12` from `michat88/nuvio-providers` + `9` from `Abinanthankv/NuvioRepo` |

## Retained Providers (`manifest.json`)

| ID | Name | Source | Types | Languages |
| --- | --- | --- | --- | --- |
| `4khdhub` | 4khdhub | `michat88` | `movie`, `tv` | `en` |
| `adimoviebox` | Adimoviebox | `michat88` | `movie`, `tv` | `en` |
| `cinevibe` | Cinevibe | `michat88` | `movie`, `tv` | `en` |
| `dahmermovies` | Dahmermovies | `michat88` | `movie`, `tv` | `en` |
| `hdhub4u` | Hdhub4u | `michat88` | `movie`, `tv` | `en` |
| `hdrezka` | Hdrezka | `michat88` | `movie`, `tv` | `en` |
| `idlix` | Idlix | `michat88` | `movie`, `tv` | `en` |
| `mallumv` | Mallumv | `michat88` | `movie`, `tv` | `en` |
| `moviesmod` | Moviesmod | `michat88` | `movie`, `tv` | `en` |
| `netmirror` | Netmirror | `michat88` | `movie`, `tv` | `en` |
| `uhdmovies` | Uhdmovies | `michat88` | `movie`, `tv` | `en` |
| `vixsrc` | Vixsrc | `michat88` | `movie`, `tv` | `en` |
| `tamilmv` | TamilMV | `abinanthankv` | `movie` | `ta`, `en` |
| `tamilblasters` | Tamilblasters | `abinanthankv` | `movie`, `tv` | `ta`, `en` |
| `tamilian` | Tamilian | `abinanthankv` | `movie` | `ta`, `en` |
| `moviesda` | Moviesda | `abinanthankv` | `movie` | `ta`, `en` |
| `movies4u` | Movies4u | `abinanthankv` | `movie` | `en`, `ta`, `hi` |
| `isaidub` | Isaidub | `abinanthankv` | `movie`, `tv` | `ta`, `en` |
| `toonhub` | ToonHub | `abinanthankv` | `movie`, `tv` | `hi`, `en` |
| `animelok` | Animelok | `abinanthankv` | `tv`, `movie` | `hi`, `ta`, `te`, `ml`, `en`, `ja` |
| `xdmovies` | XDmovies | `abinanthankv` | `movie`, `tv` | `en`, `hi` |

## Compatibility Testing & Audit Data

- Full technical audit: [`REPORT.md`](REPORT.md)
- Per-provider dataset: [`results.csv`](results.csv)
- Nuvio QuickJS sandbox test harness:
  ```bash
  node harness/run_phase2.mjs
  ```
