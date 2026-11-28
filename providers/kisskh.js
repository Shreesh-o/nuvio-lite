const cheerio = require('cheerio-without-node-native');

// Konstanta dari file Adicinemax21Extractor.kt
const MAIN_URL = "https://kisskh.ovh";
// URL Google Script untuk generate key (PENTING)
const KISSKH_API = "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec?id=";
const TMDB_API_KEY = "b030404650f279792a8d3287232358e3";
const TMDB_BASES = [
    "https://api.themoviedb.org/3",
    "https://api.tmdb.org/3",
    "https://db.wecollege.net/3"
];
const REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*"
};

function stripKisskhSuffix(title) {
    return String(title || "")
        .replace(/\((?:19|20)\d{2}\)/g, " ")
        .replace(/\[[^\]]*\]/g, " ")
        .replace(/\((?:sub|dub|eng|raw|remake)[^)]*\)/gi, " ")
        .trim();
}

function normalizeTitle(title) {
    return stripKisskhSuffix(title)
        .toLowerCase()
        .replace(/[:\-_'"`.,!?&]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function extractYearFromTitle(title) {
    const m = String(title || "").match(/\b(19\d\d|20\d\d)\b/);
    return m ? parseInt(m[1], 10) : null;
}

function scoreKisskhCandidate(targetTitle, targetYear, candTitle) {
    const tNorm = normalizeTitle(targetTitle);
    const cNorm = normalizeTitle(candTitle);
    if (!tNorm || !cNorm) return 0;

    const candYear = extractYearFromTitle(candTitle);
    if (targetYear && candYear && Math.abs(candYear - targetYear) > 2) {
        return 0;
    }

    if (cNorm === tNorm) return 100 + (targetYear && candYear === targetYear ? 20 : 0);

    const isPrefix = cNorm.indexOf(tNorm + " ") === 0 || tNorm.indexOf(cNorm + " ") === 0;
    const lenRatio = Math.min(tNorm.length, cNorm.length) / Math.max(tNorm.length, cNorm.length);
    if (isPrefix && lenRatio >= 0.72) {
        return 70 + (targetYear && candYear === targetYear ? 20 : 0);
    }

    const tWords = tNorm.split(" ").filter(Boolean);
    const cWords = cNorm.split(" ").filter(Boolean);
    if (tWords.length > 0 && tWords.length === cWords.length) {
        const cSet = new Set(cWords);
        if (tWords.every(w => cSet.has(w))) return 80;
    }
    return 0;
}

function fetchTmdbJson(pathSuffix) {
    let idx = 0;
    function next(lastErr) {
        if (idx >= TMDB_BASES.length) return Promise.reject(lastErr || new Error("TMDB lookup failed"));
        const base = TMDB_BASES[idx++];
        const sep = pathSuffix.indexOf("?") >= 0 ? "&" : "?";
        const url = base + pathSuffix + (base.indexOf("wecollege") >= 0 ? "" : `${sep}api_key=${TMDB_API_KEY}`);
        return fetch(url, { headers: REQUEST_HEADERS })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(data => {
                if (!data || data.success === false) throw new Error("Invalid TMDB payload");
                return data;
            })
            .catch(err => next(err));
    }
    return next(null);
}

function resolveMetadata(tmdbId, isTv) {
    const idStr = String(tmdbId || "").trim();
    const tType = isTv ? "tv" : "movie";
    if (idStr.startsWith("tt")) {
        return fetchTmdbJson(`/find/${encodeURIComponent(idStr)}?external_source=imdb_id`).then(data => {
            const list = isTv ? (data.tv_results || []) : (data.movie_results || []);
            if (!list.length) throw new Error("IMDb ID not found");
            const item = list[0];
            const dateStr = isTv ? item.first_air_date : item.release_date;
            return {
                title: item.title || item.name || item.original_title,
                year: dateStr ? parseInt(dateStr.substring(0, 4), 10) : null
            };
        });
    }
    return fetchTmdbJson(`/${tType}/${encodeURIComponent(idStr)}`).then(tmdbData => {
        const dateStr = isTv ? tmdbData.first_air_date : tmdbData.release_date;
        return {
            title: tmdbData.title || tmdbData.name || tmdbData.original_title,
            year: dateStr ? parseInt(dateStr.substring(0, 4), 10) : null
        };
    });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    const isTv = mediaType === "tv" || mediaType === "series";
    return resolveMetadata(tmdbId, isTv)
        .then(meta => {
            if (!meta || !meta.title) throw new Error("TMDB title not found");
            const searchUrl = `${MAIN_URL}/api/DramaList/Search?q=${encodeURIComponent(meta.title)}&type=0`;
            return fetch(searchUrl, { headers: REQUEST_HEADERS })
                .then(res => res.json())
                .then(searchList => {
                    if (!Array.isArray(searchList) || searchList.length === 0) {
                        throw new Error("Drama tidak ditemukan di Kisskh");
                    }
                    const scored = [];
                    for (let i = 0; i < searchList.length; i++) {
                        const item = searchList[i];
                        const s = scoreKisskhCandidate(meta.title, meta.year, item && item.title);
                        if (s > 0) scored.push({ item, score: s });
                    }
                    scored.sort((a, b) => b.score - a.score);
                    if (scored.length === 0) {
                        throw new Error("No verified match on Kisskh");
                    }
                    return { meta, candidates: scored.slice(0, 3).map(x => x.item) };
                });
        })
        .then(({ meta, candidates }) => {
            let idx = 0;
            function tryCandidate() {
                if (idx >= candidates.length) throw new Error("No verified detail match on Kisskh");
                const cand = candidates[idx++];
                return fetch(`${MAIN_URL}/api/DramaList/Drama/${cand.id}?isq=false`, { headers: REQUEST_HEADERS })
                    .then(res => res.json())
                    .then(detail => {
                        const dtype = String(detail && detail.type || "").toLowerCase();
                        if (isTv && dtype === "movie") return tryCandidate();
                        if (!isTv && (dtype === "tvseries" || dtype === "series")) return tryCandidate();

                        const relYear = detail && detail.releaseDate ? parseInt(String(detail.releaseDate).substring(0, 4), 10) : null;
                        const sNum = seasonNum ? parseInt(seasonNum, 10) : 1;
                        if (meta.year && relYear && (!isTv || sNum <= 1) && Math.abs(relYear - meta.year) > 2) {
                            return tryCandidate();
                        }

                        const episodes = detail && detail.episodes;
                        if (!episodes || episodes.length === 0) return tryCandidate();

                        let targetEp;
                        if (!isTv) {
                            targetEp = episodes[episodes.length - 1];
                        } else {
                            targetEp = episodes.find(ep => parseFloat(ep.number) === parseFloat(episodeNum));
                        }
                        if (!targetEp) return tryCandidate();
                        return targetEp.id;
                    });
            }
            return tryCandidate();
        })
        .then(epsId => {
            const keyUrl = `${KISSKH_API}${epsId}&version=2.8.10`;
            return fetch(keyUrl, { headers: REQUEST_HEADERS })
                .then(res => res.json())
                .then(keyData => {
                    if (!keyData || !keyData.key) throw new Error("Gagal mengambil kunci video");
                    const videoApi = `${MAIN_URL}/api/DramaList/Episode/${epsId}.png?err=false&ts=&time=&kkey=${keyData.key}`;
                    return fetch(videoApi, { headers: REQUEST_HEADERS });
                })
                .then(res => res.json())
                .then(sources => {
                    const streams = [];
                    const links = [sources && sources.Video, sources && sources.ThirdParty].filter(Boolean);
                    links.forEach(link => {
                        if (link.includes(".m3u8")) {
                            streams.push({
                                name: "Kisskh HLS",
                                title: "Kisskh Stream",
                                url: link,
                                quality: "Auto",
                                headers: { Origin: MAIN_URL, Referer: MAIN_URL },
                                provider: "kisskh"
                            });
                        } else if (link.includes(".mp4")) {
                            streams.push({
                                name: "Kisskh MP4",
                                title: "Kisskh Stream",
                                url: link,
                                quality: "Auto",
                                headers: { Referer: MAIN_URL },
                                provider: "kisskh"
                            });
                        }
                    });
                    return streams;
                });
        })
        .catch(err => {
            console.error("Kisskh Error:", err);
            return [];
        });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
