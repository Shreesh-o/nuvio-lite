/**
 * Faithful simulator of Nuvio's stream parsing, mapping, and StreamCard UI rendering pipelines:
 *  - Mobile/Desktop Native QuickJS Plugin (PluginRuntime.kt + StreamFetchSupport.kt + StreamCard.kt)
 *  - TV Native QuickJS Plugin (TV_PluginRuntime.kt + TV_StreamRepositoryImpl.kt + TV_Stream.kt + TV_StreamScreen.kt)
 *  - Mobile/Desktop Stremio HTTP Addon (StreamParser.kt + StreamCard.kt + DebridStreamFormatter)
 *  - TV Stremio HTTP Addon (TV_StreamMapper.kt + TV_StreamScreen.kt)
 */

const ALLOWED_PLUGIN_KEYS = new Set([
  "title",
  "name",
  "url",
  "quality",
  "size",
  "language",
  "provider",
  "type",
  "seeders",
  "peers",
  "infoHash",
  "headers",
  "subtitles",
]);

function formatFileSizeBadgeBytes(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return null;
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `SIZE ${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  return `SIZE ${Math.round(mb)} MB`;
}

/**
 * Simulates PluginRuntime.parseJsonResults (Mobile/Desktop & TV core fields).
 */
export function parseQuickJsPluginOutput(rawValue, platform = "mobile") {
  if (!Array.isArray(rawValue)) {
    // PluginRuntime.kt:198 & TV_PluginRuntime.kt: if not JsonArray, returns emptyList()!
    return { results: [], droppedTopLevelWrapper: typeof rawValue === "object" && rawValue !== null };
  }
  const results = [];
  for (const item of rawValue) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    let url = null;
    if (typeof item.url === "string" && item.url.trim()) url = item.url.trim();
    else if (item.url && typeof item.url === "object" && typeof item.url.url === "string" && item.url.url.trim()) {
      url = item.url.url.trim();
    }
    if (!url) continue;

    const ignoredKeys = Object.keys(item).filter((k) => {
      if (ALLOWED_PLUGIN_KEYS.has(k)) return false;
      if (platform === "tv" && k === "behaviorHints") return false;
      return true;
    });

    const parsed = {
      title: typeof item.title === "string" ? item.title : (typeof item.name === "string" ? item.name : "Unknown"),
      name: typeof item.name === "string" ? item.name : null,
      url,
      quality: item.quality != null && typeof item.quality !== "object" ? String(item.quality) : null,
      size: typeof item.size === "string" ? item.size : null,
      language: typeof item.language === "string" ? item.language : null,
      provider: typeof item.provider === "string" ? item.provider : null,
      type: typeof item.type === "string" ? item.type : null,
      seeders: Number.isInteger(item.seeders) ? item.seeders : null,
      peers: Number.isInteger(item.peers) ? item.peers : null,
      infoHash: typeof item.infoHash === "string" ? item.infoHash : null,
      headers: item.headers && typeof item.headers === "object" ? { ...item.headers } : null,
      subtitles: Array.isArray(item.subtitles)
        ? item.subtitles
            .filter((s) => s && typeof s.url === "string")
            .map((s) => ({
              url: s.url,
              language: typeof s.language === "string" ? s.language : "Unknown",
              name: typeof s.name === "string" ? s.name : null,
              headers: s.headers && typeof s.headers === "object" ? { ...s.headers } : null,
            }))
        : [],
      _auditIgnoredKeys: ignoredKeys,
    };

    if (platform === "tv" && item.behaviorHints && typeof item.behaviorHints === "object") {
      parsed.behaviorHints = {
        audioDelayMs: typeof item.behaviorHints.audioDelayMs === "number" ? item.behaviorHints.audioDelayMs : null,
        audioDelayLanguage: typeof item.behaviorHints.audioDelayLanguage === "string" ? item.behaviorHints.audioDelayLanguage : null,
        ignoredBehaviorHintKeys: Object.keys(item.behaviorHints).filter(
          (k) => k !== "audioDelayMs" && k !== "audioDelayLanguage"
        ),
      };
    } else if (item.behaviorHints && !parsed._auditIgnoredKeys.includes("behaviorHints")) {
      parsed._auditIgnoredKeys.push("behaviorHints");
    }

    results.push(parsed);
  }
  return { results, droppedTopLevelWrapper: false };
}

/**
 * Matches imported regex badge rules against stream text (`StreamBadgeRules.kt`).
 */
export function matchBadgeRules(streamText, badgeRules = []) {
  const matched = [];
  for (const rule of badgeRules) {
    if (!rule || !rule.regex) continue;
    try {
      const re = new RegExp(rule.regex, "i");
      if (re.test(streamText)) {
        matched.push({
          label: rule.label || rule.name || rule.regex,
          imageURL: rule.imageURL || "",
          style: rule.style || (rule.imageURL ? "IMAGE" : "STYLE_LABEL"),
        });
      }
    } catch (_) {}
  }
  return matched;
}

export function simulateMobileDesktopPluginPipeline(rawResults, scraperMeta = { id: "demo", name: "DemoScraper" }, opts = {}) {
  const { results, droppedTopLevelWrapper } = parseQuickJsPluginOutput(rawResults, "mobile");
  const badgeRules = opts.badgeRules || [];
  const showFileSizeBadges = opts.showFileSizeBadges ?? true;
  const includeScraperNameInSubtitle = opts.includeScraperNameInSubtitle ?? false;

  const cards = results.map((r) => {
    const subtitleParts = [
      includeScraperNameInSubtitle && scraperMeta.name ? scraperMeta.name : null,
      r.quality && r.quality.trim() ? r.quality.trim() : null,
      r.size && r.size.trim() ? r.size.trim() : null,
      r.language && r.language.trim() ? r.language.trim() : null,
    ].filter(Boolean);

    // StreamFetchSupport.kt:111 -> name = name ?: title
    const streamItem = {
      name: r.name || r.title,
      description: subtitleParts.join(" • ") || null,
      url: r.url,
      infoHash: r.infoHash,
      sourceName: scraperMeta.name,
      behaviorHints: {
        notWebReady: Boolean(r.headers && Object.keys(r.headers).length > 0),
        videoSize: null,
        filename: null,
      },
      externalSubtitles: r.subtitles,
    };

    const matchText = [streamItem.name, streamItem.description].filter(Boolean).join(" ");
    const allMatchedBadges = matchBadgeRules(matchText, badgeRules);
    // StreamCard.kt:73 filters ONLY non-blank imageURL
    const renderedBadges = allMatchedBadges.filter((b) => b.imageURL && b.imageURL.trim());

    const droppedTitleBecauseNameSet = Boolean(
      r.name && r.title && r.name !== r.title && !streamItem.name.includes(r.title)
    );

    return {
      platform: "mobile_desktop_plugin",
      cardTitle: streamItem.name || "Stream",
      cardSubtitle: streamItem.description,
      fileSizeBadge: showFileSizeBadges ? formatFileSizeBadgeBytes(streamItem.behaviorHints.videoSize) : null,
      renderedBadges,
      externalSubtitlesSentToPlayer: streamItem.externalSubtitles.length,
      renderedSubtitleCountOnCard: 0,
      renderedContainerFieldOnCard: null,
      renderedCodecFieldOnCard: null,
      renderedDurationFieldOnCard: null,
      renderedEpisodeBadgeOnCard: null,
      droppedTitleBecauseNameSet,
      droppedInputKeys: r._auditIgnoredKeys,
      droppedParsedPluginKeys: ["provider", "type", "seeders", "peers"].filter((k) => r[k] !== null),
    };
  });

  return { droppedTopLevelWrapper, cards };
}

export function simulateTvPluginPipeline(rawResults, scraperMeta = { id: "demo", name: "DemoScraper" }, opts = {}) {
  const { results, droppedTopLevelWrapper } = parseQuickJsPluginOutput(rawResults, "tv");
  const badgeRules = opts.badgeRules || [];
  const showFileSizeBadges = opts.showFileSizeBadges ?? true;

  const cards = results.map((r) => {
    // TV_StreamRepositoryImpl.kt:664-703
    const baseName = (r.name && r.name.trim()) || scraperMeta.name;
    const qualityLabel = (r.quality && r.quality.trim()) || "Unknown";
    const name = `${baseName} - ${qualityLabel}`;
    const title = r.title;
    const description = [r.size, r.language].filter((v) => v && v.trim()).join(" • ") || null;

    // TV_Stream.kt + TV_StreamScreen.kt:1422-1543
    const cardTitle = name || title || description;
    const rawSub = description || title;
    const cardSubtitle = rawSub && rawSub !== cardTitle ? rawSub : null;
    const droppedTitleBecauseDescriptionSet = Boolean(
      title && description && !cardTitle.includes(title) && !(cardSubtitle || "").includes(title)
    );

    const matchText = [name, title, description].filter(Boolean).join(" ");
    const renderedBadges = matchBadgeRules(matchText, badgeRules); // TV supports both label and image chips

    return {
      platform: "tv_plugin",
      cardTitle,
      cardSubtitle,
      fileSizeBadge: showFileSizeBadges ? formatFileSizeBadgeBytes(null) : null,
      renderedBadges,
      externalSubtitlesSentToPlayer: r.subtitles.length,
      renderedSubtitleCountOnCard: 0,
      droppedTitleBecauseDescriptionSet,
      droppedInputKeys: r._auditIgnoredKeys,
    };
  });

  return { droppedTopLevelWrapper, cards };
}

export function simulateStremioHttpAddonPipeline(rawStream, platform = "mobile", opts = {}) {
  const hints = rawStream.behaviorHints || {};
  const videoSize = typeof hints.videoSize === "number" ? hints.videoSize : null;
  const filename = typeof hints.filename === "string" ? hints.filename : null;
  const badgeRules = opts.badgeRules || [];

  // Mobile/Desktop StreamParser.kt drops `subtitles` on HTTP addon streams; TV_StreamMapper.kt keeps them
  const parsedSubtitles = platform === "tv" && Array.isArray(rawStream.subtitles) ? rawStream.subtitles : [];
  const droppedAddonSubtitles = platform !== "tv" && Array.isArray(rawStream.subtitles) && rawStream.subtitles.length > 0;

  const streamItem = {
    name: rawStream.name || null,
    title: rawStream.title || null,
    description: rawStream.description || rawStream.title || null,
    videoSize,
    filename,
    subtitles: parsedSubtitles,
    clientResolveParsed: rawStream.clientResolve?.stream?.raw?.parsed || null,
  };

  const matchText = [streamItem.name, streamItem.description, streamItem.filename].filter(Boolean).join(" ");
  const matched = matchBadgeRules(matchText, badgeRules);
  const renderedBadges = platform === "tv"
    ? matched
    : matched.filter((b) => b.imageURL && b.imageURL.trim());

  // DebridStreamFormatter only activates when isManagedDebridStream AND (hasCustomTemplate || badges.nonEmpty)
  const debridFormatterActive = Boolean(
    rawStream.isManagedDebridStream && (opts.hasCustomStreamFormatting || matched.length > 0)
  );

  return {
    platform: `${platform}_http_addon`,
    cardTitle: streamItem.name || "Stream",
    cardSubtitle: streamItem.description,
    fileSizeBadge: formatFileSizeBadgeBytes(streamItem.videoSize),
    filenameUsedForMatching: streamItem.filename,
    renderedBadges,
    subtitlesParsedCount: streamItem.subtitles.length,
    droppedAddonSubtitles,
    debridFormatterActive,
    clientResolveParsedAvailable: Boolean(streamItem.clientResolveParsed),
  };
}
