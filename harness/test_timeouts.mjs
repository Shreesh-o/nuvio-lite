import fs from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

// Re-test the 18 providers that reference AbortController/Promise.race/setTimeout with a 12.5s cap
// against a 15s hanging server to measure whether their JS-side timeout actually fires!
const TARGETS = [
  ['michat88', 'streamflix'],
  ['asura', 'peachify'],
  ['asura', 'moviesdrive'],
  ['asura', 'animetsu'],
  ['asura', 'zinkmovies'],
  ['asura', 'playimdb'],
  ['asura', '4khdhub'],
  ['asura', 'hindmovie'],
  ['asura', 'hdhub4u'],
  ['abinanthankv', 'tamilmv'],
  ['abinanthankv', 'tamilblasters'],
  ['abinanthankv', 'tamilian'],
  ['abinanthankv', 'moviesda'],
  ['abinanthankv', 'movies4u'],
  ['abinanthankv', 'isaidub'],
  ['abinanthankv', 'toonhub'],
  ['abinanthankv', 'animelok'],
  ['abinanthankv', 'xdmovies']
];

const inv = JSON.parse(fs.readFileSync('/home/shreesh/nuvio-audit/sources/inventory.json', 'utf8'));

const server = http.createServer((req, res) => {
  const timer = setTimeout(() => {
    if (!res.writableEnded) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    }
  }, 15000);
  req.on('close', () => clearTimeout(timer));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

class NuvioAbortSignal {
  constructor() { this.aborted = false; this.reason = undefined; this._l = []; }
  addEventListener(t, f) { if (t === 'abort' && typeof f === 'function') this._l.push(f); }
  removeEventListener(t, f) { if (t === 'abort') this._l = this._l.filter((x) => x !== f); }
  dispatchEvent(e) { if (e && e.type === 'abort') this._l.forEach((f) => { try { f.call(this, e); } catch {} }); return true; }
}
class NuvioAbortController {
  constructor() { this.signal = new NuvioAbortSignal(); }
  abort(r) { if (this.signal.aborted) return; this.signal.aborted = true; this.signal.reason = r; this.signal.dispatchEvent({ type: 'abort' }); }
}

const cheerioStub = { load: () => Object.assign(() => ({ length: 0, each() { return this; }, find() { return this; }, text() { return ''; }, attr() {}, first() { return this; }, map() { return { get: () => [] }; } }), { html: () => '' }) };
const cryptoStub = { enc: { Utf8: { parse: () => ({}) }, Hex: { parse: () => ({}) }, Base64: { parse: () => ({}) } }, mode: { CBC: 'CBC' }, pad: { Pkcs7: 'Pkcs7' }, MD5: () => ({ toString: () => '' }), SHA256: () => ({ toString: () => '' }), HmacSHA256: () => ({ toString: () => '' }), AES: { encrypt: () => ({ toString: () => '' }), decrypt: () => ({ toString: () => '' }) } };

async function testOne([rk, pid]) {
  const entry = inv.find((x) => x.repo_key === rk && x.id === pid);
  const code = fs.readFileSync(entry.local_path, 'utf8');
  const timers = new Set();
  const aborts = [];
  let abortedCount = 0;

  const sFetch = async (url, opts = {}) => {
    const sig = opts && opts.signal;
    if (sig && sig.aborted) { abortedCount++; throw new Error('Aborted'); }
    const ac = new AbortController();
    aborts.push(ac);
    let fn;
    if (sig && typeof sig.addEventListener === 'function') {
      fn = () => { abortedCount++; ac.abort(); };
      sig.addEventListener('abort', fn);
    }
    try {
      const resp = await globalThis.fetch(`http://127.0.0.1:${port}/`, { signal: ac.signal });
      const txt = await resp.text();
      return { ok: resp.ok, status: resp.status, url: String(url), headers: { get: () => null }, text: async () => txt, json: async () => ({}) };
    } finally {
      if (sig && fn && typeof sig.removeEventListener === 'function') sig.removeEventListener('abort', fn);
    }
  };

  const mod = { exports: {} };
  const ctxObj = {
    SCRAPER_ID: pid, SCRAPER_SETTINGS: {}, TMDB_API_KEY: 'mock',
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout: (f, ms, ...a) => { const id = setTimeout(() => { timers.delete(id); f(...a); }, Math.min(Number(ms) || 0, 14000)); timers.add(id); return id; },
    clearTimeout: (id) => { timers.delete(id); clearTimeout(id); },
    setInterval: () => 0, clearInterval: () => {},
    fetch: sFetch, atob: (s) => Buffer.from(s, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    TextEncoder, TextDecoder, URL, URLSearchParams,
    AbortController: NuvioAbortController, AbortSignal: NuvioAbortSignal,
    CryptoJS: cryptoStub, cheerio: cheerioStub,
    require: (m) => m === 'crypto-js' ? cryptoStub : cheerioStub,
    module: mod, exports: mod.exports,
    Promise, JSON, Math, Date, RegExp, Array, Object, String, Number, Boolean, Error, TypeError, Map, Set, Uint8Array, ArrayBuffer,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent
  };
  ctxObj.globalThis = ctxObj; ctxObj.global = ctxObj; ctxObj.window = ctxObj; ctxObj.self = ctxObj;
  const ctx = vm.createContext(ctxObj);

  const t0 = performance.now();
  let status = 'ok';
  let errMsg = null;
  let timer;
  try {
    vm.runInContext(`(function(){\n${code}\n})();`, ctx, { timeout: 1500 });
    const fn = ctx.module.exports?.getStreams || ctx.getStreams;
    await Promise.race([
      Promise.resolve().then(() => fn('550', 'movie', null, null)),
      new Promise((_, rej) => { timer = setTimeout(() => { status = 'cap_12500ms'; rej(new Error('CAP')); }, 12500); })
    ]);
    clearTimeout(timer);
  } catch (e) {
    clearTimeout(timer);
    if (status === 'ok') status = 'error';
    errMsg = e.message;
  } finally {
    for (const id of timers) clearTimeout(id);
    for (const c of aborts) try { c.abort(); } catch {}
  }
  return { id: `${rk}/${pid}`, status, latency_ms: +(performance.now() - t0).toFixed(1), abortedCount, errMsg };
}

const out = await Promise.all(TARGETS.map(testOne));
fs.writeFileSync('/home/shreesh/nuvio-audit/sources/phase2_timeouts.json', JSON.stringify(out, null, 2));
for (const r of out) {
  console.log(`${r.id.padEnd(28)} | status=${r.status.padEnd(11)} | ms=${String(r.latency_ms).padStart(7)} | aborts=${r.abortedCount} | err=${r.errMsg || ''}`);
}
server.close();
