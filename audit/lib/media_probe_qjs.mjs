/**
 * Pure QuickJS-compatible bounded HTTP media metadata & episode verifier.
 *
 * Uses ONLY globals present in Nuvio's QuickJS runtime (fetch, Uint8Array,
 * DataView, TextDecoder, URL, setTimeout, clearTimeout, Promise).
 * No Node built-ins (no Buffer, process, fs, http, node:*).
 * No full-file video downloads: uses HEAD + bounded byte Range requests and
 * strictly enforces byte, request, concurrency, and timeout budgets.
 */

const TEXT_DECODER = new TextDecoder("utf-8");

export const PROVENANCE = Object.freeze({
  VERIFIED: "verified",
  DECLARED: "declared",
  ESTIMATED: "estimated",
  UNKNOWN: "unknown",
});

const LANG_MAP = Object.freeze({
  hi: { code: "hi", iso639_2: "hin", name: "Hindi" },
  hin: { code: "hi", iso639_2: "hin", name: "Hindi" },
  hindi: { code: "hi", iso639_2: "hin", name: "Hindi" },
  en: { code: "en", iso639_2: "eng", name: "English" },
  eng: { code: "en", iso639_2: "eng", name: "English" },
  english: { code: "en", iso639_2: "eng", name: "English" },
  mr: { code: "mr", iso639_2: "mar", name: "Marathi" },
  mar: { code: "mr", iso639_2: "mar", name: "Marathi" },
  marathi: { code: "mr", iso639_2: "mar", name: "Marathi" },
  ta: { code: "ta", iso639_2: "tam", name: "Tamil" },
  tam: { code: "ta", iso639_2: "tam", name: "Tamil" },
  te: { code: "te", iso639_2: "tel", name: "Telugu" },
  tel: { code: "te", iso639_2: "tel", name: "Telugu" },
  ja: { code: "ja", iso639_2: "jpn", name: "Japanese" },
  jpn: { code: "ja", iso639_2: "jpn", name: "Japanese" },
  ko: { code: "ko", iso639_2: "kor", name: "Korean" },
  kor: { code: "ko", iso639_2: "kor", name: "Korean" },
});

export function normalizeLanguage(rawLang, labelHint) {
  const candidates = [rawLang, labelHint].map((v) =>
    v == null ? "" : String(v).trim()
  );
  for (const cand of candidates) {
    if (!cand) continue;
    const lower = cand.toLowerCase();
    if (lower === "und" || lower === "unk" || lower === "unknown" || lower === "none") {
      return { code: null, name: null, raw: cand, provenance: PROVENANCE.UNKNOWN };
    }
    const base = lower.split(/[-_\s,]+/)[0];
    if (LANG_MAP[base]) {
      const m = LANG_MAP[base];
      const prov = rawLang && String(rawLang).trim().toLowerCase() !== "und"
        ? PROVENANCE.VERIFIED
        : PROVENANCE.ESTIMATED;
      return { code: m.code, name: m.name, raw: cand, provenance: prov };
    }
    // Accept standard 2- or 3-letter ISO code verbatim if explicit container tag
    if (cand === rawLang && /^[a-z]{2,3}$/i.test(lower)) {
      return { code: lower, name: lower.toUpperCase(), raw: cand, provenance: PROVENANCE.VERIFIED };
    }
  }
  return { code: null, name: null, raw: rawLang || null, provenance: PROVENANCE.UNKNOWN };
}

export function field(value, provenance = PROVENANCE.UNKNOWN, source = null) {
  if (value === undefined || value === null || value === "") {
    return { value: null, provenance: PROVENANCE.UNKNOWN, source };
  }
  return { value, provenance, source };
}

export class Semaphore {
  constructor(limit = 4) {
    this.limit = Math.max(1, limit);
    this.active = 0;
    this.queue = [];
  }
  async run(fn) {
    if (this.active >= this.limit) {
      await new Promise((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next();
      }
    }
  }
}

async function timedFetch(fetchImpl, url, options, timeoutMs) {
  let timerId = null;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const fetchOpts = controller ? { ...options, signal: controller.signal } : { ...options };
  try {
    const reqPromise = fetchImpl(url, fetchOpts);
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => {
        try {
          if (controller) controller.abort();
        } catch (_) {}
        reject(new Error(`Timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    return await Promise.race([reqPromise, timeoutPromise]);
  } finally {
    if (timerId !== null) clearTimeout(timerId);
  }
}

function headerGet(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === target) return v;
  }
  return null;
}

function parseContentRange(value) {
  if (!value) return null;
  const m = String(value).match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
  if (!m) return null;
  return {
    start: Number(m[1]),
    end: Number(m[2]),
    total: m[3] === "*" ? null : Number(m[3]),
  };
}

function asciiStr(u8, start, end) {
  let s = "";
  const limit = Math.min(u8.length, end);
  for (let i = start; i < limit; i++) {
    s += String.fromCharCode(u8[i]);
  }
  return s;
}

function utf8Str(u8, start, end) {
  return TEXT_DECODER.decode(u8.subarray(start, Math.min(u8.length, end))).replace(/\0+$/, "");
}

function readU64(dv, offset) {
  const hi = dv.getUint32(offset, false);
  const lo = dv.getUint32(offset + 4, false);
  return hi * 4294967296 + lo;
}

function mapMp4Codec(fourcc) {
  const f = fourcc.toLowerCase();
  if (f === "avc1" || f === "avc3") return "h264";
  if (f === "hvc1" || f === "hev1") return "hevc";
  if (f === "av01") return "av1";
  if (f === "vp09") return "vp9";
  if (f === "mp4a") return "aac";
  if (f === "ac-3") return "ac3";
  if (f === "ec-3") return "eac3";
  if (f === "opus") return "opus";
  if (f === "tx3g") return "mov_text";
  return fourcc;
}

function unpackIso639_2T(val) {
  const code = val & 0x7fff;
  if (code === 0 || code === 0x55c4) return "und";
  const c1 = ((code >> 10) & 0x1f) + 0x60;
  const c2 = ((code >> 5) & 0x1f) + 0x60;
  const c3 = (code & 0x1f) + 0x60;
  if (c1 < 0x61 || c2 < 0x61 || c3 < 0x61 || c1 > 0x7a || c2 > 0x7a || c3 > 0x7a) {
    return "und";
  }
  return String.fromCharCode(c1, c2, c3);
}

const CONTAINER_BOXES = new Set([
  "moov", "trak", "mdia", "minf", "stbl", "udta", "edts",
]);

/**
 * Parse top-level ISOBMFF boxes from a byte slice starting at file offset `baseOffset`.
 */
export function scanMp4TopLevel(u8, baseOffset = 0) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const boxes = [];
  let pos = 0;
  while (pos + 8 <= u8.length) {
    let size = dv.getUint32(pos, false);
    const type = asciiStr(u8, pos + 4, pos + 8);
    let headerLen = 8;
    if (size === 1) {
      if (pos + 16 > u8.length) break;
      size = readU64(dv, pos + 8);
      headerLen = 16;
    } else if (size === 0) {
      boxes.push({ type, offset: baseOffset + pos, size: null, headerLen });
      break;
    }
    if (size < headerLen) break;
    boxes.push({ type, offset: baseOffset + pos, size, headerLen });
    if (pos + size > u8.length) break;
    pos += size;
  }
  return boxes;
}

/**
 * Parse a complete `moov` box buffer (`u8` starts at the `moov` box header).
 */
export function parseMp4Moov(u8, totalFileSize = null, majorBrand = null) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 8) return null;
  let rootSize = dv.getUint32(0, false);
  const rootType = asciiStr(u8, 4, 8);
  let rootStart = 8;
  if (rootSize === 1 && u8.length >= 16) {
    rootSize = readU64(dv, 8);
    rootStart = 16;
  }
  if (rootType !== "moov") return null;
  const rootEnd = Math.min(u8.length, rootSize);

  const result = {
    container: "mp4",
    majorBrand,
    durationSec: null,
    fileSizeBytes: totalFileSize,
    video: [],
    audio: [],
    subtitles: [],
    tags: {},
    truncatedMoov: u8.length < rootSize,
  };

  function parseChildren(start, end, ctx) {
    let p = start;
    while (p + 8 <= end) {
      let sz = dv.getUint32(p, false);
      const tp = asciiStr(u8, p + 4, p + 8);
      let hdr = 8;
      if (sz === 1) {
        if (p + 16 > end) break;
        sz = readU64(dv, p + 8);
        hdr = 16;
      } else if (sz === 0) {
        sz = end - p;
      }
      if (sz < hdr) break;
      const boxEnd = Math.min(end, p + sz);
      const bodyStart = p + hdr;

      if (tp === "mvhd" && bodyStart + 20 <= boxEnd) {
        const ver = u8[bodyStart];
        let timescale = 0;
        let dur = 0;
        if (ver === 1 && bodyStart + 32 <= boxEnd) {
          timescale = dv.getUint32(bodyStart + 20, false);
          dur = readU64(dv, bodyStart + 24);
        } else if (ver === 0 && bodyStart + 20 <= boxEnd) {
          timescale = dv.getUint32(bodyStart + 12, false);
          dur = dv.getUint32(bodyStart + 16, false);
        }
        if (timescale > 0 && dur > 0) {
          result.durationSec = dur / timescale;
        }
      } else if (tp === "trak") {
        const trackCtx = { handler: null, width: null, height: null, langRaw: null, title: null, codec: null, channels: null, sampleRate: null };
        parseChildren(bodyStart, boxEnd, trackCtx);
        if (trackCtx.handler === "vide") {
          result.video.push({
            codec: trackCtx.codec,
            width: trackCtx.width,
            height: trackCtx.height,
          });
        } else if (trackCtx.handler === "soun") {
          const lang = normalizeLanguage(trackCtx.langRaw, trackCtx.title);
          result.audio.push({
            codec: trackCtx.codec,
            language: lang.code,
            languageName: lang.name,
            languageRaw: trackCtx.langRaw,
            provenance: lang.provenance,
            channels: trackCtx.channels,
            sampleRate: trackCtx.sampleRate,
            title: trackCtx.title,
          });
        } else if (trackCtx.handler === "sbtl" || trackCtx.handler === "text" || trackCtx.handler === "subt") {
          const lang = normalizeLanguage(trackCtx.langRaw, trackCtx.title);
          result.subtitles.push({
            codec: trackCtx.codec,
            language: lang.code,
            languageName: lang.name,
            languageRaw: trackCtx.langRaw,
            provenance: lang.provenance,
            title: trackCtx.title,
          });
        }
      } else if (tp === "tkhd" && ctx && bodyStart + 84 <= boxEnd) {
        const ver = u8[bodyStart];
        const dimOff = ver === 1 ? bodyStart + 88 : bodyStart + 76;
        if (dimOff + 8 <= boxEnd) {
          const w = dv.getUint32(dimOff, false) >>> 16;
          const h = dv.getUint32(dimOff + 4, false) >>> 16;
          if (w > 0 && h > 0) {
            ctx.width = w;
            ctx.height = h;
          }
        }
      } else if (tp === "mdhd" && ctx && bodyStart + 24 <= boxEnd) {
        const ver = u8[bodyStart];
        const langOff = ver === 1 ? bodyStart + 32 : bodyStart + 20;
        if (langOff + 2 <= boxEnd) {
          ctx.langRaw = unpackIso639_2T(dv.getUint16(langOff, false));
        }
      } else if (tp === "hdlr" && ctx && bodyStart + 12 <= boxEnd) {
        const handler = asciiStr(u8, bodyStart + 8, bodyStart + 12);
        if (!ctx.handler) ctx.handler = handler;
      } else if (tp === "name" && ctx && bodyStart < boxEnd) {
        ctx.title = utf8Str(u8, bodyStart, boxEnd);
      } else if (tp === "stsd" && ctx && bodyStart + 16 <= boxEnd) {
        const entryCount = dv.getUint32(bodyStart + 4, false);
        if (entryCount >= 1) {
          const eStart = bodyStart + 8;
          const eSize = dv.getUint32(eStart, false);
          const fourcc = asciiStr(u8, eStart + 4, eStart + 8);
          ctx.codec = mapMp4Codec(fourcc);
          const eEnd = Math.min(boxEnd, eStart + eSize);
          if (ctx.handler === "vide" && eStart + 36 <= eEnd) {
            const w = dv.getUint16(eStart + 32, false);
            const h = dv.getUint16(eStart + 34, false);
            if (w > 0 && h > 0) {
              ctx.width = w;
              ctx.height = h;
            }
          } else if (ctx.handler === "soun" && eStart + 36 <= eEnd) {
            const ver = dv.getUint16(eStart + 16, false);
            const ch = dv.getUint16(eStart + 24, false);
            const sr = dv.getUint32(eStart + 32, false) >>> 16;
            if (ch > 0 && ch <= 16) ctx.channels = ch;
            if (sr >= 8000 && sr <= 192000) ctx.sampleRate = sr;
            if (ver === 1 && fourcc === "mp4a") ctx.codec = "aac";
          }
        }
      } else if (tp === "meta" && bodyStart + 4 <= boxEnd) {
        // FullBox: 4 bytes version/flags before children
        parseChildren(bodyStart + 4, boxEnd, ctx);
      } else if (tp === "ilst") {
        parseIlst(bodyStart, boxEnd);
      } else if (CONTAINER_BOXES.has(tp)) {
        parseChildren(bodyStart, boxEnd, ctx);
      }
      p += sz;
    }
  }

  function parseIlst(start, end) {
    let p = start;
    while (p + 8 <= end) {
      const sz = dv.getUint32(p, false);
      const rawKey = u8.subarray(p + 4, p + 8);
      const key = Array.from(rawKey, (b) =>
        b === 0xa9 ? "@" : b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "?"
      ).join("");
      if (sz < 8 || p + sz > end) break;
      const boxEnd = p + sz;
      // Scan sub-boxes for `data` or `name` (used by `----` custom tags)
      let sp = p + 8;
      let subName = null;
      let subVal = null;
      let numVal = null;
      while (sp + 8 <= boxEnd) {
        const ssz = dv.getUint32(sp, false);
        const stp = asciiStr(u8, sp + 4, sp + 8);
        if (ssz < 8 || sp + ssz > boxEnd) break;
        if (stp === "name" && sp + 12 < sp + ssz) {
          subName = utf8Str(u8, sp + 12, sp + ssz);
        } else if (stp === "data" && sp + 16 <= sp + ssz) {
          const dataType = dv.getUint32(sp + 8, false);
          if (dataType === 1) {
            subVal = utf8Str(u8, sp + 16, sp + ssz);
          } else if (dataType === 21 && sp + 18 <= sp + ssz) {
            // signed int BE
            const payloadLen = sp + ssz - (sp + 16);
            if (payloadLen >= 4) numVal = dv.getInt32(sp + 16, false);
            else if (payloadLen >= 2) numVal = dv.getInt16(sp + 16, false);
            else if (payloadLen === 1) numVal = u8[sp + 16];
          }
        }
        sp += ssz;
      }
      if (key === "@nam" && subVal) result.tags.title = subVal;
      else if (key === "tvsh" && subVal) result.tags.show = subVal;
      else if (key === "tven" && subVal) result.tags.episode_id = subVal;
      else if (key === "tvsn" && (numVal != null || subVal)) result.tags.season_number = String(numVal ?? subVal);
      else if (key === "tves" && (numVal != null || subVal)) result.tags.episode_sort = String(numVal ?? subVal);
      else if (key === "@cmt" && subVal) result.tags.comment = subVal;
      else if (key === "----" && subName && (subVal != null || numVal != null)) {
        result.tags[subName.toLowerCase()] = String(subVal ?? numVal);
      }
      p += sz;
    }
  }

  parseChildren(rootStart, rootEnd, null);
  return result;
}

/**
 * Tree-skipping HTTP Range MP4 `moov` parser:
 * Avoids downloading megabyte-sized `stbl` (`stsz`/`stco`/`stts`) sample tables inside `moov`
 * by reading only small `mvhd`, `trak` header (~4 KiB prefix per track), and `udta` slices.
 */
async function parseMp4MoovPaged(readAt, moovOffset, moovSize, rootHdrLen, totalFileSize, majorBrand) {
  const result = {
    container: "mp4",
    majorBrand,
    durationSec: null,
    fileSizeBytes: totalFileSize,
    video: [],
    audio: [],
    subtitles: [],
    tags: {},
    treeSkippedStbl: true,
  };

  function readBoxHeaderFromSlice(u8, pos) {
    if (pos + 8 > u8.length) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let sz = dv.getUint32(pos, false);
    const tp = asciiStr(u8, pos + 4, pos + 8);
    let hdr = 8;
    if (sz === 1) {
      if (pos + 16 > u8.length) return null;
      sz = readU64(dv, pos + 8);
      hdr = 16;
    }
    return { sz, tp, hdr };
  }

  function parseTrackHeaderWindow(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const ctx = { handler: null, width: null, height: null, langRaw: null, title: null, codec: null, channels: null, sampleRate: null };
    function walkWin(start, end) {
      let p = start;
      while (p + 8 <= end) {
        let sz = dv.getUint32(p, false);
        const tp = asciiStr(u8, p + 4, p + 8);
        let hdr = 8;
        if (sz === 1 && p + 16 <= end) { sz = readU64(dv, p + 8); hdr = 16; }
        else if (sz === 0) sz = end - p;
        if (sz < hdr) break;
        const bodyStart = p + hdr;
        const boxEnd = Math.min(end, p + sz);

        if (tp === "tkhd" && bodyStart + 84 <= boxEnd) {
          const ver = u8[bodyStart];
          const dimOff = ver === 1 ? bodyStart + 88 : bodyStart + 76;
          if (dimOff + 8 <= boxEnd) {
            const w = dv.getUint32(dimOff, false) >>> 16;
            const h = dv.getUint32(dimOff + 4, false) >>> 16;
            if (w > 0 && h > 0) { ctx.width = w; ctx.height = h; }
          }
        } else if (tp === "mdhd" && bodyStart + 24 <= boxEnd) {
          const ver = u8[bodyStart];
          const langOff = ver === 1 ? bodyStart + 32 : bodyStart + 20;
          if (langOff + 2 <= boxEnd) ctx.langRaw = unpackIso639_2T(dv.getUint16(langOff, false));
        } else if (tp === "hdlr" && bodyStart + 12 <= boxEnd) {
          const h = asciiStr(u8, bodyStart + 8, bodyStart + 12);
          if (!ctx.handler) ctx.handler = h;
        } else if (tp === "stsd" && bodyStart + 16 <= boxEnd) {
          const entryCount = dv.getUint32(bodyStart + 4, false);
          if (entryCount >= 1) {
            const eStart = bodyStart + 8;
            const eSize = dv.getUint32(eStart, false);
            const fourcc = asciiStr(u8, eStart + 4, eStart + 8);
            ctx.codec = mapMp4Codec(fourcc);
            const eEnd = Math.min(boxEnd, eStart + eSize);
            if (ctx.handler === "vide" && eStart + 36 <= eEnd) {
              const w = dv.getUint16(eStart + 32, false);
              const h = dv.getUint16(eStart + 34, false);
              if (w > 0 && h > 0) { ctx.width = w; ctx.height = h; }
            } else if (ctx.handler === "soun" && eStart + 36 <= eEnd) {
              const ch = dv.getUint16(eStart + 24, false);
              const sr = dv.getUint32(eStart + 32, false) >>> 16;
              if (ch > 0 && ch <= 16) ctx.channels = ch;
              if (sr >= 8000 && sr <= 192000) ctx.sampleRate = sr;
            }
          }
        } else if (tp === "mdia" || tp === "minf" || tp === "stbl") {
          // Walk inside even if `stbl` extends past our 4 KiB window; `stsd` is at the front of `stbl`.
          walkWin(bodyStart, boxEnd);
        }
        p += sz;
      }
    }
    const topHdr = readBoxHeaderFromSlice(u8, 0);
    if (topHdr && topHdr.tp === "trak") {
      walkWin(topHdr.hdr, Math.min(u8.length, topHdr.sz));
    }
    return ctx;
  }

  let cursor = moovOffset + rootHdrLen;
  const moovEnd = moovOffset + moovSize;
  while (cursor + 8 <= moovEnd) {
    const hdrBuf = await readAt(cursor, 16);
    if (!hdrBuf || hdrBuf.length < 8) break;
    const h = readBoxHeaderFromSlice(hdrBuf, 0);
    if (!h || h.sz < h.hdr) break;

    if (h.tp === "mvhd" && h.sz <= 256) {
      const mvhdSlice = await readAt(cursor, h.sz);
      const dv = new DataView(mvhdSlice.buffer, mvhdSlice.byteOffset, mvhdSlice.byteLength);
      const bodyStart = h.hdr;
      const ver = mvhdSlice[bodyStart];
      let timescale = 0;
      let dur = 0;
      if (ver === 1 && bodyStart + 32 <= mvhdSlice.length) {
        timescale = dv.getUint32(bodyStart + 20, false);
        dur = readU64(dv, bodyStart + 24);
      } else if (ver === 0 && bodyStart + 20 <= mvhdSlice.length) {
        timescale = dv.getUint32(bodyStart + 12, false);
        dur = dv.getUint32(bodyStart + 16, false);
      }
      if (timescale > 0 && dur > 0) result.durationSec = dur / timescale;
    } else if (h.tp === "trak") {
      const want = Math.min(h.sz, 4096);
      const trSlice = await readAt(cursor, want);
      const trackCtx = parseTrackHeaderWindow(trSlice);
      if (trackCtx.handler === "vide") {
        result.video.push({ codec: trackCtx.codec, width: trackCtx.width, height: trackCtx.height });
      } else if (trackCtx.handler === "soun") {
        const lang = normalizeLanguage(trackCtx.langRaw, trackCtx.title);
        result.audio.push({
          codec: trackCtx.codec,
          language: lang.code,
          languageName: lang.name,
          languageRaw: trackCtx.langRaw,
          provenance: lang.provenance,
          channels: trackCtx.channels,
          sampleRate: trackCtx.sampleRate,
          title: trackCtx.title,
        });
      } else if (trackCtx.handler === "sbtl" || trackCtx.handler === "text" || trackCtx.handler === "subt") {
        const lang = normalizeLanguage(trackCtx.langRaw, trackCtx.title);
        result.subtitles.push({
          codec: trackCtx.codec,
          language: lang.code,
          languageName: lang.name,
          languageRaw: trackCtx.langRaw,
          provenance: lang.provenance,
          title: trackCtx.title,
        });
      }
    } else if (h.tp === "udta") {
      // Wrap in synthetic minimal `moov` header to reuse parseMp4Moov's `udta->meta->ilst` parser
      const want = Math.min(h.sz, 16384);
      const uSlice = await readAt(cursor, want);
      const wrapped = new Uint8Array(8 + uSlice.length);
      const wdv = new DataView(wrapped.buffer);
      wdv.setUint32(0, wrapped.length, false);
      wrapped[4] = 0x6d; wrapped[5] = 0x6f; wrapped[6] = 0x6f; wrapped[7] = 0x76; // "moov"
      wrapped.set(uSlice, 8);
      const parsedUdta = parseMp4Moov(wrapped, totalFileSize, majorBrand);
      if (parsedUdta && parsedUdta.tags) {
        result.tags = { ...result.tags, ...parsedUdta.tags };
      }
    }
    cursor += h.sz;
  }
  return result;
}

// ---------------- MKV / EBML PARSER ----------------

function readEbmlVintId(u8, pos, end) {
  if (pos >= end) return null;
  const first = u8[pos];
  if (first === 0) return null;
  let len = 1;
  let mask = 0x80;
  while (len <= 4 && (first & mask) === 0) {
    mask >>= 1;
    len++;
  }
  if (len > 4 || pos + len > end) return null;
  let id = 0;
  for (let i = 0; i < len; i++) {
    id = id * 256 + u8[pos + i];
  }
  return { id, len };
}

function readEbmlVintSize(u8, pos, end) {
  if (pos >= end) return null;
  const first = u8[pos];
  if (first === 0) return null;
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && (first & mask) === 0) {
    mask >>= 1;
    len++;
  }
  if (len > 8 || pos + len > end) return null;
  let val = first & (mask - 1);
  let allOnes = val === mask - 1;
  for (let i = 1; i < len; i++) {
    val = val * 256 + u8[pos + i];
    if (u8[pos + i] !== 0xff) allOnes = false;
  }
  return { size: allOnes ? null : val, len };
}

function readEbmlUint(u8, start, end) {
  let v = 0;
  for (let i = start; i < end; i++) v = v * 256 + u8[i];
  return v;
}

function readEbmlFloat(dv, start, len) {
  if (len === 4) return dv.getFloat32(start, false);
  if (len === 8) return dv.getFloat64(start, false);
  return null;
}

function mapMkvCodec(codecId) {
  if (!codecId) return null;
  const c = codecId.toUpperCase();
  if (c.includes("MPEG4/ISO/AVC")) return "h264";
  if (c.includes("MPEGH/ISO/HEVC")) return "hevc";
  if (c === "V_AV1") return "av1";
  if (c === "V_VP9") return "vp9";
  if (c.startsWith("A_AAC")) return "aac";
  if (c === "A_AC3") return "ac3";
  if (c === "A_EAC3") return "eac3";
  if (c === "A_OPUS") return "opus";
  if (c === "A_DTS") return "dts";
  if (c === "A_TRUEHD") return "truehd";
  if (c === "A_FLAC") return "flac";
  if (c === "S_TEXT/UTF8") return "subrip";
  if (c === "S_TEXT/ASS" || c === "S_TEXT/SSA") return "ass";
  if (c === "S_HDMV/PGS") return "pgs";
  return codecId;
}

export function parseMkvChunk(u8, totalFileSize = null) {
  if (u8.length < 4 || u8[0] !== 0x1a || u8[1] !== 0x45 || u8[2] !== 0xdf || u8[3] !== 0xa3) {
    return null;
  }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const res = {
    container: "matroska",
    docType: null,
    durationSec: null,
    timecodeScaleNs: 1000000,
    rawDurationUnits: null,
    fileSizeBytes: totalFileSize,
    video: [],
    audio: [],
    subtitles: [],
    tags: {},
    seekPositions: {}, // element hex id -> segment-relative file offset
    segmentDataOffset: null,
  };

  function walkElements(start, end, cb) {
    let p = start;
    while (p < end) {
      const idObj = readEbmlVintId(u8, p, end);
      if (!idObj) break;
      const szObj = readEbmlVintSize(u8, p + idObj.len, end);
      if (!szObj) break;
      const valStart = p + idObj.len + szObj.len;
      const valEnd = szObj.size === null ? end : Math.min(end, valStart + szObj.size);
      const isTruncated = szObj.size !== null && valStart + szObj.size > end;
      cb(idObj.id, valStart, valEnd, isTruncated);
      if (szObj.size === null || valStart + szObj.size > end) break;
      p = valStart + szObj.size;
    }
  }

  function parseTrackEntry(start, end) {
    const t = {
      type: null,
      codecId: null,
      name: null,
      lang: null,
      langBcp47: null,
      width: null,
      height: null,
      channels: null,
      sampleRate: null,
    };
    walkElements(start, end, (id, s, e) => {
      if (id === 0x83) t.type = readEbmlUint(u8, s, e);
      else if (id === 0x86) t.codecId = utf8Str(u8, s, e);
      else if (id === 0x536e) t.name = utf8Str(u8, s, e);
      else if (id === 0x22b59c) t.lang = utf8Str(u8, s, e);
      else if (id === 0x22b59d) t.langBcp47 = utf8Str(u8, s, e);
      else if (id === 0xe0) {
        walkElements(s, e, (vidId, vs, ve) => {
          if (vidId === 0xb0) t.width = readEbmlUint(u8, vs, ve);
          else if (vidId === 0xba) t.height = readEbmlUint(u8, vs, ve);
        });
      } else if (id === 0xe1) {
        walkElements(s, e, (audId, as, ae) => {
          if (audId === 0x9f) t.channels = readEbmlUint(u8, as, ae);
          else if (audId === 0xb5) t.sampleRate = readEbmlFloat(dv, as, ae - as);
        });
      }
    });
    const codec = mapMkvCodec(t.codecId);
    if (t.type === 1) {
      res.video.push({ codec, width: t.width, height: t.height });
    } else if (t.type === 2) {
      const langRaw = t.langBcp47 || t.lang || null;
      const lang = normalizeLanguage(langRaw, t.name);
      res.audio.push({
        codec,
        language: lang.code,
        languageName: lang.name,
        languageRaw: langRaw,
        provenance: lang.provenance,
        channels: t.channels,
        sampleRate: t.sampleRate ? Math.round(t.sampleRate) : null,
        title: t.name,
      });
    } else if (t.type === 17) {
      const langRaw = t.langBcp47 || t.lang || null;
      const lang = normalizeLanguage(langRaw, t.name);
      res.subtitles.push({
        codec,
        language: lang.code,
        languageName: lang.name,
        languageRaw: langRaw,
        provenance: lang.provenance,
        title: t.name,
      });
    }
  }

  function parseSimpleTags(start, end) {
    walkElements(start, end, (id, s, e) => {
      if (id === 0x67c8) {
        let name = null;
        let val = null;
        walkElements(s, e, (sid, ss, se) => {
          if (sid === 0x45a3) name = utf8Str(u8, ss, se);
          else if (sid === 0x4487) val = utf8Str(u8, ss, se);
          else if (sid === 0x67c8) parseSimpleTags(ss, se);
        });
        if (name && val !== null) {
          res.tags[name.toLowerCase()] = val;
        }
      }
    });
  }

  walkElements(0, u8.length, (id, s, e) => {
    if (id === 0x1a45dfa3) {
      walkElements(s, e, (eid, es, ee) => {
        if (eid === 0x4282) {
          res.docType = utf8Str(u8, es, ee);
          if (res.docType === "webm") res.container = "webm";
        }
      });
    } else if (id === 0x18538067) {
      res.segmentDataOffset = s;
      walkElements(s, e, (sid, ss, se) => {
        if (sid === 0x114d9b74) {
          // SeekHead
          walkElements(ss, se, (skId, sks, ske) => {
            if (skId === 0x4dbb) {
              let seekIdHex = null;
              let seekPos = null;
              walkElements(sks, ske, (fId, fs, fe) => {
                if (fId === 0x53ab) seekIdHex = readEbmlUint(u8, fs, fe).toString(16);
                else if (fId === 0x53ac) seekPos = readEbmlUint(u8, fs, fe);
              });
              if (seekIdHex && seekPos !== null) {
                res.seekPositions[seekIdHex] = s + seekPos;
              }
            }
          });
        } else if (sid === 0x1549a966) {
          // Info
          walkElements(ss, se, (iId, is, ie) => {
            if (iId === 0x2ad7b1) res.timecodeScaleNs = readEbmlUint(u8, is, ie);
            else if (iId === 0x4489) res.rawDurationUnits = readEbmlFloat(dv, is, ie - is);
            else if (iId === 0x7ba9) res.tags.title = utf8Str(u8, is, ie);
          });
          if (res.rawDurationUnits !== null) {
            res.durationSec = (res.rawDurationUnits * res.timecodeScaleNs) / 1e9;
          }
        } else if (sid === 0x1654ae6b) {
          // Tracks
          walkElements(ss, se, (trId, trs, tre) => {
            if (trId === 0xae) parseTrackEntry(trs, tre);
          });
        } else if (sid === 0x1254c367) {
          // Tags
          walkElements(ss, se, (tId, ts, te) => {
            if (tId === 0x7373) parseSimpleTags(ts, te);
          });
        }
      });
    }
  });
  return res;
}

export function parseMkvTagsSlice(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  void dv;
  const tags = {};
  function walk(start, end, cb) {
    let p = start;
    while (p < end) {
      const idObj = readEbmlVintId(u8, p, end);
      if (!idObj) break;
      const szObj = readEbmlVintSize(u8, p + idObj.len, end);
      if (!szObj) break;
      const vs = p + idObj.len + szObj.len;
      const ve = szObj.size === null ? end : Math.min(end, vs + szObj.size);
      cb(idObj.id, vs, ve);
      if (szObj.size === null || vs + szObj.size > end) break;
      p = vs + szObj.size;
    }
  }
  function parseTag(start, end) {
    walk(start, end, (id, s, e) => {
      if (id === 0x67c8) {
        let k = null;
        let v = null;
        walk(s, e, (sid, ss, se) => {
          if (sid === 0x45a3) k = utf8Str(u8, ss, se);
          else if (sid === 0x4487) v = utf8Str(u8, ss, se);
          else if (sid === 0x67c8) parseTag(ss, se);
        });
        if (k && v !== null) tags[k.toLowerCase()] = v;
      }
    });
  }
  walk(0, u8.length, (id, s, e) => {
    if (id === 0x1254c367) {
      walk(s, e, (tid, ts, te) => {
        if (tid === 0x7373) parseTag(ts, te);
      });
    }
  });
  return tags;
}

// ---------------- HLS M3U8 PARSER ----------------

function parseAttrList(line) {
  const attrs = {};
  const re = /([A-Z0-9-]+)=("([^"]*)"|([^,]*))/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    attrs[m[1]] = m[3] !== undefined ? m[3] : m[4];
  }
  return attrs;
}

function mapHlsCodecs(codecsStr) {
  if (!codecsStr) return { videoCodec: null, audioCodec: null };
  let videoCodec = null;
  let audioCodec = null;
  for (const raw of codecsStr.split(",")) {
    const c = raw.trim().toLowerCase();
    if (!c) continue;
    if (c.startsWith("avc1") || c.startsWith("avc3")) videoCodec = "h264";
    else if (c.startsWith("hvc1") || c.startsWith("hev1")) videoCodec = "hevc";
    else if (c.startsWith("av01")) videoCodec = "av1";
    else if (c.startsWith("vp09") || c.startsWith("vp9")) videoCodec = "vp9";
    else if (c.startsWith("mp4a")) audioCodec = "aac";
    else if (c.startsWith("ac-3")) audioCodec = "ac3";
    else if (c.startsWith("ec-3")) audioCodec = "eac3";
    else if (c.startsWith("opus")) audioCodec = "opus";
  }
  return { videoCodec, audioCodec };
}

export function parseHlsMasterOrMedia(text, baseUrl) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || !lines[0].startsWith("#EXTM3U")) return null;

  const isMaster = lines.some((l) => l.startsWith("#EXT-X-STREAM-INF:") || l.startsWith("#EXT-X-MEDIA:"));
  if (!isMaster) {
    let durationSec = 0;
    let segments = 0;
    for (const line of lines) {
      if (line.startsWith("#EXTINF:")) {
        const num = parseFloat(line.slice(8).split(",")[0]);
        if (Number.isFinite(num)) {
          durationSec += num;
          segments++;
        }
      }
    }
    const hasEndList = lines.some((l) => l.startsWith("#EXT-X-ENDLIST"));
    return {
      container: "hls",
      playlistKind: "media",
      durationSec: segments > 0 ? durationSec : null,
      durationProvenance: hasEndList && segments > 0 ? PROVENANCE.VERIFIED : segments > 0 ? PROVENANCE.ESTIMATED : PROVENANCE.UNKNOWN,
      segments,
      hasEndList,
      video: [],
      audio: [],
      subtitles: [],
      variants: [],
      firstVariantUrl: null,
    };
  }

  const audio = [];
  const subtitles = [];
  const variants = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const a = parseAttrList(line.slice("#EXT-X-MEDIA:".length));
      if (a.TYPE === "AUDIO") {
        const lang = normalizeLanguage(a.LANGUAGE || null, a.NAME || null);
        audio.push({
          groupId: a["GROUP-ID"] || null,
          codec: null,
          language: lang.code,
          languageName: lang.name,
          languageRaw: a.LANGUAGE || null,
          provenance: a.LANGUAGE ? lang.provenance : PROVENANCE.UNKNOWN,
          channels: a.CHANNELS ? parseInt(a.CHANNELS, 10) || null : null,
          title: a.NAME || null,
          isDefault: a.DEFAULT === "YES",
          uri: a.URI ? new URL(a.URI, baseUrl).toString() : null,
        });
      } else if (a.TYPE === "SUBTITLES") {
        const lang = normalizeLanguage(a.LANGUAGE || null, a.NAME || null);
        subtitles.push({
          groupId: a["GROUP-ID"] || null,
          codec: "webvtt",
          language: lang.code,
          languageName: lang.name,
          languageRaw: a.LANGUAGE || null,
          provenance: a.LANGUAGE ? lang.provenance : PROVENANCE.UNKNOWN,
          title: a.NAME || null,
          uri: a.URI ? new URL(a.URI, baseUrl).toString() : null,
        });
      }
    } else if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const a = parseAttrList(line.slice("#EXT-X-STREAM-INF:".length));
      let nextUri = null;
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].startsWith("#")) {
          nextUri = new URL(lines[j], baseUrl).toString();
          break;
        }
      }
      let width = null;
      let height = null;
      if (a.RESOLUTION && /^\d+x\d+$/i.test(a.RESOLUTION)) {
        const parts = a.RESOLUTION.toLowerCase().split("x");
        width = Number(parts[0]);
        height = Number(parts[1]);
      }
      const { videoCodec, audioCodec } = mapHlsCodecs(a.CODECS);
      variants.push({
        bandwidth: a.BANDWIDTH ? Number(a.BANDWIDTH) : null,
        width,
        height,
        videoCodec,
        audioCodec,
        audioGroup: a.AUDIO || null,
        subtitlesGroup: a.SUBTITLES || null,
        uri: nextUri,
      });
    }
  }

  variants.sort((x, y) => (y.height || 0) - (x.height || 0) || (y.bandwidth || 0) - (x.bandwidth || 0));
  const best = variants[0] || null;
  if (best && best.audioCodec) {
    if (audio.length > 0) {
      for (const tr of audio) {
        if (!tr.codec) tr.codec = best.audioCodec;
      }
    } else {
      // Variant CODECS declares muxed audio inside TS/fMP4 without EXT-X-MEDIA LANGUAGE tags
      audio.push({
        groupId: null,
        codec: best.audioCodec,
        language: null,
        languageName: null,
        languageRaw: null,
        provenance: PROVENANCE.UNKNOWN,
        channels: null,
        title: "Muxed in variant (unlabelled)",
        isDefault: true,
        uri: null,
        muxedInVariant: true,
      });
    }
  }

  return {
    container: "hls",
    playlistKind: "master",
    durationSec: null,
    durationProvenance: PROVENANCE.UNKNOWN,
    video: best ? [{ codec: best.videoCodec, width: best.width, height: best.height }] : [],
    audio,
    subtitles,
    variants,
    firstVariantUrl: best ? best.uri : null,
  };
}

// ---------------- BOUNDED HTTP PROBING ----------------

/**
 * Inspect a media stream URL inside strict byte, request, and timeout limits.
 */
export async function probeMediaUrl(url, opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const headers = opts.headers || {};
  const initialRangeBytes = opts.initialRangeBytes ?? 16384;
  const tailRangeBytes = opts.tailRangeBytes ?? 32768;
  const maxTotalBytes = opts.maxTotalBytes ?? 262144;
  const maxRequests = opts.maxRequests ?? 12;
  const timeoutMs = opts.timeoutMs ?? 4000;

  let bytesTransferred = 0;
  let requestCount = 0;
  const tStart = Date.now();

  async function doFetch(targetUrl, method, extraHeaders = {}) {
    if (requestCount >= maxRequests) {
      throw new Error("Request budget exceeded");
    }
    requestCount++;
    const reqHeaders = { ...headers, ...extraHeaders };
    const res = await timedFetch(fetchImpl, targetUrl, { method, headers: reqHeaders }, timeoutMs);
    const cr = parseContentRange(headerGet(res.headers, "content-range"));
    const cl = headerGet(res.headers, "content-length");
    const ct = (headerGet(res.headers, "content-type") || "").toLowerCase();
    let bytes = null;
    let text = null;
    if (method !== "HEAD") {
      const ab = await res.arrayBuffer();
      bytes = new Uint8Array(ab);
      bytesTransferred += bytes.length;
      if (ct.includes("mpegurl") || ct.includes("text") || targetUrl.toLowerCase().includes(".m3u8")) {
        text = TEXT_DECODER.decode(bytes);
      }
    }
    return {
      status: res.status,
      url: res.url || targetUrl,
      contentRange: cr,
      contentLength: cl !== null && /^\d+$/.test(String(cl)) ? Number(cl) : null,
      acceptRanges: (headerGet(res.headers, "accept-ranges") || "").toLowerCase(),
      contentType: ct,
      bytes,
      text,
    };
  }

  const isLikelyM3u8 = /\.m3u8(\?|$)/i.test(url);
  let measured = null;
  let probeStatus = "ok";
  let error = null;

  try {
    if (isLikelyM3u8) {
      const masterRes = await doFetch(url, "GET");
      if (masterRes.status >= 400 || !masterRes.text) {
        throw new Error(`HTTP ${masterRes.status} on m3u8`);
      }
      measured = parseHlsMasterOrMedia(masterRes.text, masterRes.url || url);
      if (measured && measured.firstVariantUrl && bytesTransferred < maxTotalBytes && requestCount < maxRequests) {
        const varRes = await doFetch(measured.firstVariantUrl, "GET");
        if (varRes.status < 400 && varRes.text) {
          const mediaParsed = parseHlsMasterOrMedia(varRes.text, varRes.url || measured.firstVariantUrl);
          if (mediaParsed && mediaParsed.durationSec !== null) {
            measured.durationSec = mediaParsed.durationSec;
            measured.durationProvenance = mediaParsed.durationProvenance;
            measured.segments = mediaParsed.segments;
          }
        }
      }
    } else {
      // Head-free vs Range-first? Wait: HEAD first avoids downloading huge payloads if Range isn't supported.
      const headRes = await doFetch(url, "HEAD");
      const totalSize = headRes.contentLength;
      if (headRes.status >= 400) {
        throw new Error(`HTTP ${headRes.status} on HEAD`);
      }
      if (headRes.contentType.includes("mpegurl")) {
        const mRes = await doFetch(url, "GET");
        measured = parseHlsMasterOrMedia(mRes.text || TEXT_DECODER.decode(mRes.bytes || new Uint8Array()), url);
        if (measured && measured.firstVariantUrl && requestCount < maxRequests) {
          const vRes = await doFetch(measured.firstVariantUrl, "GET");
          const mediaParsed = parseHlsMasterOrMedia(vRes.text || "", measured.firstVariantUrl);
          if (mediaParsed) {
            measured.durationSec = mediaParsed.durationSec;
            measured.durationProvenance = mediaParsed.durationProvenance;
          }
        }
      } else if (headRes.acceptRanges === "none" && totalSize && totalSize > maxTotalBytes) {
        probeStatus = "range_unsupported_skipped";
        measured = {
          container: null,
          durationSec: null,
          fileSizeBytes: totalSize,
          video: [],
          audio: [],
          subtitles: [],
          tags: {},
        };
      } else {
        const rangeEnd = Math.min(
          initialRangeBytes - 1,
          totalSize ? totalSize - 1 : initialRangeBytes - 1
        );
        const r1 = await doFetch(url, "GET", { Range: `bytes=0-${rangeEnd}` });
        if (r1.status === 200 && r1.bytes && r1.bytes.length > maxTotalBytes) {
          // Host ignored Range and sent full payload > budget; truncate in memory and mark bounded
          r1.bytes = r1.bytes.subarray(0, initialRangeBytes);
        }
        const knownTotal = (r1.contentRange && r1.contentRange.total) || totalSize || null;
        const headBytes = r1.bytes || new Uint8Array(0);
        const headAscii = asciiStr(headBytes, 0, Math.min(8, headBytes.length));

        if (headAscii.startsWith("#EXTM3U")) {
          const mTxt = TEXT_DECODER.decode(headBytes);
          measured = parseHlsMasterOrMedia(mTxt, url);
        } else if (headBytes.length >= 8 && asciiStr(headBytes, 4, 8) === "ftyp") {
          const majorBrand = asciiStr(headBytes, 8, 12).trim();
          const slices = [{ start: 0, bytes: headBytes }];
          const readAt = async (offset, minLen) => {
            for (const s of slices) {
              if (offset >= s.start && offset + minLen <= s.start + s.bytes.length) {
                const rel = offset - s.start;
                return s.bytes.subarray(rel, rel + minLen);
              }
            }
            const fetchLen = Math.max(minLen, 16384);
            const maxAllowed = Math.min(
              fetchLen,
              maxTotalBytes - bytesTransferred,
              knownTotal ? Math.max(0, knownTotal - offset) : fetchLen
            );
            if (maxAllowed < 8 || requestCount >= maxRequests) return new Uint8Array(0);
            const r = await doFetch(url, "GET", { Range: `bytes=${offset}-${offset + maxAllowed - 1}` });
            const chunk = r.bytes || new Uint8Array(0);
            slices.push({ start: offset, bytes: chunk });
            return chunk.subarray(0, Math.min(chunk.length, minLen));
          };

          const boxes = scanMp4TopLevel(headBytes, 0);
          let moovBox = boxes.find((b) => b.type === "moov");
          if (!moovBox && knownTotal) {
            // Walk remaining top-level boxes via exact `offset + size` jumps (avoids scanning mdat)
            let last = boxes[boxes.length - 1];
            let hop = 0;
            while (!moovBox && last && last.size !== null && hop < 4 && bytesTransferred < maxTotalBytes && requestCount < maxRequests) {
              hop++;
              const nextOff = last.offset + last.size;
              if (nextOff >= knownTotal) break;
              const nextSlice = await readAt(nextOff, 16384);
              if (nextSlice.length < 8) break;
              const nextBoxes = scanMp4TopLevel(nextSlice, nextOff);
              moovBox = nextBoxes.find((b) => b.type === "moov");
              if (!moovBox && nextBoxes.length > 0) {
                last = nextBoxes[nextBoxes.length - 1];
              } else {
                break;
              }
            }
          }

          if (moovBox && moovBox.size !== null) {
            const moovOff = moovBox.offset;
            const moovHdr = moovBox.headerLen || 8;
            if (moovBox.size <= 49152) {
              const fullMoov = await readAt(moovOff, moovBox.size);
              if (fullMoov.length >= 8) {
                measured = parseMp4Moov(fullMoov, knownTotal, majorBrand);
              }
            } else {
              measured = await parseMp4MoovPaged(readAt, moovOff, moovBox.size, moovHdr, knownTotal, majorBrand);
            }
          }

          if (!measured && knownTotal && bytesTransferred < maxTotalBytes && requestCount < maxRequests) {
            const probeStart = Math.max(0, knownTotal - Math.min(tailRangeBytes, maxTotalBytes - bytesTransferred));
            const rTail = await doFetch(url, "GET", { Range: `bytes=${probeStart}-${knownTotal - 1}` });
            const tailBoxes = scanMp4TopLevel(rTail.bytes, probeStart);
            const tailMoov = tailBoxes.find((b) => b.type === "moov");
            if (tailMoov) {
              const relStart = tailMoov.offset - probeStart;
              const relEnd = tailMoov.size ? Math.min(rTail.bytes.length, relStart + tailMoov.size) : rTail.bytes.length;
              measured = parseMp4Moov(rTail.bytes.subarray(relStart, relEnd), knownTotal, majorBrand);
            } else {
              measured = { container: "mp4", majorBrand, durationSec: null, fileSizeBytes: knownTotal, video: [], audio: [], subtitles: [], tags: {}, moovNotFound: true };
            }
          }
        } else if (headBytes.length >= 4 && headBytes[0] === 0x1a && headBytes[1] === 0x45 && headBytes[2] === 0xdf && headBytes[3] === 0xa3) {
          // Ensure MKV reads up to 64 KiB if initial 16 KiB truncated Tracks/Info
          let mkvBytes = headBytes;
          measured = parseMkvChunk(mkvBytes, knownTotal);
          if ((!measured || !measured.durationSec || measured.audio.length === 0) && bytesTransferred < maxTotalBytes && requestCount < maxRequests) {
            const moreEnd = Math.min(65535, knownTotal ? knownTotal - 1 : 65535);
            if (moreEnd > mkvBytes.length - 1) {
              const rMore = await doFetch(url, "GET", { Range: `bytes=0-${moreEnd}` });
              if (rMore.bytes && rMore.bytes.length > mkvBytes.length) {
                mkvBytes = rMore.bytes;
                measured = parseMkvChunk(mkvBytes, knownTotal);
              }
            }
          }
          // Fetch EBML Tags if SeekHead points to `1254c367` beyond chunk and budget permits
          const tagsPos = measured && measured.seekPositions && measured.seekPositions["1254c367"];
          if (tagsPos && tagsPos >= mkvBytes.length && knownTotal && bytesTransferred < maxTotalBytes && requestCount < maxRequests) {
            const readLen = Math.min(16384, knownTotal - tagsPos, maxTotalBytes - bytesTransferred);
            if (readLen > 16) {
              const rTags = await doFetch(url, "GET", { Range: `bytes=${tagsPos}-${tagsPos + readLen - 1}` });
              const parsedTags = parseMkvTagsSlice(rTags.bytes);
              measured.tags = { ...measured.tags, ...parsedTags };
            }
          }
        } else {
          probeStatus = "unrecognized_header";
          measured = { container: null, durationSec: null, fileSizeBytes: knownTotal, video: [], audio: [], subtitles: [], tags: {} };
        }
      }
    }
  } catch (err) {
    probeStatus = "error";
    error = err && err.message ? err.message : String(err);
  }

  return {
    probeStatus,
    error,
    elapsedMs: Date.now() - tStart,
    bytesTransferred,
    requestCount,
    measured,
  };
}

// ---------------- PROVENANCE & EPISODE VERIFICATION ----------------

export function parseSeasonEpisodeTokens(text) {
  if (!text) return { season: null, episode: null, isTrailer: false };
  const s = String(text);
  const isTrailer = /\b(trailer|teaser|promo|preview|sample|featurette|clip)\b/i.test(s);
  let season = null;
  let episode = null;
  let m = s.match(/\bS(\d{1,2})\s*[.\-_ ]?E(\d{1,3})\b/i);
  if (m) {
    season = Number(m[1]);
    episode = Number(m[2]);
  } else if ((m = s.match(/\b(\d{1,2})x(\d{1,3})\b/i))) {
    season = Number(m[1]);
    episode = Number(m[2]);
  } else if ((m = s.match(/\bSeason\s*(\d{1,2})\b.*?\bEpisode\s*(\d{1,3})\b/i))) {
    season = Number(m[1]);
    episode = Number(m[2]);
  }
  return { season, episode, isTrailer };
}

export function extractContentIds(text) {
  if (!text) return { imdbId: null, tmdbId: null, tvdbId: null };
  const s = String(text);
  const imdb = s.match(/\b(tt\d{6,9})\b/i);
  const tmdb = s.match(/\btmdb[:=_-]?(\d{2,9})\b/i);
  const tvdb = s.match(/\btvdb[:=_-]?(\d{2,9})\b/i);
  return {
    imdbId: imdb ? imdb[1].toLowerCase() : null,
    tmdbId: tmdb ? tmdb[1] : null,
    tvdbId: tvdb ? tvdb[1] : null,
  };
}

export function buildAuditedStreamMetadata(declaredStream, probeResult, requestContext = {}) {
  const m = probeResult && probeResult.measured ? probeResult.measured : null;
  const bestVid = m && m.video && m.video[0] ? m.video[0] : null;
  const urlBasename = (() => {
    try {
      const p = new URL(declaredStream.url).pathname;
      return decodeURIComponent(p.split("/").pop() || "");
    } catch (_) {
      return "";
    }
  })();

  // Resolution
  const resolution = bestVid && bestVid.height
    ? field(`${bestVid.width}x${bestVid.height}`, PROVENANCE.VERIFIED, "container")
    : declaredStream.quality
      ? field(String(declaredStream.quality), PROVENANCE.DECLARED, "provider")
      : field(null, PROVENANCE.UNKNOWN);

  // Codecs
  const videoCodec = bestVid && bestVid.codec
    ? field(bestVid.codec, PROVENANCE.VERIFIED, "container")
    : field(null, PROVENANCE.UNKNOWN);

  const measuredAudioCodecs = m && m.audio ? Array.from(new Set(m.audio.map((a) => a.codec).filter(Boolean))) : [];
  const audioCodecs = measuredAudioCodecs.length > 0
    ? field(measuredAudioCodecs, PROVENANCE.VERIFIED, "container")
    : field(null, PROVENANCE.UNKNOWN);

  // Container format
  const containerFormat = m && m.container
    ? field(m.container, PROVENANCE.VERIFIED, "container")
    : declaredStream.format || declaredStream.type
      ? field(String(declaredStream.format || declaredStream.type), PROVENANCE.DECLARED, "provider")
      : field(null, PROVENANCE.UNKNOWN);

  // File size
  const fileSizeBytes = m && typeof m.fileSizeBytes === "number" && m.fileSizeBytes > 0
    ? field(m.fileSizeBytes, PROVENANCE.VERIFIED, "http_header")
    : declaredStream.size
      ? field(declaredStream.size, PROVENANCE.DECLARED, "provider")
      : field(null, PROVENANCE.UNKNOWN);

  // Duration
  const durationSec = m && typeof m.durationSec === "number" && m.durationSec > 0
    ? field(Number(m.durationSec.toFixed(2)), m.durationProvenance || PROVENANCE.VERIFIED, "container")
    : declaredStream.duration
      ? field(declaredStream.duration, PROVENANCE.DECLARED, "provider")
      : field(null, PROVENANCE.UNKNOWN);

  // Audio tracks
  const audioTracks = m && m.audio && m.audio.length > 0
    ? m.audio.map((tr, i) => ({
      index: i,
      language: tr.language,
      languageName: tr.languageName,
      raw: tr.languageRaw,
      codec: tr.codec,
      channels: tr.channels,
      title: tr.title,
      provenance: tr.language ? tr.provenance : PROVENANCE.UNKNOWN,
    }))
    : declaredStream.language
      ? [{
        index: 0,
        language: normalizeLanguage(declaredStream.language, null).code,
        languageName: normalizeLanguage(declaredStream.language, null).name,
        raw: declaredStream.language,
        codec: null,
        channels: null,
        title: null,
        provenance: normalizeLanguage(declaredStream.language, null).code ? PROVENANCE.DECLARED : PROVENANCE.UNKNOWN,
      }]
      : [];

  // Subtitle tracks (merged verified container + declared provider subtitles)
  const subtitleTracks = [];
  if (m && m.subtitles) {
    for (const s of m.subtitles) {
      subtitleTracks.push({
        language: s.language,
        languageName: s.languageName,
        raw: s.languageRaw,
        codec: s.codec,
        title: s.title,
        provenance: s.language ? s.provenance : PROVENANCE.UNKNOWN,
        source: "container",
      });
    }
  }
  if (Array.isArray(declaredStream.subtitles)) {
    for (const s of declaredStream.subtitles) {
      const lang = normalizeLanguage(s.language || s.lang, s.name);
      subtitleTracks.push({
        language: lang.code,
        languageName: lang.name,
        raw: s.language || s.lang || null,
        codec: "external",
        title: s.name || null,
        provenance: lang.code ? PROVENANCE.DECLARED : PROVENANCE.UNKNOWN,
        source: "provider_sidecar",
      });
    }
  }

  // Episode verification
  const verification = verifyEpisodeIdentity(declaredStream, m, urlBasename, requestContext);

  return {
    technical: {
      resolution,
      videoCodec,
      audioCodecs,
      containerFormat,
      fileSizeBytes,
      durationSec,
      audioTracks,
      subtitleTracks,
      isDualAudio: audioTracks.filter((a) => a.language !== null).length >= 2 || audioTracks.length >= 2,
      hasUnlabelledAudio: audioTracks.some((a) => a.language === null),
    },
    verification,
  };
}

export function verifyEpisodeIdentity(declaredStream, measuredContainer, urlBasename, requestContext = {}) {
  const {
    mediaType = "tv",
    imdbId: reqImdb = null,
    tmdbId: reqTmdb = null,
    season: reqSeason = null,
    episode: reqEpisode = null,
    expectedRuntimeSec = null,
  } = requestContext;

  const tags = (measuredContainer && measuredContainer.tags) || {};
  const tagText = [tags.title, tags.show, tags.episode_id, tags.comment].filter(Boolean).join(" ");
  const tagIds = extractContentIds(tags.comment || "");
  const containerTokens = parseSeasonEpisodeTokens(tagText);
  const tagSeason = tags.season_number != null ? Number(tags.season_number)
    : tags.season != null ? Number(tags.season)
    : containerTokens.season;
  const tagEpisode = tags.episode_sort != null ? Number(tags.episode_sort)
    : tags.episode != null ? Number(tags.episode)
    : containerTokens.episode;

  const declaredText = [declaredStream.name, declaredStream.title, declaredStream.filename, urlBasename].filter(Boolean).join(" ");
  const declaredTokens = parseSeasonEpisodeTokens(declaredText);
  const declSeason = declaredStream.season != null ? Number(declaredStream.season) : declaredTokens.season;
  const declEpisode = declaredStream.episode != null ? Number(declaredStream.episode) : declaredTokens.episode;

  const declIds = {
    imdbId: declaredStream.imdbId ? String(declaredStream.imdbId).toLowerCase() : extractContentIds(declaredText).imdbId,
    tmdbId: declaredStream.tmdbId != null ? String(declaredStream.tmdbId) : extractContentIds(declaredText).tmdbId,
  };

  const measuredDur = measuredContainer && typeof measuredContainer.durationSec === "number"
    ? measuredContainer.durationSec
    : null;

  let runtimeCheck = {
    status: PROVENANCE.UNKNOWN,
    expectedSec: expectedRuntimeSec,
    measuredSec: measuredDur,
    ratio: null,
  };
  if (expectedRuntimeSec && measuredDur) {
    const ratio = measuredDur / expectedRuntimeSec;
    runtimeCheck.ratio = Number(ratio.toFixed(3));
    if (expectedRuntimeSec >= 900 && measuredDur <= 240) {
      runtimeCheck.status = "trailer_duration";
    } else if (ratio >= 0.85 && ratio <= 1.15) {
      runtimeCheck.status = "within_tolerance";
    } else if (ratio < 0.5) {
      runtimeCheck.status = "too_short_clip";
    } else {
      runtimeCheck.status = "runtime_mismatch";
    }
  }

  // Trailer / Clip detection has priority
  if (containerTokens.isTrailer || declaredTokens.isTrailer || runtimeCheck.status === "trailer_duration") {
    return {
      status: "LIKELY_TRAILER_OR_CLIP",
      provenance: (containerTokens.isTrailer || runtimeCheck.status === "trailer_duration") ? PROVENANCE.VERIFIED : PROVENANCE.DECLARED,
      reasons: [
        containerTokens.isTrailer ? "container_trailer_marker" : null,
        declaredTokens.isTrailer ? "title_or_filename_trailer_marker" : null,
        runtimeCheck.status === "trailer_duration" ? `short_duration_${Math.round(measuredDur)}s_vs_${expectedRuntimeSec}s` : null,
      ].filter(Boolean),
      ids: { container: tagIds, provider: declIds },
      season: tagSeason ?? declSeason ?? null,
      episode: tagEpisode ?? declEpisode ?? null,
      runtimeCheck,
    };
  }

  // Trusted external ID mismatch check
  if (reqImdb && tagIds.imdbId && tagIds.imdbId !== String(reqImdb).toLowerCase()) {
    return {
      status: "CONTENT_ID_MISMATCH",
      provenance: PROVENANCE.VERIFIED,
      reasons: [`container_imdb_${tagIds.imdbId}_expected_${reqImdb}`],
      ids: { container: tagIds, provider: declIds },
      season: tagSeason ?? declSeason,
      episode: tagEpisode ?? declEpisode,
      runtimeCheck,
    };
  }
  if (reqTmdb && tagIds.tmdbId && tagIds.tmdbId !== String(reqTmdb)) {
    return {
      status: "CONTENT_ID_MISMATCH",
      provenance: PROVENANCE.VERIFIED,
      reasons: [`container_tmdb_${tagIds.tmdbId}_expected_${reqTmdb}`],
      ids: { container: tagIds, provider: declIds },
      season: tagSeason ?? declSeason,
      episode: tagEpisode ?? declEpisode,
      runtimeCheck,
    };
  }

  if (mediaType === "tv" && reqSeason != null && reqEpisode != null) {
    // Check verified container season/episode first
    if (tagSeason != null && tagSeason !== reqSeason) {
      return {
        status: "SEASON_MISMATCH",
        provenance: PROVENANCE.VERIFIED,
        reasons: [`container_season_${tagSeason}_expected_${reqSeason}`],
        ids: { container: tagIds, provider: declIds },
        season: tagSeason,
        episode: tagEpisode,
        runtimeCheck,
      };
    }
    if (tagEpisode != null && tagEpisode !== reqEpisode) {
      return {
        status: "EPISODE_MISMATCH",
        provenance: PROVENANCE.VERIFIED,
        reasons: [`container_episode_${tagEpisode}_expected_${reqEpisode}`],
        ids: { container: tagIds, provider: declIds },
        season: tagSeason,
        episode: tagEpisode,
        runtimeCheck,
      };
    }
    // Check declared/filename tokens next
    if (declSeason != null && declSeason !== reqSeason) {
      return {
        status: "SEASON_MISMATCH",
        provenance: PROVENANCE.DECLARED,
        reasons: [`declared_season_${declSeason}_expected_${reqSeason}`],
        ids: { container: tagIds, provider: declIds },
        season: declSeason,
        episode: declEpisode,
        runtimeCheck,
      };
    }
    if (declEpisode != null && declEpisode !== reqEpisode) {
      return {
        status: "EPISODE_MISMATCH",
        provenance: PROVENANCE.DECLARED,
        reasons: [`declared_episode_${declEpisode}_expected_${reqEpisode}`],
        ids: { container: tagIds, provider: declIds },
        season: declSeason,
        episode: declEpisode,
        runtimeCheck,
      };
    }

    const idVerified = Boolean(
      (reqImdb && tagIds.imdbId === String(reqImdb).toLowerCase()) ||
      (reqTmdb && tagIds.tmdbId === String(reqTmdb))
    );
    const seContainerVerified = tagSeason === reqSeason && tagEpisode === reqEpisode;
    const seDeclaredMatch = declSeason === reqSeason && declEpisode === reqEpisode;

    if (idVerified && seContainerVerified) {
      return {
        status: "VERIFIED_MATCH",
        provenance: PROVENANCE.VERIFIED,
        reasons: ["trusted_id_match", "container_season_episode_match", runtimeCheck.status !== PROVENANCE.UNKNOWN ? `runtime_${runtimeCheck.status}` : null].filter(Boolean),
        ids: { container: tagIds, provider: declIds },
        season: tagSeason,
        episode: tagEpisode,
        runtimeCheck,
      };
    }
    if (seContainerVerified) {
      return {
        status: "CONTAINER_TAG_MATCH",
        provenance: PROVENANCE.VERIFIED,
        reasons: ["container_season_episode_match", "no_trusted_external_id_in_container"],
        ids: { container: tagIds, provider: declIds },
        season: tagSeason,
        episode: tagEpisode,
        runtimeCheck,
      };
    }
    if (seDeclaredMatch) {
      return {
        status: "DECLARED_MATCH_UNVERIFIED_CONTAINER",
        provenance: PROVENANCE.DECLARED,
        reasons: ["filename_or_provider_season_episode_match", "container_lacks_episode_tags"],
        ids: { container: tagIds, provider: declIds },
        season: declSeason,
        episode: declEpisode,
        runtimeCheck,
      };
    }
    // Critical anti-trap rule: NEVER treat duration alone as proof of episode identity!
    return {
      status: "UNVERIFIED_MISSING_EPISODE_METADATA",
      provenance: PROVENANCE.UNKNOWN,
      reasons: [
        "no_season_or_episode_identifier_in_container_or_title",
        runtimeCheck.status === "within_tolerance" ? "matching_duration_alone_not_proof" : null,
      ].filter(Boolean),
      ids: { container: tagIds, provider: declIds },
      season: null,
      episode: null,
      runtimeCheck,
    };
  }

  return {
    status: "MOVIE_OR_UNSCOPED",
    provenance: tagIds.imdbId || tagIds.tmdbId ? PROVENANCE.VERIFIED : PROVENANCE.DECLARED,
    reasons: [],
    ids: { container: tagIds, provider: declIds },
    season: null,
    episode: null,
    runtimeCheck,
  };
}
