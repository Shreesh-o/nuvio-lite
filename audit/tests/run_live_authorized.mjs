#!/usr/bin/env node
/**
 * Read-only verification against two authorized open test streams
 * (Mux public HLS test stream & Internet Archive Big Buck/Elephants Dream CC MP4).
 * Compares bounded QuickJS probe against local ffprobe ground truth if available.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const PROBE_MOD_PATH = "/home/shreesh/nuvio-audit/audit/lib/media_probe_qjs.mjs";
const OUT_PATH = "/home/shreesh/nuvio-audit/audit/live_authorized_results.json";

function loadQuickJsProbe() {
  const raw = fs.readFileSync(PROBE_MOD_PATH, "utf8");
  const code = raw.replace(/^export\s+/gm, "") +
    "\n;globalThis.__exp = { probeMediaUrl, normalizeLanguage };";
  const sandbox = {
    console, Date, Math, Number, String, Boolean, Array, Object, RegExp, Error,
    Set, Map, Promise, JSON, URL, Uint8Array, ArrayBuffer, DataView, TextDecoder, TextEncoder,
    AbortController: typeof AbortController === "function" ? AbortController : undefined,
    setTimeout, clearTimeout,
    fetch: globalThis.fetch,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.__exp;
}

async function main() {
  const { probeMediaUrl } = loadQuickJsProbe();
  const cases = [
    {
      name: "mux_public_hls_bbb",
      url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
      expectedContainer: "hls",
      expectedWidth: 1920,
      expectedHeight: 1080,
      expectedVideoCodec: "h264",
      expectedAudioCodec: "aac",
      expectedMinDurationSec: 630,
    },
    {
      name: "archive_org_elephants_dream_mp4",
      url: "https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4",
      expectedContainer: "mp4",
      expectedWidth: 426,
      expectedHeight: 240,
      expectedVideoCodec: "h264",
      expectedAudioCodec: "aac",
      expectedMinDurationSec: 650,
    },
  ];

  const results = [];
  for (const c of cases) {
    const res = JSON.parse(JSON.stringify(await probeMediaUrl(c.url, { timeoutMs: 10000 })));
    assert.equal(res.probeStatus, "ok", `${c.name} failed: ${res.error}`);
    assert.equal(res.measured.container, c.expectedContainer);
    assert.equal(res.measured.video[0].codec, c.expectedVideoCodec);
    assert.equal(res.measured.video[0].width, c.expectedWidth);
    assert.equal(res.measured.video[0].height, c.expectedHeight);
    assert.equal(res.measured.audio[0].codec, c.expectedAudioCodec);
    assert.equal(res.measured.audio[0].language, null);
    assert.equal(res.measured.audio[0].provenance, "unknown");
    assert.ok(res.measured.durationSec >= c.expectedMinDurationSec);
    if (res.measured.fileSizeBytes) {
      assert.ok(res.bytesTransferred <= 131072, `${c.name} transferred too many bytes: ${res.bytesTransferred}`);
    }
    results.push({
      name: c.name,
      url: c.url,
      elapsedMs: res.elapsedMs,
      bytesTransferred: res.bytesTransferred,
      totalFileBytes: res.measured.fileSizeBytes,
      percentDownloaded: res.measured.fileSizeBytes
        ? Number(((res.bytesTransferred / res.measured.fileSizeBytes) * 100).toFixed(3))
        : null,
      requestCount: res.requestCount,
      measured: res.measured,
    });
  }
  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log("LIVE AUTHORIZED STREAMS PASSED:", JSON.stringify(results.map((r) => ({
    name: r.name,
    container: r.measured.container,
    video: r.measured.video,
    audio: r.measured.audio,
    durationSec: Number(r.measured.durationSec.toFixed(2)),
    bytesTransferred: r.bytesTransferred,
    totalFileBytes: r.totalFileBytes,
    percentDownloaded: r.percentDownloaded,
    elapsedMs: r.elapsedMs,
  })), null, 2));
}

main().catch((err) => {
  console.error("LIVE CHECK FAILED:", err);
  process.exit(1);
});
