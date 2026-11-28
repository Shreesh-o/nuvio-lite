import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import vm from 'node:vm';
import fs from 'node:fs';

const PROVIDERS_DIR = '/home/shreesh/nuvio-audit/providers';
const MANIFEST_PATH = '/home/shreesh/nuvio-audit/manifest.json';

function encryptCastlePayload(obj, secKeyB64) {
  const rawKey = Buffer.concat([
    Buffer.from(secKeyB64, 'base64'),
    Buffer.from('T!BgJB', 'utf8'),
  ]);
  const keyIv = Buffer.alloc(16, 0);
  rawKey.copy(keyIv, 0, 0, Math.min(rawKey.length, 16));
  const cipher = crypto.createCipheriv('aes-128-cbc', keyIv, keyIv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return enc.toString('base64');
}

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
      if (inner && inner.includes('<')) {
        nodes.push(...parseNodes(inner));
      }
    }
    return nodes;
  }
  function matchSimple(node, sel) {
    if (!sel || sel === '*') return true;
    const part = sel.trim().split(/\s+/).pop();
    if (!part) return false;
    const basePart = part.replace(/\[[^\]]+\]/g, '');
    const tagM = basePart.match(/^[a-zA-Z0-9-]+/);
    if (tagM && node.tag !== tagM[0].toLowerCase()) return false;
    const idM = basePart.match(/#([a-zA-Z0-9_-]+)/);
    if (idM && node.attrs.id !== idM[1]) return false;
    for (const cm of basePart.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
      if (!(node.attrs.class || '').split(/\s+/).includes(cm[1])) return false;
    }
    for (const am of part.matchAll(/\[([a-zA-Z0-9_:-]+)(?:([*^$]?=)(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g)) {
      const attrVal = node.attrs[am[1].toLowerCase()];
      if (attrVal === undefined) return false;
      if (am[2]) {
        const expected = am[3] ?? am[4] ?? am[5] ?? '';
        if (am[2] === '=' && attrVal !== expected) return false;
        if (am[2] === '*=' && !attrVal.includes(expected)) return false;
        if (am[2] === '^=' && !attrVal.startsWith(expected)) return false;
        if (am[2] === '$=' && !attrVal.endsWith(expected)) return false;
      }
    }
    return true;
  }
  function wrap(nodes, rawHtml = '') {
    const w = {
      length: nodes.length,
      each(cb) { nodes.forEach((n, i) => cb.call(wrap([n], n.inner), i, wrap([n], n.inner))); return w; },
      find(sel) { return wrap(nodes.flatMap((n) => parseNodes(n.inner)).filter((n) => matchSimple(n, sel))); },
      text() { return nodes.map((n) => n.text).join(' ').trim(); },
      html() { return nodes.length ? nodes[0].inner : rawHtml; },
      attr(name) { return nodes.length ? nodes[0].attrs[String(name).toLowerCase()] : undefined; },
      first() { return wrap(nodes.length ? [nodes[0]] : []); },
      eq(i) { return wrap(i >= 0 && i < nodes.length ? [nodes[i]] : []); },
      map(cb) {
        const res = [];
        nodes.forEach((n, i) => {
          const r = cb.call(wrap([n], n.inner), i, wrap([n], n.inner));
          if (r !== undefined && r !== null) res.push(r);
        });
        return { length: res.length, get: (i) => (typeof i === 'number' ? res[i] : res), toArray: () => res };
      },
      filter(cb) {
        if (typeof cb === 'function') return wrap(nodes.filter((n, i) => cb.call(wrap([n], n.inner), i, wrap([n], n.inner))));
        return wrap(nodes.filter((n) => matchSimple(n, cb)));
      },
      toArray() { return nodes.map((n) => wrap([n])); },
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
        return wrap(all.filter((n) => sels.some((s) => matchSimple(n, s))), str);
      };
      return $;
    },
  };
}

function loadProviderInSandbox(filename, routeHandler) {
  const code = fs.readFileSync(`${PROVIDERS_DIR}/${filename}`, 'utf8');
  const cheerioShim = createCheerioShim();
  const requests = [];

  const sandboxFetch = async (url, options = {}) => {
    const urlStr = String(url);
    requests.push({ url: urlStr, method: options.method || 'GET' });
    const res = await routeHandler(urlStr, options);
    const status = res.status || 200;
    const bodyText = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'ERR',
      url: urlStr,
      headers: { get: () => 'application/json' },
      text: async () => bodyText,
      json: async () => JSON.parse(bodyText),
    };
  };

  const mod = { exports: {} };
  const ctxObj = {
    SCRAPER_ID: filename.replace(/\.js$/, ''),
    SCRAPER_SETTINGS: {},
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout,
    clearTimeout,
    fetch: sandboxFetch,
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    AbortController,
    AbortSignal,
    crypto: { getRandomValues: (a) => crypto.randomFillSync(a), randomUUID: () => crypto.randomUUID() },
    cheerio: cheerioShim,
    require: (m) => {
      if (m.includes('cheerio')) return cheerioShim;
      throw new Error(`Module '${m}' not available`);
    },
    module: mod,
    exports: mod.exports,
    Promise, JSON, Math, Date, RegExp, Array, Object, String, Number, Boolean, Error, TypeError, Map, Set, Uint8Array, ArrayBuffer, DataView,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  };
  ctxObj.globalThis = ctxObj;
  ctxObj.global = ctxObj;
  ctxObj.window = ctxObj;
  ctxObj.self = ctxObj;

  const context = vm.createContext(ctxObj);
  vm.runInContext(`(function() {\n${code}\n})();`, context, { timeout: 2000, filename });
  const rawGetStreams = context.module.exports?.getStreams || context.getStreams;
  assert.equal(typeof rawGetStreams, 'function', `${filename} must export getStreams`);
  const getStreams = async (...args) => {
    const out = await rawGetStreams(...args);
    return JSON.parse(JSON.stringify(out));
  };
  return { getStreams, requests };
}

const SEC_KEY = Buffer.from('0123456789').toString('base64');

function castleRouter({ tmdbFailPrimary = false } = {}) {
  const tmdbById = {
    'tv/300146': { id: 300146, name: 'Where the Mask Ends', first_air_date: '2026-10-08', original_language: 'zh', origin_country: ['CN'], genres: [{ id: 18, name: 'Drama' }] },
    'tv/999001': { id: 999001, name: 'River of No Return', first_air_date: '2026-11-20', original_language: 'zh', origin_country: ['CN'], genres: [{ id: 18, name: 'Drama' }] },
    'tv/307853': { id: 307853, name: 'Sunshine through the Rain', first_air_date: '2026-11-06', original_language: 'zh', origin_country: ['CN'], genres: [{ id: 18, name: 'Drama' }] },
    'tv/303745': { id: 303745, name: 'Love in Disguise', first_air_date: '2026-10-19', original_language: 'ko', origin_country: ['KR'], genres: [{ id: 18, name: 'Drama' }] },
    'tv/279246': { id: 279246, name: 'The Remarried Empress', first_air_date: '2026-11-03', original_language: 'ko', origin_country: ['KR'], genres: [{ id: 18, name: 'Drama' }] },
    'movie/929379': { id: 929379, title: 'Mask', release_date: '2025-11-21', original_language: 'ta', origin_country: ['IN'], genres: [{ id: 53, name: 'Thriller' }] },
  };

  const castleSearch = {
    'Where the Mask Ends': [
      { id: '9293794879', title: 'Mask', movieTypeName: 'Movies', movieType: 1, countries: ['India'], languages: ['Tamil'] },
    ],
    'River of No Return': [
      { id: '8645216363', title: 'River of Blood', movieTypeName: 'Movies', movieType: 1, countries: ['United Kingdom'], languages: ['Hindi'] },
    ],
    'Sunshine through the Rain': [
      { id: '5630243101', title: 'The Rain', movieTypeName: 'TV shows', movieType: 2, countries: ['Denmark', 'United States'], languages: ['English'] },
    ],
    'Love in Disguise': [
      { id: '1023348536', title: 'Love in Disguise', movieTypeName: 'TV shows', movieType: 2, countries: ['South Korea'], languages: ['Korean', 'Hindi'] },
    ],
    'The Remarried Empress': [
      { id: '1028471715', title: 'The Remarried Empress', movieTypeName: 'TV shows', movieType: 2, countries: ['South Korea'], languages: ['Korean', 'English'] },
    ],
    'Mask': [
      { id: '9293794879', title: 'Mask', movieTypeName: 'Movies', movieType: 1, countries: ['India'], languages: ['Tamil'] },
    ],
  };

  const castleDetails = {
    '9293794879': { title: 'Mask', movieTypeName: 'Movies', publishTime: Date.parse('2025-11-21T00:00:00Z'), countries: ['India'], languages: ['Tamil'], seasons: [], episodes: [{ id: 'ep_mask', number: 1, tracks: [] }] },
    '8645216363': { title: 'River of Blood', movieTypeName: 'Movies', publishTime: Date.parse('2024-10-17T00:00:00Z'), countries: ['United Kingdom'], languages: ['Hindi'], seasons: [], episodes: [{ id: 'ep_rob', number: 1, tracks: [] }] },
    '5630243101': { title: 'The Rain', movieTypeName: 'TV shows', publishTime: Date.parse('2018-05-04T00:00:00Z'), countries: ['Denmark'], languages: ['English'], seasons: [{ number: 1, movieId: '5630243101' }], episodes: [{ id: 'ep_rain_1', number: 1, tracks: [] }] },
    '1023348536': { title: 'Love in Disguise', movieTypeName: 'TV shows', publishTime: Date.parse('2026-10-19T00:00:00Z'), countries: ['South Korea'], languages: ['Korean'], seasons: [{ number: 1, movieId: '1023348536' }], episodes: [{ id: 'ep_lid_1', number: 1, tracks: [] }] },
    '1028471715': { title: 'The Remarried Empress', movieTypeName: 'TV shows', publishTime: Date.parse('2026-11-03T00:00:00Z'), countries: ['South Korea'], languages: ['Korean'], seasons: [{ number: 1, movieId: '1028471715' }], episodes: [{ id: 'ep_re_1', number: 1, tracks: [] }, { id: 'ep_re_2', number: 2, tracks: [] }] },
  };

  return async (url, options) => {
    const u = new URL(url);
    if (u.hostname === 'api.themoviedb.org' && tmdbFailPrimary) {
      return { status: 500, body: { error: 'SNI reset' } };
    }
    if (u.hostname === 'api.themoviedb.org' || u.hostname === 'api.tmdb.org' || u.hostname === 'db.wecollege.net') {
      const m = u.pathname.match(/\/3\/(movie|tv)\/(\d+)/);
      if (m && tmdbById[`${m[1]}/${m[2]}`]) return { status: 200, body: tmdbById[`${m[1]}/${m[2]}`] };
      return { status: 404, body: {} };
    }
    if (u.pathname.includes('/system/getSecurityKey/')) {
      return { status: 200, body: { code: 200, data: SEC_KEY } };
    }
    if (u.pathname.includes('/movie/searchByKeyword')) {
      const kw = u.searchParams.get('keyword') || '';
      return { status: 200, body: { data: encryptCastlePayload({ data: { rows: castleSearch[kw] || [] } }, SEC_KEY) } };
    }
    if (u.pathname.endsWith('/film-api/v1.9.9/movie')) {
      const mid = u.searchParams.get('movieId');
      return { status: 200, body: { data: encryptCastlePayload({ data: castleDetails[mid] || {} }, SEC_KEY) } };
    }
    if (u.pathname.includes('/movie/getVideo2')) {
      const parsed = JSON.parse(options.body || '{}');
      return {
        status: 200,
        body: {
          data: encryptCastlePayload({
            data: {
              videoUrl: `https://cdn.example.invalid/${parsed.movieId}/${parsed.episodeId}.m3u8`,
              videos: [{ resolution: '1080p', size: 800000000, url: `https://cdn.example.invalid/${parsed.movieId}/${parsed.episodeId}.m3u8` }],
              subtitles: [],
            },
          }, SEC_KEY),
        },
      };
    }
    if (u.hostname === 'localhost') return { status: 500, body: 'no local server' };
    return { status: 404, body: {} };
  };
}

test('castle: rejects Indian movie substring match ("Mask") for Chinese series "Where the Mask Ends"', async () => {
  const { getStreams } = loadProviderInSandbox('castle.js', castleRouter());
  const streams = await getStreams('300146', 'series', 1, 1);
  assert.deepEqual(streams, []);
});

test('castle: rejects blind rows[0] fallback ("River of Blood") for "River of No Return"', async () => {
  const { getStreams } = loadProviderInSandbox('castle.js', castleRouter());
  const streams = await getStreams('999001', 'tv', 1, 1);
  assert.deepEqual(streams, []);
});

test('castle: rejects wrong year/country show ("The Rain" 2018 Denmark) for "Sunshine through the Rain" (2026 China)', async () => {
  const { getStreams } = loadProviderInSandbox('castle.js', castleRouter());
  const streams = await getStreams('307853', 'tv', 1, 1);
  assert.deepEqual(streams, []);
});

test('castle: does not fall back to episodes[0] when requested episode is missing on series', async () => {
  const { getStreams } = loadProviderInSandbox('castle.js', castleRouter());
  const streams = await getStreams('303745', 'series', 1, 99);
  assert.deepEqual(streams, []);
});

test('castle: plays exact requested episode on genuine series match even when mediaType="series" and api.themoviedb.org fails', async () => {
  const { getStreams } = loadProviderInSandbox('castle.js', castleRouter({ tmdbFailPrimary: true }));
  const streams = await getStreams('279246', 'series', 1, 2);
  assert.equal(streams.length, 1);
  assert.match(streams[0].url, /ep_re_2\.m3u8/);
});

test('castle: plays genuine movie match ("Mask" 2025 India)', async () => {
  const { getStreams } = loadProviderInSandbox('castle.js', castleRouter());
  const streams = await getStreams('929379', 'movie', null, null);
  assert.equal(streams.length, 1);
  assert.match(streams[0].url, /ep_mask\.m3u8/);
});

test('kisskh: rejects blind searchList[0] fallback for missing drama', async () => {
  const { getStreams } = loadProviderInSandbox('kisskh.js', async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('/3/tv/999002')) return { status: 200, body: { id: 999002, name: 'Unknown Drama XYZ', first_air_date: '2026-11-01', original_language: 'ko', origin_country: ['KR'] } };
    if (u.pathname.includes('/DramaList/Search')) return { status: 200, body: [{ id: 777, title: 'Completely Different Show' }] };
    if (u.pathname.includes('/DramaList/Drama/777')) return { status: 200, body: { title: 'Completely Different Show', type: 'TVSeries', releaseDate: '2024-01-01T00:00:00', episodes: [{ id: 7771, number: 1 }] } };
    if (u.hostname === 'script.google.com') return { status: 200, body: { key: 'k777' } };
    if (u.pathname.includes('/Episode/7771.png')) return { status: 200, body: { Video: 'https://cdn.example.invalid/wrong_drama.m3u8' } };
    return { status: 404, body: {} };
  });
  const streams = await getStreams('999002', 'tv', 1, 1);
  assert.deepEqual(streams, []);
});

test('kisskh: matches year-suffixed "Hidden Love (2023)" with TMDB fallback and mediaType="series"', async () => {
  const { getStreams } = loadProviderInSandbox('kisskh.js', async (url) => {
    const u = new URL(url);
    if (u.hostname === 'api.themoviedb.org') return { status: 500, body: {} };
    if ((u.hostname === 'api.tmdb.org' || u.hostname === 'db.wecollege.net') && u.pathname.includes('/3/tv/210733')) {
      return { status: 200, body: { id: 210733, name: 'Hidden Love', first_air_date: '2023-06-20', original_language: 'zh', origin_country: ['CN'] } };
    }
    if (u.pathname.includes('/DramaList/Search')) return { status: 200, body: [{ id: 6158, title: 'Hidden Love (2023)' }] };
    if (u.pathname.includes('/DramaList/Drama/6158')) return { status: 200, body: { title: 'Hidden Love (2023)', type: 'TVSeries', country: 'China', releaseDate: '2023-06-20T00:00:00', episodes: [{ id: 1001, number: 1 }] } };
    if (u.hostname === 'script.google.com') return { status: 200, body: { key: 'k123' } };
    if (u.pathname.includes('/Episode/1001.png')) return { status: 200, body: { Video: 'https://cdn.example.invalid/hidden_love_1.m3u8' } };
    return { status: 404, body: {} };
  });
  const streams = await getStreams('210733', 'series', 1, 1);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example.invalid/hidden_love_1.m3u8');
});

test('vidlink: uses TMDB mirror fallback and normalizes mediaType="series" to /tv/ endpoint', async () => {
  const { getStreams, requests } = loadProviderInSandbox('vidlink.js', async (url) => {
    const u = new URL(url);
    if (u.hostname === 'api.themoviedb.org') return { status: 500, body: {} };
    if ((u.hostname === 'api.tmdb.org' || u.hostname === 'db.wecollege.net') && u.pathname.includes('/3/tv/210733')) {
      return { status: 200, body: { id: 210733, name: 'Hidden Love', first_air_date: '2023-06-20' } };
    }
    if (u.hostname === 'enc-dec.app') return { status: 200, body: { result: 'ENC210733' } };
    if (u.hostname === 'vidlink.pro' && u.pathname === '/api/b/tv/ENC210733/1/2') {
      return { status: 200, body: { stream: { qualities: { '1080': { url: 'https://cdn.example.invalid/hl_s1e2.mp4' } } } } };
    }
    return { status: 404, body: {} };
  });
  const streams = await getStreams('210733', 'series', 1, 2);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example.invalid/hl_s1e2.mp4');
  assert.ok(requests.some((r) => r.url.includes('/api/b/tv/ENC210733/1/2')));
});

test('redflix: rejects blind candidates[0] fallback on unrelated search results', async () => {
  const { getStreams } = loadProviderInSandbox('redflix.js', async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('/3/movie/300147')) {
      return { status: 200, body: { id: 300147, title: 'Where the Mask Ends', release_date: '2026-10-08', external_ids: { imdb_id: 'tt9990001' } } };
    }
    if (u.pathname.includes('/search')) {
      return { status: 200, body: '<html><body><a href="/movie/totally-wrong-indian-film-2025/">Totally Wrong Indian Film (2025)</a></body></html>' };
    }
    if (u.pathname.includes('/movie/totally-wrong-indian-film-2025/')) {
      return { status: 200, body: '<html><body><button data-url="https://cdn.example.invalid/wrong.mp4" data-name="Direct">Play</button></body></html>' };
    }
    return { status: 404, body: {} };
  });
  const streams = await getStreams('300147', 'movie', null, null);
  assert.deepEqual(streams, []);
});

test('manifest.json puts exact-ID providers (bingr, vidlink) before keyword-search castle', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const ids = manifest.scrapers.map((s) => s.id);
  const idxBingr = ids.indexOf('bingr');
  const idxVidlink = ids.indexOf('vidlink');
  const idxCastle = ids.indexOf('castle');
  assert.ok(idxBingr >= 0 && idxVidlink >= 0 && idxCastle >= 0);
  assert.ok(idxBingr < idxCastle, `bingr (${idxBingr}) should precede castle (${idxCastle})`);
  assert.ok(idxVidlink < idxCastle, `vidlink (${idxVidlink}) should precede castle (${idxCastle})`);
});
