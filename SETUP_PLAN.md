# Nuvio Setup Plan — Architectural Options & Recommendation

**Target Profile:** Movies & TV Series  
**Language Priority:** `Hindi` > `Hindi-dubbed` > `English` > `Marathi`  
**Host Environment:** Omarchy (Arch Linux), Intel Core Ultra 5 125H, 16 GB RAM, Docker & Docker Compose available  
**Design Goal:** Reliability, fast loading, zero duplicates, accurate language metadata, low maintenance.

---

## Option 1 — Minimal Setup (Lowest Complexity & Overhead)

**Architecture:** Nuvio + 1–2 direct Stremio HTTP add-ons (or 1 hosted AIOStreams URL) + TMDB metadata. Zero native JS plugins.

- **Components:**
  - Nuvio (`NuvioMobile` `-full-` / `NuvioDesktop` / `NuvioTV` `-full-`)
  - Free TMDB v3 API key
  - 1–2 reliable Stremio HTTP add-ons (e.g., Torrentio / MediaFusion)
- **Pros:**
  - Zero server/container maintenance.
  - Fastest to set up (~5 minutes).
  - Avoids all QuickJS sandbox bugs (`process.env`, `require('axios')`, `AbortSignal.timeout`) and obfuscated JS risks.
- **Cons:**
  - **14.3%–33.3% duplicate streams** when using >1 HTTP add-on (Nuvio does not deduplicate across add-ons).
  - No unified language filtering/normalization for `Hindi` / `Hindi-dubbed` / `Marathi`.
  - Public add-on rate limits (HTTP 429) affect you directly.
- **Resource Consumption:** Client-only (~80 MB RAM in Nuvio stream search).
- **Maintenance:** Near-zero (only replace an add-on URL if an upstream dies).

---

## Option 2 — Balanced Setup (Recommended — Evidence-Backed)

**Architecture:** Nuvio + **1 Self-Hosted (or Trusted) AIOStreams Instance** configured with strict language priority (`Hindi`, `Hindi-dubbed`, `English`, `Marathi`) + DSU deduplication + **optional 1–2 audited native JS plugins** *only* if needed for regional Marathi/Hindi-dubbed HTTP streams not covered by Stremio add-ons.

- **Why Evidence Supports This:**
  - Eliminates Nuvio's **33.3% cross-source duplicate rate** (`0.0%` duplicates measured in `C_AIOStreams_Aggregator`).
  - Fixes Nuvio's **`AbortSignal` socket-cancellation gap** (`wrapper.ts` uses `AbortSignal.timeout()`).
  - Normalizes inconsistent language metadata (`100%` language accuracy in benchmark vs. `90.9%` on unlabelled native JS providers).
  - Warm cache delivers **`0.83 ms`** server-side responses across devices.
- **Configuration Rules (Avoid Overengineering):**
  - Enable **only 2–4 reliable upstreams** inside AIOStreams (do **not** enable 20+ scrapers).
  - Set a **5,000 ms per-addon timeout** and optional `dynamicAddonFetching` exit condition (`totalTimeTaken > 4000` when ≥3 HD streams are found) so one slow upstream never stalls the response.
  - Configure `preferredLanguages`: `["Hindi", "Dubbed", "Dual Audio", "Multi", "English", "Marathi"]` (or `requiredLanguages` if you want to hide other languages).
  - Skip `numb3rs.stream/wizard/` (avoids sending API/Debrid keys through `proxy.numb3rs.stream`) and skip Xperience unless you specifically want custom home rows.
  - If you add native JS plugins for Marathi/Hindi-dubbed HTTP streams, **exclude** all broken/obfuscated duplicates (`moviebox`, `myflixer-extractor`, `vidsrc`, `dramafull`, `vidrock`, `streamflix`) and keep the plugin list disjoint from AIOStreams.
- **Resource Consumption:**
  - If hosted: 0 local server resources.
  - If self-hosted on Omarchy: ~150–300 MB RAM, `<3%` CPU bursts, `<500 MB` disk.
- **Maintenance:** Low (quarterly AIOStreams config review; backup JSON exported locally).

---

## Option 3 — Self-Hosted Full-Control Setup (Privacy & Rate-Limit Isolation)

**Architecture:** Local/LAN **Docker Compose** running `ghcr.io/viren070/aiostreams` (+ optional Redis) on Omarchy, bound to LAN/Tailscale for `NuvioDesktop` and `NuvioMobile`/`NuvioTV`.

- **Hardware Fit (Intel Core Ultra 5 125H, 16 GB RAM):**
  - **RAM:** ~150–300 MB (AIOStreams + SQLite) or ~200–350 MB with Redis (`<2.5%` of 16 GB RAM).
  - **CPU:** Negligible idle; brief `1–3%` spikes during concurrent regex/DSU deduplication.
  - **Storage:** `<500 MB` image + `./data` volume.
- **Pros:**
  - Full credential privacy (TMDB, Debrid, and AIOStreams passwords never touch third-party proxies or public instances).
  - Dedicated outbound rate-limit budget (no shared-IP HTTP 429s from public AIOStreams instances).
  - Persistent warm cache across all your devices.
- **Cons:**
  - Requires keeping the laptop/container running (or Tailscale/LAN routing) when watching on TV/mobile.
  - Requires manual updates (`docker compose pull && docker compose up -d`).

---

## Final Recommendation

**Choose Option 2 (Balanced Setup) backed by Option 3's self-hosted AIOStreams container on your Omarchy laptop** (since you already have Docker Compose and 16 GB RAM, and watch from home/LAN).

1. **Do not install or deploy anything yet** until you approve moving from research to deployment.
2. When ready to deploy:
   - Export/save your current Nuvio addon list first (rollback baseline).
   - Start AIOStreams via `compose.yaml` pinned to a specific release tag (e.g., `v2.38.1`) rather than floating `:latest`.
   - Configure **3–4 reliable upstreams** + **Hindi / Hindi-dubbed / English / Marathi** language priority + **DSU deduplication** + **5s per-addon timeout**.
   - Add the single local AIOStreams `/manifest.json` URL into Nuvio, then verify real-world playback using `NuvioDesktop` AppImage or your Android device over `adb logcat`.
