#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import vm from "node:vm";

import {
  simulateMobileDesktopPluginPipeline,
  simulateTvPluginPipeline,
  simulateStremioHttpAddonPipeline,
} from "../lib/nuvio_render_sim.mjs";

const AUDIT_DIR = "/home/shreesh/nuvio-audit/audit";
const MEDIA_DIR = path.join(AUDIT_DIR, "fixtures/media");
const TRUTH_PATH = path.join(AUDIT_DIR, "fixtures/ffprobe_truth.json");
const PROBE_MOD_PATH = path.join(AUDIT_DIR, "lib/media_probe_qjs.mjs");
const RESULTS_OUT = path.join(AUDIT_DIR, "audit_results.json");

const NUVIO_MAX_FETCH_BYTES = 1024 * 1024; // 1 MiB cap in AddonPlatform.kt & TV_PluginRuntime.kt

/**
 * Load media_probe_qjs.mjs into a restricted QuickJS-like vm context (no Node built-ins)
 * to prove compatibility with Nuvio's QuickJS runtime environment.
 */
function createQuickJsSandbox(fetchImpl) {
  const rawCode = fs.readFileSync(PROBE_MOD_PATH, "utf8");
  // Strip ESM `export ` keywords so the code runs cleanly inside vm script context
  const scriptCode = rawCode.replace(/^export\s+/gm, "") + `
  ;globalThis.__probeExports = {
    PROVENANCE,
    normalizeLanguage,
    Semaphore,
    probeMediaUrl,
    buildAuditedStreamMetadata,
    verifyEpisodeIdentity,
    parseMp4Moov,
    parseMkvChunk,
    parseHlsMasterOrMedia
  };`;

  const sandbox = {
    console,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    Set,
    Map,
    Promise,
    JSON,
    URL,
    Uint8Array,
    ArrayBuffer,
    DataView,
    TextDecoder,
    TextEncoder,
    AbortController: typeof AbortController === "function" ? AbortController : undefined,
    setTimeout,
    clearTimeout,
    // Deliberately NO process, NO Buffer, NO require, NO fs, NO http
    fetch: async (url, init = {}) => {
      const res = await fetchImpl(url, init);
      // Enforce Nuvio's 1 MiB native fetch read cap
      const origArrayBuffer = res.arrayBuffer.bind(res);
      return {
        status: res.status,
        ok: res.ok,
        url: res.url,
        headers: res.headers,
        arrayBuffer: async () => {
          const ab = await origArrayBuffer();
          if (ab.byteLength > NUVIO_MAX_FETCH_BYTES) {
            return ab.slice(0, NUVIO_MAX_FETCH_BYTES);
          }
          return ab;
        },
      };
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(scriptCode, sandbox, { filename: "media_probe_qjs.sandbox.js" });
  return sandbox;
}

/**
 * Start a local HTTP server supporting HEAD and byte Range requests,
 * tracking exact socket bytes transferred and simulated latency.
 */
function startFixtureServer(rootDir) {
  const stats = {
    requests: [],
    simulatedDelayMs: 0,
    noRangeMode: false,
    reset() {
      this.requests = [];
    },
    totalBytesSent() {
      return this.requests.reduce((acc, r) => acc + r.bytesSent, 0);
    },
  };

  const server = http.createServer(async (req, res) => {
    if (stats.simulatedDelayMs > 0) {
      await new Promise((r) => setTimeout(r, stats.simulatedDelayMs));
    }
    const reqPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const safeRel = path.normalize(reqPath).replace(/^(\.\.(\/|\\|$))+/, "");
    const absPath = path.join(rootDir, safeRel);
    if (!absPath.startsWith(rootDir) || !fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
      res.writeHead(404);
      res.end("Not found");
      stats.requests.push({ method: req.method, path: reqPath, status: 404, range: req.headers.range || null, bytesSent: 0 });
      return;
    }

    const stat = fs.statSync(absPath);
    const total = stat.size;
    const ext = path.extname(absPath).toLowerCase();
    const contentType =
      ext === ".mp4" ? "video/mp4"
        : ext === ".mkv" ? "video/x-matroska"
          : ext === ".m3u8" ? "application/vnd.apple.mpegurl"
            : ext === ".vtt" ? "text/vtt"
              : ext === ".ts" ? "video/mp2t"
                : "application/octet-stream";

    if (req.method === "HEAD") {
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": String(total),
        "Accept-Ranges": stats.noRangeMode ? "none" : "bytes",
      });
      res.end();
      stats.requests.push({ method: "HEAD", path: reqPath, status: 200, range: null, bytesSent: 0, totalSize: total });
      return;
    }

    const rangeHeader = req.headers.range;
    if (rangeHeader && !stats.noRangeMode) {
      const m = String(rangeHeader).match(/^bytes=(\d+)-(\d*)$/);
      if (!m) {
        res.writeHead(416, { "Content-Range": `bytes */${total}` });
        res.end();
        stats.requests.push({ method: req.method, path: reqPath, status: 416, range: rangeHeader, bytesSent: 0, totalSize: total });
        return;
      }
      const start = Number(m[1]);
      const end = m[2] ? Math.min(total - 1, Number(m[2])) : total - 1;
      if (start >= total || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${total}` });
        res.end();
        stats.requests.push({ method: req.method, path: reqPath, status: 416, range: rangeHeader, bytesSent: 0, totalSize: total });
        return;
      }
      const len = end - start + 1;
      res.writeHead(206, {
        "Content-Type": contentType,
        "Content-Length": String(len),
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
      });
      const fd = fs.openSync(absPath, "r");
      const buf = Buffer.allocUnsafe(len);
      fs.readSync(fd, buf, 0, len, start);
      fs.closeSync(fd);
      res.end(buf);
      stats.requests.push({ method: req.method, path: reqPath, status: 206, range: rangeHeader, bytesSent: len, totalSize: total });
      return;
    }

    // Full response (for small playlists or simulated non-Range host)
    const buf = fs.readFileSync(absPath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": String(total),
      "Accept-Ranges": stats.noRangeMode ? "none" : "bytes",
    });
    res.end(buf);
    stats.requests.push({ method: req.method, path: reqPath, status: 200, range: rangeHeader || null, bytesSent: total, totalSize: total });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        stats,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function main() {
  if (!fs.existsSync(TRUTH_PATH)) {
    throw new Error(`Missing ffprobe ground truth at ${TRUTH_PATH}. Run generate_fixtures.py first.`);
  }
  const truth = JSON.parse(fs.readFileSync(TRUTH_PATH, "utf8"));
  const srv = await startFixtureServer(MEDIA_DIR);
  const sandbox = createQuickJsSandbox(globalThis.fetch);
  const qjs = sandbox.__probeExports;

  const badgeRulesExample = [
    { label: "4K", regex: "\\b(2160p|4k|uhd)\\b", imageURL: "https://example.invalid/4k.png", style: "IMAGE" },
    { label: "HEVC", regex: "\\b(hevc|x265|h265)\\b", imageURL: "https://example.invalid/hevc.png", style: "IMAGE" },
    { label: "HI", regex: "\\b(hindi|hin)\\b", imageURL: "", style: "STYLE_LABEL" },
  ];

  const report = {
    uiRenderingTests: [],
    probeVsFfprobeTests: [],
    languageTests: [],
    episodeVerificationTests: [],
    desktopBinaryBugSimulation: null,
    benchmarks: {},
  };

  try {
    console.log("1. Running Nuvio UI & Schema Rendering Pipeline Tests...");

    // Case 1A: Provider emits rich metadata (hdhub4u/cinejoy style) with BOTH `name` and `title` + custom keys
    const richPluginFixture = [
      {
        name: "DemoProvider 1080p",
        title: "Show Alpha S01E02 1080p HEVC MKV [Hindi + English + Marathi] 2.1 GB",
        url: `${srv.baseUrl}/Show.Alpha.S01E02.1080p.WEB-DL.x264.AAC.Hindi-English.mp4`,
        quality: "1080p",
        size: "2.1 GB",
        language: "Hindi",
        provider: "demoprovider",
        type: "direct",
        format: "mp4",
        duration: 2640,
        codec: "x264",
        audio: ["hi", "en"],
        languages: ["Hindi", "English"],
        season: 1,
        episode: 2,
        imdbId: "tt1234567",
        filename: "Show.Alpha.S01E02.1080p.mp4",
        behaviorHints: { videoSize: 2254857830, filename: "Show.Alpha.S01E02.1080p.mp4" },
        subtitles: [
          { url: `${srv.baseUrl}/hls_multi/sub_hi.vtt`, language: "hi", name: "Hindi" },
          { url: `${srv.baseUrl}/hls_multi/sub_en.vtt`, language: "en", name: "English" },
        ],
      },
    ];

    const mobRes = simulateMobileDesktopPluginPipeline(richPluginFixture, { id: "demo", name: "Demo" }, { badgeRules: badgeRulesExample });
    const tvRes = simulateTvPluginPipeline(richPluginFixture, { id: "demo", name: "Demo" }, { badgeRules: badgeRulesExample });
    const mobCard = mobRes.cards[0];
    const tvCard = tvRes.cards[0];

    assert.equal(mobCard.droppedTitleBecauseNameSet, true, "Mobile drops `title` when `name` is present");
    assert.equal(mobCard.fileSizeBadge, null, "Mobile plugin cannot trigger StreamFileSizeBadge");
    assert.equal(mobCard.renderedSubtitleCountOnCard, 0, "StreamCard renders 0 subtitle indicators");
    assert.equal(mobCard.renderedBadges.length, 0, "Mobile filters out STYLE_LABEL badges without imageURL and loses HEVC because `title` was dropped");
    assert.ok(mobCard.droppedInputKeys.includes("duration"));
    assert.ok(mobCard.droppedInputKeys.includes("season"));
    assert.ok(mobCard.droppedInputKeys.includes("format"));
    assert.ok(mobCard.droppedInputKeys.includes("languages"));
    assert.ok(mobCard.droppedInputKeys.includes("behaviorHints"));

    assert.equal(tvCard.droppedTitleBecauseDescriptionSet, true, "TV StreamCard drops `title` in subtitle when `size`/`language` present");
    assert.equal(tvCard.fileSizeBadge, null, "TV plugin cannot set videoSize badge either");
    assert.ok(tvCard.renderedBadges.length >= 1, "TV renders regex-matched badges from title + STYLE_LABEL");

    // Case 1B: Object wrapper return (`{ streams, subtitles }` like bingr's internal shape)
    const objWrapperRes = simulateMobileDesktopPluginPipeline({ streams: richPluginFixture, subtitles: [] });
    assert.equal(objWrapperRes.droppedTopLevelWrapper, true);
    assert.equal(objWrapperRes.cards.length, 0);

    // Case 1C: Stremio HTTP Addon comparison
    const stremioAddonRaw = {
      name: "AIOStreams | Demo\n1080p",
      title: "Show.Alpha.S01E02.1080p.WEB-DL.H264.AAC.Hindi-English.mp4\n2.1 GB • 44m • Hindi / English",
      url: richPluginFixture[0].url,
      behaviorHints: {
        videoSize: 2254857830,
        filename: "Show.Alpha.S01E02.1080p.WEB-DL.H264.AAC.Hindi-English.mp4",
      },
      subtitles: [{ url: `${srv.baseUrl}/hls_multi/sub_en.vtt`, lang: "en" }],
      isManagedDebridStream: true,
      clientResolve: {
        stream: {
          raw: {
            parsed: {
              resolution: "1080p",
              codec: "AVC",
              audio: ["AAC"],
              languages: ["Hindi", "English"],
              seasons: [1],
              episodes: [2],
              duration: 2640,
            },
          },
        },
      },
    };
    const addonMob = simulateStremioHttpAddonPipeline(stremioAddonRaw, "mobile", { badgeRules: badgeRulesExample, hasCustomStreamFormatting: true });
    const addonTv = simulateStremioHttpAddonPipeline(stremioAddonRaw, "tv", { badgeRules: badgeRulesExample, hasCustomStreamFormatting: true });
    assert.equal(addonMob.fileSizeBadge, "SIZE 2.10 GB");
    assert.equal(addonMob.droppedAddonSubtitles, true, "Mobile StreamParser.kt drops HTTP addon subtitles");
    assert.equal(addonTv.subtitlesParsedCount, 1, "TV StreamMapper parses HTTP addon subtitles");

    report.uiRenderingTests.push({
      mobilePluginCard: mobCard,
      tvPluginCard: tvCard,
      objectWrapperRejected: objWrapperRes.droppedTopLevelWrapper,
      stremioAddonMobile: addonMob,
      stremioAddonTv: addonTv,
    });

    // ---------------- SUITE 2: Desktop UTF-8 Binary Corruption Check ----------------
    // Read first 256 bytes of MP4 and simulate Desktop `String(bytes, UTF_8).encodeToByteArray()`
    const sampleMp4Bytes = fs.readFileSync(truth.mp4_fast_s01e02.path).subarray(0, 512);
    const decodedUtf8 = new TextDecoder("utf-8").decode(sampleMp4Bytes);
    const reencodedBytes = new TextEncoder().encode(decodedUtf8);
    let corruptedByteCount = 0;
    const minLen = Math.min(sampleMp4Bytes.length, reencodedBytes.length);
    for (let i = 0; i < minLen; i++) {
      if (sampleMp4Bytes[i] !== reencodedBytes[i]) corruptedByteCount++;
    }
    const corruptedTailMoovParsed = qjs.parseMp4Moov(reencodedBytes);
    assert.ok(corruptedByteCount > 0 || reencodedBytes.length !== sampleMp4Bytes.length, "Desktop UTF-8 decode+reencode mutates non-UTF8 binary boxes");
    report.desktopBinaryBugSimulation = {
      originalSliceLen: sampleMp4Bytes.length,
      reencodedSliceLen: reencodedBytes.length,
      byteLengthDelta: reencodedBytes.length - sampleMp4Bytes.length,
      corruptedMp4MoovResult: corruptedTailMoovParsed,
    };

    // ---------------- SUITE 3: Bounded QuickJS Probe vs ffprobe Truth ----------------
    console.log("2. Running QuickJS Bounded Media Probe vs ffprobe Ground Truth...");

    const fixtureCases = [
      { key: "mp4_fast_s01e02", rel: "Show.Alpha.S01E02.1080p.WEB-DL.x264.AAC.Hindi-English.mp4" },
      { key: "mp4_moov_end_mar", rel: "Show.Alpha.720p.Marathi.moov_end.mp4" },
      { key: "mp4_trailer", rel: "Show.Alpha.Official.Trailer.1080p.mp4" },
      { key: "mkv_multi_h265", rel: "Show.Alpha.S01E02.720p.HEVC.MultiAudio.mkv" },
      { key: "mkv_unlabelled_wrong_ep", rel: "Show.Alpha.S01E03.1080p.x264.Unlabelled.mkv" },
      { key: "hls_multi_master", rel: "hls_multi/master.m3u8" },
      { key: "hls_unlabelled_master", rel: "hls_unlabelled/master.m3u8" },
      { key: "hls_trailer_master", rel: "hls_trailer/master.m3u8" },
    ];

    const probedByKey = {};
    for (const fc of fixtureCases) {
      srv.stats.reset();
      const url = `${srv.baseUrl}/${fc.rel}`;
      const probe = JSON.parse(JSON.stringify(await qjs.probeMediaUrl(url)));
      const t = truth[fc.key];
      assert.equal(probe.probeStatus, "ok", `Probe failed for ${fc.key}: ${probe.error}`);

      const m = probe.measured;
      const tv = t.video[0];
      const mv = m.video[0];
      assert.ok(mv, `Missing video track in ${fc.key}`);
      assert.equal(mv.codec, tv.codec, `Video codec mismatch on ${fc.key}: ${mv.codec} vs ${tv.codec}`);
      assert.equal(mv.width, tv.width, `Width mismatch on ${fc.key}`);
      assert.equal(mv.height, tv.height, `Height mismatch on ${fc.key}`);
      assert.ok(Math.abs(m.durationSec - t.durationSec) < 1.5, `Duration mismatch on ${fc.key}: ${m.durationSec} vs ${t.durationSec}`);

      const truthAudioLangs = t.audio.map((a) => (a.language === "und" || !a.language ? null : qjs.normalizeLanguage(a.language, null).code));
      const measuredAudioLangs = m.audio.map((a) => a.language);
      assert.deepEqual(measuredAudioLangs, truthAudioLangs, `Audio language list mismatch on ${fc.key}`);
      assert.equal(m.subtitles.length, t.subtitles.length, `Subtitle track count mismatch on ${fc.key}`);

      // Verify NO full-file download occurred on binary formats!
      const isBinary = !fc.rel.endsWith(".m3u8");
      if (isBinary) {
        assert.ok(probe.bytesTransferred < t.fileSizeBytes * 0.25, `Downloaded too much of ${fc.key}: ${probe.bytesTransferred}/${t.fileSizeBytes}`);
        assert.ok(probe.bytesTransferred <= 262144, `Exceeded 256 KiB budget on ${fc.key}: ${probe.bytesTransferred}`);
      }

      probedByKey[fc.key] = { probe, url };
      report.probeVsFfprobeTests.push({
        fixture: fc.key,
        totalFileBytes: isBinary ? t.fileSizeBytes : null,
        bytesTransferred: probe.bytesTransferred,
        percentDownloaded: isBinary ? Number(((probe.bytesTransferred / t.fileSizeBytes) * 100).toFixed(2)) : null,
        requestCount: probe.requestCount,
        elapsedMs: probe.elapsedMs,
        ffprobe: {
          container: t.formatName,
          durationSec: t.durationSec,
          video: tv,
          audio: t.audio.map((a) => ({ codec: a.codec, language: a.language || null })),
          subtitles: t.subtitles.map((s) => ({ codec: s.codec, language: s.language || null })),
        },
        quickjsMeasured: {
          container: m.container,
          durationSec: Number(m.durationSec.toFixed(2)),
          video: mv,
          audio: m.audio.map((a) => ({ codec: a.codec, language: a.language, provenance: a.provenance })),
          subtitles: m.subtitles.map((s) => ({ codec: s.codec, language: s.language, provenance: s.provenance })),
          tags: m.tags || {},
        },
      });
    }

    // Verify Non-Range Server Safety
    srv.stats.noRangeMode = true;
    srv.stats.reset();
    const noRangeRes = await qjs.probeMediaUrl(`${srv.baseUrl}/Show.Alpha.720p.Marathi.moov_end.mp4`);
    srv.stats.noRangeMode = false;
    assert.equal(noRangeRes.probeStatus, "range_unsupported_skipped");
    assert.equal(noRangeRes.bytesTransferred, 0, "Non-range large binary skipped with 0 payload bytes downloaded");

    // ---------------- SUITE 4: Audio Language & Lying-Provider Tests ----------------
    console.log("3. Running Language & Declared-vs-Measured Audit Tests...");
    const lyingProvider = {
      name: "Bingr Fake",
      title: "Show Alpha S01E02 4K HDR Dolby Atmos English MKV",
      url: probedByKey.mp4_moov_end_mar.url,
      quality: "4K",
      size: "2.0 GB",
      language: "en",
      format: "mkv",
    };
    const auditedLying = qjs.buildAuditedStreamMetadata(
      lyingProvider,
      probedByKey.mp4_moov_end_mar.probe,
      { mediaType: "tv", season: 1, episode: 2, expectedRuntimeSec: 2640 }
    );
    assert.equal(auditedLying.technical.resolution.value, "1280x720");
    assert.equal(auditedLying.technical.resolution.provenance, "verified");
    assert.equal(auditedLying.technical.containerFormat.value, "mp4");
    assert.equal(auditedLying.technical.audioTracks[0].language, "mr");
    assert.equal(auditedLying.technical.audioTracks[0].provenance, "verified");

    const unlabelledMkvAudited = qjs.buildAuditedStreamMetadata(
      { name: "Stream 5", url: probedByKey.mkv_unlabelled_wrong_ep.url },
      probedByKey.mkv_unlabelled_wrong_ep.probe
    );
    assert.equal(unlabelledMkvAudited.technical.hasUnlabelledAudio, true);
    assert.equal(unlabelledMkvAudited.technical.audioTracks[0].language, null);
    assert.equal(unlabelledMkvAudited.technical.audioTracks[0].provenance, "unknown");

    const unlabelledHlsAudited = qjs.buildAuditedStreamMetadata(
      { name: "HLS Unlabelled", url: probedByKey.hls_unlabelled_master.url },
      probedByKey.hls_unlabelled_master.probe
    );
    assert.equal(unlabelledHlsAudited.technical.hasUnlabelledAudio, true);
    assert.equal(unlabelledHlsAudited.technical.audioTracks[0].language, null);
    assert.equal(unlabelledHlsAudited.technical.audioTracks[0].provenance, "unknown");

    report.languageTests = [
      { case: "dual_audio_hindi_english_mp4", tracks: probedByKey.mp4_fast_s01e02.probe.measured.audio },
      { case: "marathi_only_moov_end_mp4_with_false_en_declared", auditedTechnical: auditedLying.technical },
      { case: "multi_audio_hi_en_mr_plus_und_mkv", tracks: probedByKey.mkv_multi_h265.probe.measured.audio },
      { case: "multi_audio_hls_hi_en_mr", tracks: probedByKey.hls_multi_master.probe.measured.audio },
      { case: "unlabelled_audio_mkv", tracks: unlabelledMkvAudited.technical.audioTracks },
      { case: "unlabelled_audio_hls", tracks: unlabelledHlsAudited.technical.audioTracks },
    ];

    // ---------------- SUITE 5: Episode Verification Matrix ----------------
    console.log("4. Running Episode Verification Matrix...");
    const reqS01E02 = {
      mediaType: "tv",
      imdbId: "tt1234567",
      tmdbId: "999001",
      season: 1,
      episode: 2,
      expectedRuntimeSec: 2640,
    };

    const epCases = [
      {
        name: "correct_episode_trusted_id_and_container_tags",
        stream: { name: "Show Alpha S01E02", url: probedByKey.mp4_fast_s01e02.url },
        probe: probedByKey.mp4_fast_s01e02.probe,
        ctx: reqS01E02,
        expectStatus: "VERIFIED_MATCH",
      },
      {
        name: "correct_episode_container_tags_only_no_imdb",
        stream: { name: "Show Alpha", url: probedByKey.mkv_multi_h265.url },
        probe: probedByKey.mkv_multi_h265.probe,
        ctx: reqS01E02,
        expectStatus: "CONTAINER_TAG_MATCH",
      },
      {
        name: "wrong_episode_same_runtime_trap_s01e03",
        stream: { name: "Show Alpha [Correct Label Lie S01E02]", url: probedByKey.mkv_unlabelled_wrong_ep.url },
        probe: probedByKey.mkv_unlabelled_wrong_ep.probe,
        ctx: reqS01E02,
        expectStatus: "EPISODE_MISMATCH",
      },
      {
        name: "wrong_season_same_runtime_s02e02",
        stream: { name: "Show Alpha S02E02", url: probedByKey.mp4_moov_end_mar.url, season: 2, episode: 2 },
        probe: probedByKey.mp4_moov_end_mar.probe,
        ctx: reqS01E02,
        expectStatus: "SEASON_MISMATCH",
      },
      {
        name: "trailer_mp4_120s",
        stream: { name: "Show Alpha Stream", url: probedByKey.mp4_trailer.url },
        probe: probedByKey.mp4_trailer.probe,
        ctx: reqS01E02,
        expectStatus: "LIKELY_TRAILER_OR_CLIP",
      },
      {
        name: "trailer_hls_120s_short_duration",
        stream: { name: "Show Alpha Stream HLS", url: probedByKey.hls_trailer_master.url },
        probe: probedByKey.hls_trailer_master.probe,
        ctx: reqS01E02,
        expectStatus: "LIKELY_TRAILER_OR_CLIP",
      },
      {
        name: "missing_episode_metadata_matching_duration_only",
        stream: { name: "Generic Stream", url: probedByKey.mp4_moov_end_mar.url },
        probe: probedByKey.mp4_moov_end_mar.probe,
        ctx: reqS01E02,
        expectStatus: "UNVERIFIED_MISSING_EPISODE_METADATA",
      },
    ];

    for (const c of epCases) {
      const audited = qjs.buildAuditedStreamMetadata(c.stream, c.probe, c.ctx);
      assert.equal(audited.verification.status, c.expectStatus, `Verification status mismatch on ${c.name}: got ${audited.verification.status}`);
      report.episodeVerificationTests.push({
        case: c.name,
        expected: c.expectStatus,
        actual: audited.verification,
      });
    }

    // ---------------- SUITE 6: Latency, Bandwidth & Concurrency Benchmarks ----------------
    console.log("5. Running Latency, Bandwidth, and Concurrency Benchmarks...");
    const batchUrls = [
      probedByKey.mp4_fast_s01e02.url,
      probedByKey.mp4_moov_end_mar.url,
      probedByKey.mkv_multi_h265.url,
      probedByKey.hls_multi_master.url,
      probedByKey.mp4_fast_s01e02.url,
      probedByKey.mp4_moov_end_mar.url,
      probedByKey.mkv_multi_h265.url,
      probedByKey.hls_multi_master.url,
    ];

    // Full download baseline size across binary fixtures in batch
    const binaryFullBytes =
      2 * truth.mp4_fast_s01e02.fileSizeBytes +
      2 * truth.mp4_moov_end_mar.fileSizeBytes +
      2 * truth.mkv_multi_h265.fileSizeBytes;

    // 6A: Local 0ms delay benchmark
    srv.stats.simulatedDelayMs = 0;
    srv.stats.reset();
    const heapBefore = process.memoryUsage().heapUsed;
    const tLocal0 = Date.now();
    const sem4Local = new qjs.Semaphore(4);
    await Promise.all(batchUrls.map((u) => sem4Local.run(() => qjs.probeMediaUrl(u))));
    const localElapsedMs = Date.now() - tLocal0;
    const localBytes = srv.stats.totalBytesSent();
    const heapAfter = process.memoryUsage().heapUsed;

    // 6B: Simulated WAN 35ms RTT: Sequential vs Concurrency=4 vs Non-Blocking UI
    srv.stats.simulatedDelayMs = 35;
    srv.stats.reset();
    const tSeq0 = Date.now();
    for (const u of batchUrls) {
      await qjs.probeMediaUrl(u);
    }
    const seqWanMs = Date.now() - tSeq0;

    srv.stats.reset();
    const tConc0 = Date.now();
    const sem4Wan = new qjs.Semaphore(4);
    await Promise.all(batchUrls.map((u) => sem4Wan.run(() => qjs.probeMediaUrl(u))));
    const conc4WanMs = Date.now() - tConc0;

    // Non-blocking UI simulation: UI renders initial declared cards immediately (`getStreams` -> 0ms probe delay), background enrichment runs async
    srv.stats.reset();
    const tUi0 = Date.now();
    const initialCards = simulateMobileDesktopPluginPipeline(richPluginFixture).cards;
    const firstRenderLatencyMs = Date.now() - tUi0;
    const bgPromise = Promise.all(batchUrls.slice(0, 4).map((u) => sem4Wan.run(() => qjs.probeMediaUrl(u))));
    await bgPromise;
    const bgCompleteMs = Date.now() - tUi0;
    void initialCards;

    srv.stats.simulatedDelayMs = 0;

    report.benchmarks = {
      streamBatchCount: batchUrls.length,
      binaryFullPayloadBytes: binaryFullBytes,
      boundedProbeBytesTotal: localBytes,
      bandwidthSavingsPercent: Number(((1 - localBytes / binaryFullBytes) * 100).toFixed(2)),
      localZeroDelayConc4Ms: localElapsedMs,
      heapDeltaBytes: heapAfter - heapBefore,
      simulatedWan35msRtt: {
        blockingSequentialMs: seqWanMs,
        blockingConcurrency4Ms: conc4WanMs,
        nonBlockingFirstRenderMs: firstRenderLatencyMs,
        nonBlockingBackground4StreamsCompleteMs: bgCompleteMs,
        speedupSeqVsConc4: Number((seqWanMs / Math.max(1, conc4WanMs)).toFixed(2)),
      },
    };

    fs.writeFileSync(RESULTS_OUT, JSON.stringify(report, null, 2));
    console.log(`\nALL AUDIT CHECKS PASSED. Saved results to ${RESULTS_OUT}`);
    console.log("Summary:", JSON.stringify({
      probeFixturesPassed: report.probeVsFfprobeTests.length,
      episodeCasesPassed: report.episodeVerificationTests.length,
      benchmarks: report.benchmarks,
    }, null, 2));
  } finally {
    await srv.close();
  }
}

main().catch((err) => {
  console.error("AUDIT FAILED:", err);
  process.exit(1);
});
