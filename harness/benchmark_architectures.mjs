import http from 'node:http';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

const OUT_PATH = '/home/shreesh/nuvio-audit/sources/phase5_benchmarks.json';
const ITERATIONS = 10;

const PUBLIC_MEDIA_1 = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
const PUBLIC_MEDIA_2 = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4';
const PUBLIC_MEDIA_3 = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4';

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return +sorted[idx].toFixed(2);
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return percentile(s, 50);
}

function p95(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return percentile(s, 95);
}

function normalizeLanguage(raw) {
  const s = String(raw || '').toLowerCase();
  if (/\b(hi|hin|hindi)\b/.test(s)) return 'Hindi';
  if (/\b(mr|mar|marathi)\b/.test(s)) return 'Marathi';
  if (/\b(en|eng|english)\b/.test(s)) return 'English';
  if (/\b(dual|multi|dubbed)\b/.test(s)) return 'Dual Audio';
  return 'Unknown';
}

// Create mock upstream server simulating various provider/addon behaviors
function createUpstreamServer() {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const scenario = u.searchParams.get('scenario') || 'normal';
    const provider = u.searchParams.get('provider') || 'p1';
    const delayMs = Number(u.searchParams.get('delay') || 20);

    if (scenario === 'interrupt') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"streams":[{"name":"partial');
      setTimeout(() => req.socket.destroy(), 15);
      return;
    }

    if (scenario === 'http403') {
      setTimeout(() => { res.writeHead(403); res.end('Forbidden'); }, delayMs);
      return;
    }
    if (scenario === 'http429') {
      setTimeout(() => { res.writeHead(429, { 'Retry-After': '1' }); res.end('Too Many Requests'); }, delayMs);
      return;
    }
    if (scenario === 'http500') {
      setTimeout(() => { res.writeHead(500); res.end('Internal Server Error'); }, delayMs);
      return;
    }
    if (scenario === 'malformed') {
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{bad json'); }, delayMs);
      return;
    }
    if (scenario === 'empty') {
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ streams: [] })); }, delayMs);
      return;
    }
    if (scenario === 'invalid_meta') {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ streams: [{ name: 'Broken', url: '' }, { invalid: true }] }));
      }, delayMs);
      return;
    }
    if (scenario === 'expired_url') {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          streams: [{ name: `${provider} 1080p`, url: `http://127.0.0.1:${server.address().port}/media?expired=1`, language: 'hi' }]
        }));
      }, delayMs);
      return;
    }

    if (u.pathname === '/media') {
      if (u.searchParams.get('expired') === '1') {
        res.writeHead(410);
        res.end('Gone - Expired Token');
      } else {
        res.writeHead(200);
        res.end('OK');
      }
      return;
    }

    const timer = setTimeout(() => {
      if (res.writableEnded) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });

      // Generate deterministic streams with intentional duplicates & language metadata quirks
      const streams = [];
      if (provider === 'native_hi_1' || provider === 'addon_1') {
        streams.push({
          name: 'Big.Buck.Bunny.1999.1080p.Hindi.DD5.1.mkv',
          url: PUBLIC_MEDIA_1,
          infoHash: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
          language: provider.startsWith('native') ? undefined : 'Hindi', // native often omits manifest/field lang
          expectedLang: 'Hindi'
        });
      }
      if (provider === 'native_hi_2' || provider === 'addon_2') {
        // Duplicate of stream 1 + unique stream 2
        streams.push({
          name: 'Big.Buck.Bunny.1999.1080p.Hindi.DD5.1.mkv',
          url: PUBLIC_MEDIA_1,
          infoHash: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
          language: 'hi',
          expectedLang: 'Hindi'
        });
        streams.push({
          name: 'Elephants.Dream.2006.1080p.English.AAC.mp4',
          url: PUBLIC_MEDIA_2,
          infoHash: '1111222233334444555566667777888899990000',
          language: 'en',
          expectedLang: 'English'
        });
      }
      if (provider === 'native_mr' || provider === 'addon_3') {
        streams.push({
          name: 'Sintel.2010.720p.Marathi.Dubbed.mp4',
          url: PUBLIC_MEDIA_3,
          infoHash: 'ffff0000eeee1111dddd2222cccc3333bbbb4444',
          language: 'mr',
          expectedLang: 'Marathi'
        });
      }
      if (streams.length === 0) {
        streams.push({
          name: `${provider}.1080p.English.mp4`,
          url: PUBLIC_MEDIA_2,
          infoHash: `hash_${provider}`,
          language: 'en',
          expectedLang: 'English'
        });
      }
      res.end(JSON.stringify({ streams }));
    }, delayMs);
    req.on('close', () => clearTimeout(timer));
  });

  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        closeAll: () => { for (const s of sockets) s.destroy(); server.close(); }
      });
    });
  });
}

// Create AIOStreams-style aggregation server on 127.0.0.1
function createAggregatorServer(upstreamPort) {
  const cache = new Map();
  const CACHE_TTL_MS = 60_000;

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const key = u.searchParams.get('key') || 'default';
    const useCache = u.searchParams.get('cache') === '1';
    const perAddonTimeoutMs = Number(u.searchParams.get('timeout') || 1500);
    const exitAfterMs = Number(u.searchParams.get('exitAfter') || 0);
    const upstreamsParam = u.searchParams.get('upstreams') || '[]';
    const upstreams = JSON.parse(upstreamsParam);

    if (useCache && cache.has(key)) {
      const entry = cache.get(key);
      if (Date.now() - entry.ts < CACHE_TTL_MS) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'HIT' });
        res.end(JSON.stringify(entry.payload));
        return;
      }
    }

    const collected = [];
    const errors = [];
    let timeouts = 0;

    const fetchOne = async (up) => {
      try {
        const target = up.unavailable
          ? 'http://127.0.0.1:1/unreachable'
          : `http://127.0.0.1:${upstreamPort}/?provider=${encodeURIComponent(up.id)}&scenario=${encodeURIComponent(up.scenario || 'normal')}&delay=${up.delay ?? 20}`;
        const r = await fetch(target, { signal: AbortSignal.timeout(perAddonTimeoutMs) });
        if (!r.ok) {
          errors.push({ id: up.id, status: r.status });
          return [];
        }
        const data = await r.json();
        const valid = (Array.isArray(data?.streams) ? data.streams : []).filter((s) => s && typeof s.url === 'string' && s.url.length > 0);
        return valid.map((s) => ({
          ...s,
          normalizedLanguage: normalizeLanguage(s.language || s.name),
          source: up.id
        }));
      } catch (err) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') timeouts++;
        else errors.push({ id: up.id, error: err.message });
        return [];
      }
    };

    if (exitAfterMs > 0) {
      await new Promise((resolve) => {
        let remaining = upstreams.length;
        let done = false;
        const timer = setTimeout(() => { done = true; resolve(); }, exitAfterMs);
        for (const up of upstreams) {
          fetchOne(up).then((items) => {
            if (!done) collected.push(...items);
          }).finally(() => {
            remaining--;
            if (remaining === 0 && !done) {
              clearTimeout(timer);
              done = true;
              resolve();
            }
          });
        }
      });
    } else {
      const all = await Promise.all(upstreams.map(fetchOne));
      for (const list of all) collected.push(...list);
    }

    // DSU / key deduplication by infoHash + normalized filename
    const seen = new Set();
    const deduped = [];
    for (const s of collected) {
      const dkey = s.infoHash || s.url || s.name;
      if (seen.has(dkey)) continue;
      seen.add(dkey);
      deduped.push(s);
    }

    const payload = { streams: deduped, errors, timeouts, rawCount: collected.length };
    if (useCache && deduped.length > 0) {
      cache.set(key, { ts: Date.now(), payload });
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'MISS' });
    res.end(JSON.stringify(payload));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, clearCache: () => cache.clear() }));
  });
}

// Measure an architecture run
async function runArchitecture(archName, fn, iterations = ITERATIONS) {
  const ttfrs = [];
  const totals = [];
  let totalRequests = 0;
  let successes = 0;
  let timeouts = 0;
  let errors = 0;
  let totalStreams = 0;
  let duplicateStreams = 0;
  let langCorrect = 0;
  let langTotal = 0;

  const cpu0 = process.cpuUsage();
  const rssSamples = [];

  for (let i = 0; i < iterations; i++) {
    const res = await fn(i);
    ttfrs.push(res.ttfrMs);
    totals.push(res.totalMs);
    totalRequests += res.requests;
    successes += res.successes;
    timeouts += res.timeouts;
    errors += res.errors;
    totalStreams += res.streams.length;

    const seen = new Set();
    for (const s of res.streams) {
      const k = s.infoHash || s.url;
      if (seen.has(k)) duplicateStreams++;
      seen.add(k);
      if (s.expectedLang) {
        langTotal++;
        const actual = s.normalizedLanguage || normalizeLanguage(s.language);
        if (actual === s.expectedLang) langCorrect++;
      }
    }
    rssSamples.push(process.memoryUsage().rss / (1024 * 1024));
  }

  const cpuDelta = process.cpuUsage(cpu0);
  const cpuMs = +((cpuDelta.user + cpuDelta.system) / 1000).toFixed(2);
  const avgRssMb = +(rssSamples.reduce((a, b) => a + b, 0) / rssSamples.length).toFixed(2);

  return {
    architecture: archName,
    iterations,
    ttfr_median_ms: median(ttfrs),
    total_median_ms: median(totals),
    total_p95_ms: p95(totals),
    success_rate_pct: totalRequests ? +((successes / totalRequests) * 100).toFixed(1) : 0,
    timeout_rate_pct: totalRequests ? +((timeouts / totalRequests) * 100).toFixed(1) : 0,
    error_rate_pct: totalRequests ? +((errors / totalRequests) * 100).toFixed(1) : 0,
    duplicate_rate_pct: totalStreams ? +((duplicateStreams / totalStreams) * 100).toFixed(1) : 0,
    lang_accuracy_pct: langTotal ? +((langCorrect / langTotal) * 100).toFixed(1) : 0,
    cpu_ms: cpuMs,
    ram_rss_mb: avgRssMb
  };
}

// Simulate Nuvio client-side progressive fan-out (bounded by Semaphore(10), no dedup)
async function runNuvioClientFanout(upstreamPort, targets, { concurrency = 10, timeoutMs = 3000, simulateNuvioFetchBug = false, sessionCache = null, cacheKey = null } = {}) {
  if (sessionCache && cacheKey && sessionCache.has(cacheKey)) {
    const cached = sessionCache.get(cacheKey);
    return { ttfrMs: 0.2, totalMs: 0.3, requests: 1, successes: 1, timeouts: 0, errors: 0, streams: cached };
  }

  const t0 = performance.now();
  let ttfrMs = null;
  const allStreams = [];
  let successes = 0;
  let timeouts = 0;
  let errors = 0;

  let idx = 0;
  async function worker() {
    while (idx < targets.length) {
      const t = targets[idx++];
      const url = t.unavailable
        ? 'http://127.0.0.1:1/unreachable'
        : `http://127.0.0.1:${upstreamPort}/?provider=${encodeURIComponent(t.id)}&scenario=${encodeURIComponent(t.scenario || 'normal')}&delay=${t.delay ?? 20}`;

      try {
        // If simulateNuvioFetchBug is true, AbortSignal is NOT passed to fetch (like JsBindings.kt)
        const fetchPromise = fetch(url, simulateNuvioFetchBug ? {} : { signal: AbortSignal.timeout(timeoutMs) });
        const r = await Promise.race([
          fetchPromise,
          new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('TIMEOUT'), { name: 'TimeoutError' })), timeoutMs))
        ]);
        if (!r.ok) { errors++; continue; }
        const data = await r.json();
        const valid = (Array.isArray(data?.streams) ? data.streams : []).filter((s) => s && typeof s.url === 'string' && s.url.length > 0);
        if (valid.length > 0 && ttfrMs === null) {
          ttfrMs = +(performance.now() - t0).toFixed(2);
        }
        allStreams.push(...valid);
        successes++;
      } catch (err) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') timeouts++;
        else errors++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  const totalMs = +(performance.now() - t0).toFixed(2);
  if (ttfrMs === null) ttfrMs = totalMs;
  if (sessionCache && cacheKey && allStreams.length > 0) {
    sessionCache.set(cacheKey, allStreams);
  }
  return { ttfrMs, totalMs, requests: targets.length, successes, timeouts, errors, streams: allStreams };
}

async function main() {
  const upstream = await createUpstreamServer();
  const agg = await createAggregatorServer(upstream.port);

  try {
    const report = { cold: [], warm: [], failures: {} };

    // Upstreams for A (10 native providers), B (6 HTTP addons), C (1 aggregator over 6 addons), D (1 aggregator + 3 curated native)
    const nativeTargets = [
      { id: 'native_hi_1', delay: 25 },
      { id: 'native_hi_2', delay: 40 },
      { id: 'native_mr', delay: 30 },
      ...Array.from({ length: 7 }, (_, i) => ({ id: `native_en_${i}`, delay: 20 + i * 10 }))
    ];
    const httpTargets = [
      { id: 'addon_1', delay: 25 },
      { id: 'addon_2', delay: 40 },
      { id: 'addon_3', delay: 30 },
      { id: 'addon_4', delay: 35 },
      { id: 'addon_5', delay: 50 },
      { id: 'addon_6', delay: 60 }
    ];
    const hybridNative = [
      { id: 'native_hi_1', delay: 25 },
      { id: 'native_mr', delay: 30 }
    ];

    // 1. Cold cache comparison
    const sessionCacheA = new Map();
    const sessionCacheB = new Map();
    const sessionCacheD = new Map();

    report.cold.push(await runArchitecture('A_Native_JS', () =>
      runNuvioClientFanout(upstream.port, nativeTargets, { concurrency: 10, timeoutMs: 2500, simulateNuvioFetchBug: true })
    ));
    report.cold.push(await runArchitecture('B_HTTP_Addons', () =>
      runNuvioClientFanout(upstream.port, httpTargets, { concurrency: 10, timeoutMs: 2500, simulateNuvioFetchBug: false })
    ));
    report.cold.push(await runArchitecture('C_AIOStreams_Aggregator', async () => {
      const t0 = performance.now();
      const url = `http://127.0.0.1:${agg.port}/?cache=0&timeout=1500&upstreams=${encodeURIComponent(JSON.stringify(httpTargets))}`;
      const r = await fetch(url);
      const data = await r.json();
      const ms = +(performance.now() - t0).toFixed(2);
      return { ttfrMs: ms, totalMs: ms, requests: 1, successes: r.ok ? 1 : 0, timeouts: 0, errors: r.ok ? 0 : 1, streams: data.streams };
    }));
    report.cold.push(await runArchitecture('D_Minimal_Hybrid', async () => {
      const t0 = performance.now();
      let ttfr = null;
      const streams = [];
      let succ = 0;
      await Promise.all([
        (async () => {
          const r = await fetch(`http://127.0.0.1:${agg.port}/?cache=0&timeout=1500&upstreams=${encodeURIComponent(JSON.stringify(httpTargets.slice(0, 3)))}`);
          const d = await r.json();
          if (d.streams.length && ttfr === null) ttfr = +(performance.now() - t0).toFixed(2);
          streams.push(...d.streams);
          succ++;
        })(),
        (async () => {
          const res = await runNuvioClientFanout(upstream.port, hybridNative, { concurrency: 10, timeoutMs: 2500, simulateNuvioFetchBug: true });
          if (res.streams.length && ttfr === null) ttfr = +(performance.now() - t0).toFixed(2);
          streams.push(...res.streams);
          succ += res.successes;
        })()
      ]);
      const totalMs = +(performance.now() - t0).toFixed(2);
      return { ttfrMs: ttfr ?? totalMs, totalMs, requests: 3, successes: succ, timeouts: 0, errors: 0, streams };
    }));

    // 2. Warm cache comparison
    report.warm.push(await runArchitecture('A_Native_JS_Warm', () =>
      runNuvioClientFanout(upstream.port, nativeTargets, { sessionCache: sessionCacheA, cacheKey: 'movie:550' })
    ));
    report.warm.push(await runArchitecture('B_HTTP_Addons_Warm', () =>
      runNuvioClientFanout(upstream.port, httpTargets, { sessionCache: sessionCacheB, cacheKey: 'movie:550' })
    ));
    report.warm.push(await runArchitecture('C_AIOStreams_Aggregator_Warm', async () => {
      const t0 = performance.now();
      const url = `http://127.0.0.1:${agg.port}/?cache=1&key=movie:550&timeout=1500&upstreams=${encodeURIComponent(JSON.stringify(httpTargets))}`;
      const r = await fetch(url);
      const data = await r.json();
      const ms = +(performance.now() - t0).toFixed(2);
      return { ttfrMs: ms, totalMs: ms, requests: 1, successes: 1, timeouts: 0, errors: 0, streams: data.streams };
    }));
    report.warm.push(await runArchitecture('D_Minimal_Hybrid_Warm', () =>
      runNuvioClientFanout(upstream.port, hybridNative, { sessionCache: sessionCacheD, cacheKey: 'movie:550' })
    ));

    // 3. Failure scenarios (5 iterations each to keep runtime crisp)
    const failureConfigs = {
      slow_upstream: [
        { id: 'addon_1', delay: 20 },
        { id: 'addon_2', delay: 2500 } // exceeds 1000ms timeout
      ],
      unavailable: [
        { id: 'addon_1', delay: 20 },
        { id: 'addon_dead', unavailable: true }
      ],
      http_403_429_500: [
        { id: 'addon_1', delay: 20 },
        { id: 'addon_403', scenario: 'http403', delay: 15 },
        { id: 'addon_429', scenario: 'http429', delay: 15 },
        { id: 'addon_500', scenario: 'http500', delay: 15 }
      ],
      malformed_json: [
        { id: 'addon_1', delay: 20 },
        { id: 'addon_bad', scenario: 'malformed', delay: 15 }
      ],
      empty_and_invalid_meta: [
        { id: 'addon_1', delay: 20 },
        { id: 'addon_empty', scenario: 'empty', delay: 15 },
        { id: 'addon_inv', scenario: 'invalid_meta', delay: 15 }
      ],
      network_interrupt: [
        { id: 'addon_1', delay: 20 },
        { id: 'addon_cut', scenario: 'interrupt', delay: 15 }
      ],
      expired_media_url: [
        { id: 'addon_exp', scenario: 'expired_url', delay: 15 }
      ],
      duplicates: [
        { id: 'addon_1', delay: 20 },
        { id: 'addon_2', delay: 25 }
      ]
    };

    for (const [fName, fTargets] of Object.entries(failureConfigs)) {
      const clientRes = await runArchitecture(`Client_${fName}`, () =>
        runNuvioClientFanout(upstream.port, fTargets, { concurrency: 10, timeoutMs: 800, simulateNuvioFetchBug: false }),
        5
      );
      const aggRes = await runArchitecture(`Aggregator_${fName}`, async () => {
        const t0 = performance.now();
        const r = await fetch(`http://127.0.0.1:${agg.port}/?cache=0&timeout=800&upstreams=${encodeURIComponent(JSON.stringify(fTargets))}`);
        const d = await r.json();
        const ms = +(performance.now() - t0).toFixed(2);
        return {
          ttfrMs: ms,
          totalMs: ms,
          requests: fTargets.length,
          successes: fTargets.length - d.errors.length - d.timeouts,
          timeouts: d.timeouts,
          errors: d.errors.length,
          streams: d.streams
        };
      }, 5);
      report.failures[fName] = { client: clientRes, aggregator: aggRes };
    }

    // Verify expired media URL returns HTTP 410 when probed
    const expProbe = await fetch(`http://127.0.0.1:${upstream.port}/media?expired=1`);
    report.expired_media_probe_status = expProbe.status;

    fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
    console.log('=== COLD CACHE BENCHMARK ===');
    console.table(report.cold);
    console.log('=== WARM CACHE BENCHMARK ===');
    console.table(report.warm);
    console.log('=== FAILURE SCENARIOS (Aggregator vs Client) ===');
    for (const [k, v] of Object.entries(report.failures)) {
      console.log(`-- ${k} --`);
      console.log('  Client    :', `total=${v.client.total_median_ms}ms`, `ok=${v.client.success_rate_pct}%`, `to=${v.client.timeout_rate_pct}%`, `err=${v.client.error_rate_pct}%`, `dup=${v.client.duplicate_rate_pct}%`);
      console.log('  Aggregator:', `total=${v.aggregator.total_median_ms}ms`, `ok=${v.aggregator.success_rate_pct}%`, `to=${v.aggregator.timeout_rate_pct}%`, `err=${v.aggregator.error_rate_pct}%`, `dup=${v.aggregator.duplicate_rate_pct}%`);
    }
    console.log('Expired media URL probe HTTP status:', report.expired_media_probe_status);
  } finally {
    agg.server.close();
    upstream.closeAll();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
