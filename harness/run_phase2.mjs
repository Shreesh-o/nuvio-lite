import vm from 'node:vm';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const INVENTORY_PATH = '/home/shreesh/nuvio-audit/sources/inventory.json';
const OUT_PATH = '/home/shreesh/nuvio-audit/sources/phase2_results.json';
const SLOW_SERVER_DELAY_MS = 3500;
const HARNESS_TIMEOUT_MS = 2200;

function createMockServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const mode = u.searchParams.get('mode') || 'ok';
    const orig = u.searchParams.get('orig') || '';

    if (mode === 'slow') {
      const timer = setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, slow: true, sources: [] }));
        }
      }, SLOW_SERVER_DELAY_MS);
      req.on('close', () => clearTimeout(timer));
      return;
    }

    if (mode === 'fail') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
      return;
    }

    if (orig.includes('api.themoviedb.org')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 550,
        title: 'Fight Club',
        name: 'Fight Club',
        original_title: 'Fight Club',
        release_date: '1999-10-15',
        first_air_date: '1999-10-15',
        imdb_id: 'tt0137523',
        external_ids: { imdb_id: 'tt0137523' },
        genres: [{ id: 18, name: 'Drama' }],
        seasons: [{ season_number: 1, episode_count: 10 }],
        episodes: [{ episode_number: 1, name: 'Pilot' }]
      }));
      return;
    }

    if (orig.includes('api') || orig.includes('.json') || orig.includes('graphql')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        status: 200,
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        sources: [{
          url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
          file: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
          quality: '1080p',
          title: 'Big Buck Bunny'
        }],
        streams: [{
          url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
          quality: '1080p'
        }],
        results: [{ id: '550', title: 'Fight Club', name: 'Fight Club', url: '/movie/fight-club-1999', year: 1999 }],
        data: {
          sources: [{ file: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' }],
          list: [],
          PageProps: {}
        }
      }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body>
      <div class="flw-item"><h2 class="film-name"><a href="/movie/fight-club-1999" title="Fight Club">Fight Club (1999)</a></h2></div>
      <article class="item"><a href="/watch/fight-club-1999">Fight Club 1999 1080p</a></article>
      <div class="entry-content"><a href="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4">Download 1080p</a></div>
      <video src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"></video>
    </body></html>`);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

// Lightweight Cheerio shim matching DomBridge.kt surface
function createCheerioShim() {
  function parseNodes(html) {
    const nodes = [];
    const tagRe = /<([a-zA-Z0-9-]+)([^>]*)>([\s\S]*?)<\/\1>|<([a-zA-Z0-9-]+)([^>]*)\/?>/g;
    let m;
    while ((m = tagRe.exec(html)) !== null) {
      const tag = (m[1] || m[4] || '').toLowerCase();
      const attrStr = m[2] || m[5] || '';
      const inner = m[3] || '';
      const attrs = {};
      const attrRe = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
      let am;
      while ((am = attrRe.exec(attrStr)) !== null) {
        attrs[am[1].toLowerCase()] = am[2] ?? am[3] ?? am[4] ?? '';
      }
      const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      nodes.push({ tag, attrs, inner, text });
    }
    return nodes;
  }

  function matchSimple(node, sel) {
    if (!sel || sel === '*') return true;
    const part = sel.trim().split(/\s+/).pop();
    if (!part) return false;
    const tagM = part.match(/^[a-zA-Z0-9-]+/);
    if (tagM && node.tag !== tagM[0].toLowerCase()) return false;
    const idM = part.match(/#([a-zA-Z0-9_-]+)/);
    if (idM && node.attrs.id !== idM[1]) return false;
    const clsMatches = [...part.matchAll(/\.([a-zA-Z0-9_-]+)/g)];
    for (const cm of clsMatches) {
      const clsList = (node.attrs.class || '').split(/\s+/);
      if (!clsList.includes(cm[1])) return false;
    }
    return true;
  }

  function wrap(nodes, rawHtml = '') {
    const w = {
      length: nodes.length,
      each(cb) {
        nodes.forEach((n, i) => cb.call(wrap([n], n.inner), i, wrap([n], n.inner)));
        return w;
      },
      find(sel) {
        const sub = nodes.flatMap((n) => parseNodes(n.inner)).filter((n) => matchSimple(n, sel));
        return wrap(sub);
      },
      text() { return nodes.map((n) => n.text).join(' ').trim(); },
      html() { return nodes.length ? nodes[0].inner : rawHtml; },
      attr(name) { return nodes.length ? nodes[0].attrs[String(name).toLowerCase()] : undefined; },
      first() { return wrap(nodes.length ? [nodes[0]] : []); },
      last() { return wrap(nodes.length ? [nodes[nodes.length - 1]] : []); },
      next() { return wrap([]); },
      prev() { return wrap([]); },
      eq(i) { return wrap(i >= 0 && i < nodes.length ? [nodes[i]] : []); },
      get(i) { return typeof i === 'number' ? (i >= 0 && i < nodes.length ? wrap([nodes[i]]) : undefined) : nodes.map((n) => wrap([n])); },
      map(cb) {
        const res = [];
        nodes.forEach((n, i) => {
          const r = cb.call(wrap([n], n.inner), i, wrap([n], n.inner));
          if (r !== undefined && r !== null) res.push(r);
        });
        return { length: res.length, get: (i) => (typeof i === 'number' ? res[i] : res), toArray: () => res };
      },
      filter(cb) {
        if (typeof cb === 'function') {
          return wrap(nodes.filter((n, i) => cb.call(wrap([n], n.inner), i, wrap([n], n.inner))));
        }
        return wrap(nodes.filter((n) => matchSimple(n, cb)));
      },
      children(sel) { return w.find(sel || '*'); },
      parent() { return wrap([]); },
      toArray() { return nodes.map((n) => wrap([n])); }
    };
    return w;
  }

  return {
    load(html) {
      const str = String(html || '');
      const all = parseNodes(str);
      const $ = (sel, ctx) => {
        if (sel && typeof sel === 'object' && typeof sel.each === 'function') return sel;
        if (ctx && typeof ctx.find === 'function') return ctx.find(sel);
        if (typeof sel !== 'string') return wrap([]);
        const sels = sel.split(',').map((s) => s.trim()).filter(Boolean);
        const matched = all.filter((n) => sels.some((s) => matchSimple(n, s)));
        return wrap(matched, str);
      };
      $.html = (el) => (el && typeof el.html === 'function' ? el.html() : str);
      return $;
    }
  };
}

function createCryptoJsShim() {
  const mkWordArray = (buf) => ({
    words: Array.from(buf),
    sigBytes: buf.length,
    toString(enc) {
      if (enc === encHex) return buf.toString('hex');
      if (enc === encBase64) return buf.toString('base64');
      return buf.toString('utf8');
    }
  });
  const encUtf8 = { parse: (s) => mkWordArray(Buffer.from(String(s), 'utf8')), stringify: (w) => Buffer.from(w.words || []).toString('utf8') };
  const encHex = { parse: (s) => mkWordArray(Buffer.from(String(s), 'hex')), stringify: (w) => Buffer.from(w.words || []).toString('hex') };
  const encBase64 = { parse: (s) => mkWordArray(Buffer.from(String(s), 'base64')), stringify: (w) => Buffer.from(w.words || []).toString('base64') };
  const encLatin1 = { parse: (s) => mkWordArray(Buffer.from(String(s), 'latin1')), stringify: (w) => Buffer.from(w.words || []).toString('latin1') };

  return {
    enc: { Utf8: encUtf8, Hex: encHex, Base64: encBase64, Latin1: encLatin1 },
    mode: { CBC: 'CBC', ECB: 'ECB', CTR: 'CTR', CFB: 'CFB', OFB: 'OFB' },
    pad: { Pkcs7: 'Pkcs7', ZeroPadding: 'ZeroPadding', NoPadding: 'NoPadding' },
    MD5: (s) => mkWordArray(crypto.createHash('md5').update(String(s)).digest()),
    SHA1: (s) => mkWordArray(crypto.createHash('sha1').update(String(s)).digest()),
    SHA256: (s) => mkWordArray(crypto.createHash('sha256').update(String(s)).digest()),
    SHA512: (s) => mkWordArray(crypto.createHash('sha512').update(String(s)).digest()),
    HmacSHA256: (m, k) => mkWordArray(crypto.createHmac('sha256', String(k)).update(String(m)).digest()),
    AES: {
      encrypt: (d) => ({ toString: () => Buffer.from(String(d)).toString('base64') }),
      decrypt: (d) => mkWordArray(Buffer.from(String(d), 'utf8'))
    },
    PBKDF2: (p, s) => mkWordArray(crypto.pbkdf2Sync(String(p), String(s), 1, 32, 'sha256')),
    lib: { WordArray: { random: (n) => mkWordArray(crypto.randomBytes(n || 16)), create: (w) => mkWordArray(Buffer.from(w || [])) } }
  };
}

function buildSandbox({ mode, mockPort, fetchMode, scraperId }) {
  const logs = [];
  const outboundUrls = [];
  const timers = new Set();
  const intervals = new Set();
  const activeAborts = [];

  const cheerioShim = createCheerioShim();
  const cryptoJsShim = createCryptoJsShim();

  // Mimic JsBindings.kt AbortSignal WITHOUT AbortSignal.timeout
  class NuvioAbortSignal {
    constructor() { this.aborted = false; this.reason = undefined; this._listeners = []; }
    addEventListener(type, fn) { if (type === 'abort' && typeof fn === 'function') this._listeners.push(fn); }
    removeEventListener(type, fn) { if (type === 'abort') this._listeners = this._listeners.filter((l) => l !== fn); }
    dispatchEvent(ev) { if (ev && ev.type === 'abort') this._listeners.forEach((fn) => { try { fn.call(this, ev); } catch {} }); return true; }
  }
  class NuvioAbortController {
    constructor() { this.signal = new NuvioAbortSignal(); }
    abort(reason) {
      if (this.signal.aborted) return;
      this.signal.aborted = true;
      this.signal.reason = reason;
      this.signal.dispatchEvent({ type: 'abort' });
    }
  }

  const sandboxFetch = async (url, options = {}) => {
    const urlStr = String(url);
    outboundUrls.push(urlStr);
    const sig = options && options.signal;
    if (sig && sig.aborted) {
      throw new Error('Aborted');
    }

    const mockUrl = `http://127.0.0.1:${mockPort}/?mode=${encodeURIComponent(fetchMode)}&orig=${encodeURIComponent(urlStr)}`;
    const controller = new AbortController();
    activeAborts.push(controller);

    let onAbort;
    if (sig && typeof sig.addEventListener === 'function') {
      onAbort = () => controller.abort();
      sig.addEventListener('abort', onAbort);
    }

    try {
      const resp = await globalThis.fetch(mockUrl, {
        method: (options && options.method) || 'GET',
        signal: controller.signal
      });
      const textBody = await resp.text();
      return {
        ok: resp.ok,
        status: resp.status,
        statusText: resp.statusText,
        url: urlStr,
        headers: { get: (k) => resp.headers.get(k) },
        text: async () => textBody,
        json: async () => { try { return textBody ? JSON.parse(textBody) : null; } catch { return null; } },
        arrayBuffer: async () => Buffer.from(textBody).buffer
      };
    } finally {
      if (sig && onAbort && typeof sig.removeEventListener === 'function') {
        sig.removeEventListener('abort', onAbort);
      }
    }
  };

  const sandboxRequire = (modName) => {
    if (modName === 'cheerio' || modName === 'cheerio-without-node-native' || modName === 'react-native-cheerio') {
      return cheerioShim;
    }
    if (modName === 'crypto-js') {
      return cryptoJsShim;
    }
    if (mode === 'node_like') {
      if (modName === 'url') return { URL, URLSearchParams };
      if (modName === 'axios') {
        const fn = async (cfg) => ({ data: {}, status: 200, headers: {} });
        fn.get = async (u) => ({ data: '', status: 200, headers: {} });
        fn.post = async (u) => ({ data: {}, status: 200, headers: {} });
        return fn;
      }
    }
    throw new Error(`Module '${modName}' is not available`);
  };

  const mod = { exports: {} };
  const ctxObj = {
    SCRAPER_ID: scraperId,
    SCRAPER_SETTINGS: {},
    TMDB_API_KEY: 'mock_tmdb_key',
    console: {
      log: (...a) => logs.push(a.join(' ')),
      warn: (...a) => logs.push('WARN: ' + a.join(' ')),
      error: (...a) => logs.push('ERR: ' + a.join(' ')),
      info: (...a) => logs.push(a.join(' ')),
      debug: (...a) => logs.push(a.join(' '))
    },
    setTimeout: (fn, ms, ...args) => {
      const id = setTimeout(() => { timers.delete(id); fn(...args); }, Math.min(Number(ms) || 0, 5000));
      timers.add(id);
      return id;
    },
    clearTimeout: (id) => { timers.delete(id); clearTimeout(id); },
    setInterval: (fn, ms, ...args) => {
      const id = setInterval(() => fn(...args), Math.max(10, Math.min(Number(ms) || 10, 5000)));
      intervals.add(id);
      return id;
    },
    clearInterval: (id) => { intervals.delete(id); clearInterval(id); },
    fetch: sandboxFetch,
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    AbortController: mode === 'node_like' ? AbortController : NuvioAbortController,
    AbortSignal: mode === 'node_like' ? AbortSignal : NuvioAbortSignal,
    crypto: {
      getRandomValues: (arr) => crypto.randomFillSync(arr),
      randomUUID: () => crypto.randomUUID(),
      subtle: crypto.webcrypto.subtle
    },
    CryptoJS: cryptoJsShim,
    cheerio: cheerioShim,
    WebAssembly: {
      instantiate: async () => ({ instance: { exports: {} }, module: {} })
    },
    require: sandboxRequire,
    module: mod,
    exports: mod.exports,
    Promise,
    JSON, Math, Date, RegExp, Array, Object, String, Number, Boolean, Error, TypeError, RangeError, Map, Set, Uint8Array, ArrayBuffer, DataView,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI
  };

  if (mode === 'node_like') {
    ctxObj.Buffer = Buffer;
    ctxObj.process = { env: {}, exit: () => { throw new Error('process.exit called'); } };
  }

  ctxObj.globalThis = ctxObj;
  ctxObj.global = ctxObj;
  ctxObj.window = ctxObj;
  ctxObj.self = ctxObj;

  const context = vm.createContext(ctxObj);

  const cleanup = () => {
    for (const id of timers) clearTimeout(id);
    for (const id of intervals) clearInterval(id);
    for (const c of activeAborts) { try { c.abort(); } catch {} }
    timers.clear();
    intervals.clear();
  };

  return { context, logs, outboundUrls, cleanup };
}

async function runScenario(entry, mockPort, mode, fetchMode) {
  const code = fs.readFileSync(entry.local_path, 'utf8');
  const sb = buildSandbox({ mode, mockPort, fetchMode, scraperId: entry.id });
  const wrapped = `(function() {\n${code}\n})();`;

  const t0 = performance.now();
  let loadOk = false;
  let loadErr = null;
  let hasGetStreams = false;
  let execStatus = 'not_run';
  let execErr = null;
  let resultType = null;
  let resultCount = null;
  let timedOut = false;

  try {
    vm.runInContext(wrapped, sb.context, { timeout: 1500, filename: `${entry.repo_key}/${entry.id}.js` });
    loadOk = true;
  } catch (err) {
    loadErr = `${err.name}: ${err.message}`;
    sb.cleanup();
    return {
      load_ok: false,
      load_err: loadErr,
      has_getStreams: false,
      exec_status: 'load_failed',
      exec_err: loadErr,
      latency_ms: +(performance.now() - t0).toFixed(2),
      timed_out: false,
      outbound_count: sb.outboundUrls.length,
      outbound_sample: sb.outboundUrls.slice(0, 5)
    };
  }

  const fn = sb.context.module.exports?.getStreams || sb.context.getStreams;
  hasGetStreams = typeof fn === 'function';
  if (!hasGetStreams) {
    sb.cleanup();
    return {
      load_ok: true,
      load_err: null,
      has_getStreams: false,
      exec_status: 'missing_getStreams',
      exec_err: 'getStreams function not exported or global',
      latency_ms: +(performance.now() - t0).toFixed(2),
      timed_out: false,
      outbound_count: sb.outboundUrls.length,
      outbound_sample: sb.outboundUrls.slice(0, 5)
    };
  }

  const tExec0 = performance.now();
  let timer;
  try {
    const callPromise = Promise.resolve().then(() => fn('550', 'movie', null, null));
    const res = await Promise.race([
      callPromise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error('HARNESS_TIMEOUT'));
        }, HARNESS_TIMEOUT_MS);
      })
    ]);
    clearTimeout(timer);
    if (Array.isArray(res)) {
      execStatus = 'ok';
      resultType = 'array';
      resultCount = res.length;
    } else {
      execStatus = 'non_array_return';
      resultType = typeof res;
    }
  } catch (err) {
    clearTimeout(timer);
    execErr = `${err.name || 'Error'}: ${err.message || String(err)}`;
    execStatus = timedOut ? 'harness_timeout' : 'rejected_or_threw';
  } finally {
    sb.cleanup();
  }

  return {
    load_ok: loadOk,
    load_err: loadErr,
    has_getStreams: hasGetStreams,
    exec_status: execStatus,
    exec_err: execErr,
    latency_ms: +(performance.now() - tExec0).toFixed(2),
    timed_out: timedOut,
    result_type: resultType,
    result_count: resultCount,
    outbound_count: sb.outboundUrls.length,
    outbound_sample: sb.outboundUrls.slice(0, 5)
  };
}

async function runBatch(items, concurrency, worker) {
  const out = new Array(items.length);
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, next));
  return out;
}

async function main() {
  const inv = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  const available = inv.filter((e) => e.http_status === 200 && fs.existsSync(e.local_path));
  const { server, port } = await createMockServer();

  try {
    const results = await runBatch(available, 8, async (entry) => {
      const nuvioFast = await runScenario(entry, port, 'nuvio', 'ok');
      const nodeFast = await runScenario(entry, port, 'node_like', 'ok');
      const nuvioFail = await runScenario(entry, port, 'nuvio', 'fail');
      const nuvioSlow = await runScenario(entry, port, 'nuvio', 'slow');
      return {
        repo: entry.repo,
        repo_key: entry.repo_key,
        id: entry.id,
        nuvio_fast: nuvioFast,
        node_fast: nodeFast,
        nuvio_fail: nuvioFail,
        nuvio_slow: nuvioSlow
      };
    });

    fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));

    console.log(`Benchmarked ${results.length} available providers.`);
    console.log('--- NUVIO SANDBOX LOAD/EXPORT FAILURES ---');
    for (const r of results) {
      if (!r.nuvio_fast.load_ok || !r.nuvio_fast.has_getStreams) {
        console.log(`  ${r.repo_key}/${r.id}: nuvio=${r.nuvio_fast.exec_status} (${r.nuvio_fast.exec_err}) | node_like=${r.node_fast.exec_status}`);
      }
    }
    console.log('--- NUVIO vs NODE_LIKE DIFFERENCES ---');
    for (const r of results) {
      if (r.nuvio_fast.exec_status !== r.node_fast.exec_status || (r.nuvio_fast.exec_err && r.nuvio_fast.exec_err !== r.node_fast.exec_err)) {
        console.log(`  ${r.repo_key}/${r.id}: nuvio=${r.nuvio_fast.exec_status}(${r.nuvio_fast.exec_err}) vs node=${r.node_fast.exec_status}(${r.node_fast.exec_err})`);
      }
    }
    console.log('--- NUVIO MOCK-500 ERRORS (unhandled rejections) ---');
    for (const r of results) {
      if (r.nuvio_fail.exec_status !== 'ok') {
        console.log(`  ${r.repo_key}/${r.id}: fail_status=${r.nuvio_fail.exec_status} (${r.nuvio_fail.exec_err})`);
      }
    }
    console.log('--- NUVIO SLOW-SERVER TIMEOUT BEHAVIOR ---');
    const slowSummary = {};
    for (const r of results) {
      const k = r.nuvio_slow.exec_status;
      slowSummary[k] = (slowSummary[k] || 0) + 1;
    }
    console.log('  Slow summary:', slowSummary);
    for (const r of results) {
      if (r.nuvio_slow.exec_status !== 'harness_timeout') {
        console.log(`  EARLY_RETURN/ABORT: ${r.repo_key}/${r.id}: ${r.nuvio_slow.exec_status} in ${r.nuvio_slow.latency_ms}ms (${r.nuvio_slow.exec_err || 'returned []'})`);
      }
    }
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
