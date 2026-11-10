(() => {
  "use strict";

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const STORE_KEY = "anidash.watch.web.v1";
  const API = "https://graphql.anilist.co";
  const MEDIA_FIELDS = [
    "id idMal synonyms",
    "title { romaji english native }",
    "coverImage { extraLarge large medium }",
    "bannerImage format status episodes duration averageScore popularity",
    "genres season seasonYear startDate { year month day }",
    "nextAiringEpisode { episode airingAt timeUntilAiring }",
    "siteUrl isAdult"
  ].join("\n");

  function readStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      return {
        watchlist: raw.watchlist || {},
        history: raw.history || {},
        mangaList: raw.mangaList || {},
        libraryStatuses: raw.libraryStatuses || {},
        localFavorites: raw.localFavorites || {},
        malStatuses: raw.malStatuses || {},
        providerManifest: raw.providerManifest || null,
        adultContent: raw.adultContent === true,
        preferences: raw.preferences && typeof raw.preferences === "object" ? raw.preferences : {},
        hiddenCloudEntries: raw.hiddenCloudEntries || {},
        updatedAt: Number(raw.updatedAt || 0)
      };
    } catch (_) {
      return { watchlist: {}, history: {}, mangaList: {}, libraryStatuses: {},
        localFavorites: {}, malStatuses: {}, providerManifest: null, adultContent: false,
        preferences: {}, hiddenCloudEntries: {}, updatedAt: 0 };
    }
  }

  const store = readStore();
  const DEFAULT_PREFERENCES = {
    themeMode: "light", preferredAudio: "dub", defaultQuality: "Auto",
    autoEnableSubtitles: true, autoSkipIntro: false, showNextEpisodePrompt: true,
    episodeViewMode: "list", preferredSource: "auto",
    showMangaTab: false, showNewsSection: true, showNewsNotifications: true,
    trackProgress: true
  };
  store.preferences = { ...DEFAULT_PREFERENCES, ...store.preferences };
  const setting = key => store.preferences[key];
  function applyPreferences() {
    if (!document.body || !document.body.dataset) return;
    const themeMode = setting("themeMode");
    const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.body.dataset.theme = themeMode === "dark" || (themeMode === "system" && systemDark)
      ? "dark" : "light";
    document.body.dataset.episodeLayout = setting("episodeViewMode") || "list";
    document.body.dataset.mangaNav = setting("showMangaTab") ? "true" : "false";
    $$('[data-optional-manga]').forEach(item => { item.hidden = !setting("showMangaTab"); });
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = document.body.dataset.theme === "dark" ? "#101512" : "#f4f8f5";
  }
  applyPreferences();
  const state = {
    route: "/home",
    token: 0,
    home: null,
    discover: null,
    search: [],
    searchTerm: "",
    selectedGenre: "",
    detail: null,
    detailMatches: [],
    detailEpisodes: [],
    selectedMatch: null,
    episodePage: 1,
    episodeFilter: "",
    playerEpisodePage: 1,
    playerEpisodeFilter: "",
    player: null,
    providers: [],
    currentVideo: null,
    hls: null,
    installEvent: null,
    progressTimer: 0,
    spotlight: [], spotlightIndex: 0, spotlightTimer: null,
    malEntries: [], libraryTab: "CURRENT", cloudSyncing: false,
    mangaDetail: null, lastCloudProgressSync: new Map(),
    news: [], newsFetched: false, newsPending: null, newsError: "",
    notificationRead: {}, lastInfoRefresh: 0
  };

  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char]));
  const titleOf = media => media && media.title ? (media.title.english || media.title.romaji || media.title.native || "Unknown title") : "Unknown title";
  const formatScore = score => score ? (Number(score) / 10).toFixed(1) : "—";
  const cleanText = value => String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const mediaYear = media => media && (media.seasonYear || (media.startDate && media.startDate.year)) || "";
  const imageOf = media => media && media.coverImage && (media.coverImage.extraLarge || media.coverImage.large || media.coverImage.medium) || "";
  const slug = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const hhmmss = value => {
    const total = Math.max(0, Math.floor(Number(value) || 0));
    const seconds = String(total % 60).padStart(2, "0");
    const minutes = Math.floor(total / 60);
    return minutes >= 60
      ? Math.floor(minutes / 60) + ":" + String(minutes % 60).padStart(2, "0") + ":" + seconds
      : String(minutes).padStart(2, "0") + ":" + seconds;
  };
  const progressCaption = entry => {
    if (!entry || Number(entry.position || 0) <= 0) return "Resume episode " + (entry?.episode || 1);
    const played = hhmmss(entry.position), duration = Number(entry.duration || 0);
    return duration > entry.position ? "Resume at " + played + " / " + hhmmss(duration) : "Resume at " + played;
  };
  const UI_ICON_NAMES = new Set(["home","compass","search","manga","library","user","settings","news","bell","clock","expand","pause","volume",
    "download","play","bookmark","chevron-right","chevron-left","chevron-down","heart","star",
    "refresh","sliders","calendar","filter","history","check","info","shield","eye","cloud"]);
  function uiIcon(name) {
    const safe = UI_ICON_NAMES.has(name) ? name : "info";
    return '<svg class="ui-icon" aria-hidden="true"><use href="/icons/ui-sprite.svg#' + safe + '"></use></svg>';
  }
  // Faithful port of Android's animeSeasonBadge() in anime_card_components.dart.
  function animeSeasonBadge(media) {
    const format = String(media?.format || "").toUpperCase();
    if (format === "MOVIE") return "M";
    if (format === "MUSIC") return "";
    const title = [media?.title?.english, media?.title?.romaji, media?.title?.native,
      ...(Array.isArray(media?.synonyms) ? media.synonyms : [])].filter(Boolean).join(" ");
    if (format === "OVA") return "OVA";
    if (format === "SPECIAL" || /special|chibi/i.test(title)) return "SP";
    const seasonMatch = /(?:season|series)\s*(\d+)|\b(\d+)(?:st|nd|rd|th)\s+season\b|第\s*(\d+)\s*季/i.exec(title);
    const partMatch = /(?:part|cour)\s*(\d+)/i.exec(title);
    if (seasonMatch) {
      const number = Number(seasonMatch[1] || seasonMatch[2] || seasonMatch[3] || 1);
      const part = Number(partMatch?.[1] || 0);
      return part > 1 ? "S" + number + "-" + part : "S" + number;
    }
    if (partMatch && Number(partMatch[1]) > 1) return "S1-" + Number(partMatch[1]);
    if (/\bii\b|season\s*2|2nd\s*season|wu\s*mian\s*ren/i.test(title)) return "S2";
    return "S1";
  }
  const SECTIONS = {
    airing: { title: "Currently Airing", sort: "TRENDING_DESC", extra: ", status: RELEASING" },
    trending: { title: "Trending Right Now", sort: "TRENDING_DESC", extra: "", ranked: true },
    popular: { title: "All Time Popular", sort: "POPULARITY_DESC", extra: "" },
    top: { title: "Top Rated", sort: "SCORE_DESC", extra: "" },
    upcoming: { title: "Upcoming Series", sort: "POPULARITY_DESC", extra: ", status: NOT_YET_RELEASED" },
    movies: { title: "Anime Movies", sort: "POPULARITY_DESC", extra: ", format: MOVIE" },
    hidden: { title: "Hidden Gems", sort: "SCORE_DESC", extra: ", averageScore_greater: 75, popularity_lesser: 35000" }
  };
  const sectionUrl = key => "/section/" + encodeURIComponent(key);


  function persist() {
    store.updatedAt = Date.now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
    catch (_) { toast("Browser storage is unavailable. Export your library as backup."); }
    if (window.AniDashStorage) {
      window.AniDashStorage.save(store).catch(() => {});
    }
  }
  async function restoreStorage() {
    if (!window.AniDashStorage) return;
    try {
      const backup = await window.AniDashStorage.load();
      if (backup && Number(backup.updatedAt || 0) > Number(store.updatedAt || 0)) {
        Object.assign(store, backup);
        store.preferences = { ...DEFAULT_PREFERENCES, ...store.preferences };
        persist();
      } else if (!backup || Number(store.updatedAt || 0) >= Number(backup.updatedAt || 0)) {
        // Migrate earlier localStorage-only installations into the recovery DB.
        if (store.updatedAt || Object.keys(store.watchlist).length || Object.keys(store.history).length) {
          window.AniDashStorage.save(store).catch(() => {});
        }
      }
    } catch (_) {}
    applyPreferences();
  }

  function toast(message) {
    const root = $("#toast-root");
    if (!root) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    root.appendChild(el);
    window.setTimeout(() => el.remove(), 3200);
  }

  // Public metadata requests share a queue, a short-lived catalogue cache and
  // the same rate-limit cooldown. Returning Home does not refetch seven pages.
  const collectionCache = new Map();
  const collectionPending = new Map();
  const gqlPending = new Map();
  const COLLECTION_PREFIX = "anidash.catalog.page.v2.";
  let gqlQueue = Promise.resolve();
  let nextRequestAt = 0;
  let rateLimitedUntil = 0;
  const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  function waitNotice(error) {
    const remaining = Math.max(0, rateLimitedUntil - Date.now());
    return error?.message || (remaining
      ? "AniList is busy. Retry in " + Math.ceil(remaining / 1000) + " seconds."
      : "Catalogue temporarily unavailable.");
  }
  async function gql(query, variables) {
    const key = JSON.stringify([query, variables || {}]);
    if (gqlPending.has(key)) return gqlPending.get(key);
    const request = gqlQueue.then(async () => {
      if (Date.now() < rateLimitedUntil) {
        throw new Error("AniList is temporarily busy. Please retry shortly.");
      }
      await delay(Math.max(0, nextRequestAt - Date.now()));
      nextRequestAt = Date.now() + 540;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 14500);
      try {
        const response = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ query, variables: variables || {} }),
          signal: controller.signal
        });
        const body = await response.json().catch(() => ({}));
        if (response.status === 429) {
          const header = Number(response.headers?.get?.("retry-after") || 0);
          rateLimitedUntil = Date.now() + Math.min(90000,
            Math.max(5000, Number.isFinite(header) ? header * 1000 : 30000));
          throw new Error("AniList is receiving too many requests. Cached titles remain available.");
        }
        if (!response.ok || body.errors) {
          const message = body.errors?.[0]?.message || "AniList is temporarily unavailable.";
          throw new Error(message);
        }
        if (!body.data) throw new Error("AniList returned an empty response.");
        return body.data;
      } catch (error) {
        if (error.name === "AbortError") throw new Error("AniList request timed out. Retry shortly.");
        throw error;
      } finally {
        window.clearTimeout(timeout);
      }
    });
    gqlQueue = request.catch(() => {});
    gqlPending.set(key, request);
    return request.finally(() => gqlPending.delete(key));
  }

  function pageQuery(sort, page, perPage, extra) {
    return "query ($page: Int, $perPage: Int) { Page(page: $page, perPage: $perPage) { pageInfo { hasNextPage currentPage lastPage } media(type: ANIME, sort: " +
      sort + ", isAdult: false" + (extra || "") + ") { " + MEDIA_FIELDS + " } } }";
  }

  async function getCollection(sort, page, perPage, extra) {
    const key = JSON.stringify([sort, page || 1, perPage || 18, extra || ""]);
    let entry = collectionCache.get(key);
    if (!entry) {
      try {
        entry = JSON.parse(localStorage.getItem(COLLECTION_PREFIX + encodeURIComponent(key)) || "null");
        if (entry?.data && Number.isFinite(entry.updatedAt)) collectionCache.set(key, entry);
        else entry = null;
      } catch (_) { entry = null; }
    }
    const age = entry ? Date.now() - entry.updatedAt : Infinity;
    if (entry && age < 12 * 60_000) return entry.data;
    if (collectionPending.has(key)) return collectionPending.get(key);
    if (entry && age < 24 * 60 * 60_000 && Date.now() < rateLimitedUntil) return entry.data;
    const pending = (async () => {
      try {
        const data = await gql(pageQuery(sort, page || 1, perPage || 18, extra || ""), {
          page: page || 1, perPage: perPage || 18
        });
        if (!data?.Page || !Array.isArray(data.Page.media)) throw new Error("Catalogue data is incomplete.");
        const fresh = { data: data.Page, updatedAt: Date.now() };
        collectionCache.set(key, fresh);
        try { localStorage.setItem(COLLECTION_PREFIX + encodeURIComponent(key), JSON.stringify(fresh)); }
        catch (_) {}
        return fresh.data;
      } catch (error) {
        if (entry && age < 24 * 60 * 60_000) return entry.data;
        throw error;
      }
    })().finally(() => collectionPending.delete(key));
    collectionPending.set(key, pending);
    return pending;
  }


  // AniList metadata is reused when a user opens an anime or returns from the player.
  const animeMetadataCache = new Map();
  const animeMetadataPending = new Map();
  async function getAnime(id) {
    const key = String(id);
    if (animeMetadataCache.has(key)) return animeMetadataCache.get(key);
    if (animeMetadataPending.has(key)) return animeMetadataPending.get(key);
    const request = (async () => {
      const query = "query ($id: Int) { Media(id: $id, type: ANIME) { " + MEDIA_FIELDS +
        " description(asHtml: false) studios(isMain: true) { nodes { name } } relations { edges { relationType node { id type title { english romaji } coverImage { large } } } } recommendations(sort: RATING_DESC) { nodes { mediaRecommendation { id title { english romaji } coverImage { large } averageScore format } } } trailer { id site thumbnail } } }";
      const data = await gql(query, { id: Number(id) });
      if (!data || !data.Media) throw new Error("This anime was not found in AniList.");
      animeMetadataCache.set(key, data.Media);
      return data.Media;
    })().finally(() => animeMetadataPending.delete(key));
    animeMetadataPending.set(key, request);
    return request;
  }

  async function searchAniList(term, page) {
    const query = "query ($search: String!, $page: Int, $perPage: Int) { Page(page: $page, perPage: $perPage) { pageInfo { hasNextPage } media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: false) { " + MEDIA_FIELDS + " } } }";
    const data = await gql(query, { search: term, page: page || 1, perPage: 24 });
    return data.Page;
  }

  function showLoading(_message) {
    const view = $("#view");
    if (!view || view.querySelector(".home-hero, .anime-grid, .library-tabs, .native-home-header")) return;
    view.innerHTML = '<section class="page-skeleton" aria-label="Loading content" role="status">' +
      '<div class="skeleton-line medium"></div><div class="skeleton-hero"></div>' +
      '<div class="skeleton-line short"></div><div class="skeleton-grid">' +
      Array.from({ length: 6 }, () => '<span class="skeleton-poster"></span>').join("") +
      '</div></section>';
  }

  function card(media, type = "ANIME") {
    const isManga = type === "MANGA";
    const progress = !isManga && store.history[String(media.id)];
    const poster = imageOf(media);
    const pct = progress?.duration > 0 ? Math.max(0, Math.min(100, (progress.position / progress.duration) * 100)) : 0;
    const tag = isManga ? "" : animeSeasonBadge(media);
    const typeAttr = isManga ? "data-manga" : "data-anime";
    const episodes = isManga ? (media.chapters ? media.chapters + " chapters" : media.format) :
      (media.episodes ? media.episodes + " eps" : media.status);
    return '<article class="anime-card" ' + typeAttr + '="' + escapeHtml(media.id) +
      '" tabindex="0" role="button" aria-label="Open ' + escapeHtml(titleOf(media)) + '">' +
      '<div class="poster-wrap">' +
        (poster ? '<img loading="lazy" src="' + escapeHtml(poster) + '" alt="' + escapeHtml(titleOf(media)) + '">' :
        '<div class="poster-fallback">' + escapeHtml(titleOf(media)) + '</div>') +
        '<div class="poster-shade"></div>' +
        (tag ? '<span class="season-chip">' + escapeHtml(tag) + '</span>' : "") +
        (media.averageScore ? '<span class="poster-score">' + uiIcon("star") + ' ' + formatScore(media.averageScore) + '</span>' : '') +
      '</div>' +
      '<div class="card-title">' + escapeHtml(titleOf(media)) + '</div>' +
      '<p class="card-subtitle">' + escapeHtml([mediaYear(media), episodes].filter(Boolean).join(" · ")) + '</p>' +
      (progress ? '<div class="card-progress"><span style="width:' + pct + '%"></span></div><div class="card-resume">Episode ' +
        escapeHtml(progress.episode || 1) + (progress.position > 0 ? " · " + hhmmss(progress.position) : "") +
        '</div>' : '') +
    '</article>';
  }

  function grid(items) {
    if (!items || !items.length) return '<div class="empty-state"><div class="empty-icon">✦</div><h3>Nothing here yet</h3><p>Try another search or explore the catalogue.</p></div>';
    return '<div class="anime-grid">' + items.map(card).join("") + '</div>';
  }

  function section(title, note, items, route) {
    return '<section class="section"><div class="section-heading"><div><h2 class="section-title">' + escapeHtml(title) + '</h2>' +
      (note ? '<p class="section-note">' + escapeHtml(note) + '</p>' : '') + '</div>' +
      (route ? '<button class="section-link" data-route="' + route + '">View all ↗</button>' : '') +
      '</div>' + grid(items) + '</section>';
  }

  function shelf(title, note, items, route) {
    const rows = (items || []).filter(Boolean);
    if (!rows.length) return "";
    return '<section class="section shelf-section"><div class="section-heading"><div><h2 class="section-title">' + escapeHtml(title) + '</h2>' +
      (note ? '<p class="section-note">' + escapeHtml(note) + '</p>' : '') + '</div>' +
      (route ? '<button class="section-link" data-route="' + route + '">View all ' + uiIcon("chevron-right") + '</button>' : '') +
      '</div><div class="anime-shelf">' + rows.map(card).join("") + '</div></section>';
  }

  function resumeShelf(items) {
    const rows = (items || []).filter(item => item && item.media);
    if (!rows.length) return "";
    return '<section class="section shelf-section"><div class="section-heading"><div><h2 class="section-title">Continue watching</h2><p class="section-note">Pick up exactly where you stopped.</p></div><button class="section-link" data-route="/history">View history ↗</button></div>' +
      '<div class="anime-shelf">' + rows.map(item => {
        const media = item.media;
        const pct = item.duration > 0 ? Math.min(100, Math.max(0, item.position / item.duration * 100)) : 0;
        const poster = media.bannerImage || imageOf(media);
        return '<article class="anime-card resume-card" data-resume="' + escapeHtml(media.id) + '" tabindex="0" role="button" aria-label="Resume ' + escapeHtml(titleOf(media)) + ' episode ' + escapeHtml(item.episode) + '">' +
          '<div class="poster-wrap">' + (poster ? '<img loading="lazy" src="' + escapeHtml(poster) + '" alt="">' : '<div class="poster-fallback">' + escapeHtml(titleOf(media)) + '</div>') +
          '<span class="poster-score">EP ' + escapeHtml(item.episode || 1) + '</span><span class="resume-play">▶</span></div>' +
          '<div class="card-title">' + escapeHtml(titleOf(media)) + '</div><p class="card-subtitle">' + escapeHtml(item.episodeTitle || ("Episode " + (item.episode || 1))) + '</p>' +
          '<p class="resume-timestamp">' + escapeHtml(progressCaption(item)) + '</p>' +
          '<div class="card-progress"><span style="width:' + pct + '%"></span></div></article>';
      }).join("") + '</div></section>';
  }

  function pageHead(eyebrow, title, subtitle, extra) {
    return '<div class="page-head"><div><div class="eyebrow">' + escapeHtml(eyebrow) + '</div><h1 class="page-title">' + escapeHtml(title) + '</h1>' +
      (subtitle ? '<p class="page-subtitle">' + escapeHtml(subtitle) + '</p>' : '') + '</div>' + (extra || '') + '</div>';
  }



  const newsKey = "anidash.news-read.v1";
  try { state.notificationRead = JSON.parse(localStorage.getItem(newsKey) || "{}") || {}; } catch (_) { state.notificationRead = {}; }
  const newsId = item => String(item?.url || "");
  const isUnread = item => !state.notificationRead[newsId(item)];
  function newsDate(value) {
    const date = new Date(value || 0);
    return Number.isFinite(date.getTime())
      ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : "";
  }
  function newsItemsMarkup(items, compact = false) {
    if (!items.length) return '<p class="news-empty">No headlines available at the moment.</p>';
    return items.map((item, i) => {
      const index = state.news.indexOf(item);
      const image = /^https:\/\//i.test(item.imageUrl || "") ? item.imageUrl : "";
      return '<button class="news-item' + (compact ? " compact" : "") + '" data-open-news="' + index +
        '" aria-label="Read: ' + escapeHtml(item.title) + '">' +
        (image ? '<img src="' + escapeHtml(image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true">' : '<span class="news-art">' + uiIcon("news") + '</span>') +
        '<span class="news-copy"><strong>' + escapeHtml(item.title) + '</strong><span>' +
        escapeHtml(newsDate(item.date)) + ' · Anime News Network</span></span>' +
        (isUnread(item) ? '<span class="news-unread-dot" aria-label="Unread"></span>' : '') + '</button>';
    }).join("");
  }
  function newsPreview() {
    if (!setting("showNewsSection")) return "";
    return '<section class="section news-section"><div class="section-heading"><h2 class="section-title">Latest news</h2>' +
      '<button class="section-link" data-route="/news">View all ' + uiIcon("chevron-right") + '</button></div>' +
      '<div class="news-scroller" id="home-news-panel">' +
      (state.news.length ? newsItemsMarkup(state.news.slice(0, 7), true) :
      state.newsError ? '<p class="news-empty">News is temporarily unavailable.</p>' :
      '<p class="news-empty">Checking anime headlines…</p>') + '</div></section>';
  }
  function unreadNewsCount() {
    return setting("showNewsNotifications") ? state.news.filter(isUnread).length : 0;
  }
  function updateNewsBadge() {
    const count = unreadNewsCount();
    $$("[data-news-badge]").forEach(el => {
      el.textContent = count > 9 ? "9+" : String(count);
      el.hidden = count === 0;
    });
  }
  async function loadNews(force = false) {
    if (state.newsPending) return state.newsPending;
    if (state.newsFetched && !force) return state.news;
    state.newsPending = (async () => {
      try {
        const response = await fetch("/api/news", { headers: { Accept: "application/json" }, cache: "default" });
        if (!response.ok) throw new Error("News unavailable");
        const payload = await response.json();
        if (!Array.isArray(payload.items)) throw new Error("Invalid news feed");
        state.news = payload.items.filter(item => item && item.title && /^https:\/\//i.test(item.url || "")).slice(0, 30);
        state.newsFetched = true;
        state.newsError = "";
      } catch (error) {
        state.newsError = error?.message || "News unavailable";
      } finally {
        state.newsPending = null;
      }
      const panel = $("#home-news-panel");
      if (panel) panel.innerHTML = state.news.length ? newsItemsMarkup(state.news.slice(0, 7), true) :
        '<p class="news-empty">News is temporarily unavailable.</p>';
      updateNewsBadge();
      if (state.route === "/news") renderNews();
      if (state.route === "/notifications") renderNotifications();
      return state.news;
    })();
    return state.newsPending;
  }
  function markNewsRead(item) {
    if (!item || !item.url) return;
    state.notificationRead[newsId(item)] = true;
    try { localStorage.setItem(newsKey, JSON.stringify(state.notificationRead)); } catch (_) {}
    updateNewsBadge();
  }
  function renderNews() {
    $("#view").innerHTML = pageHead("", "Anime news", "Latest published headlines from Anime News Network") +
      '<div class="news-list">' + (state.news.length ? newsItemsMarkup(state.news) :
      '<div class="empty-state"><h3>No headlines loaded</h3><p>' +
      escapeHtml(state.newsError || "Checking for articles.") +
      '</p><button class="btn btn-primary" data-refresh-news>Refresh news</button></div>') + '</div>';
    void loadNews();
  }
  function renderNotifications() {
    const rows = state.news;
    $("#view").innerHTML = pageHead("", "Notifications", "In-app anime news alerts on this device") +
      '<div class="notification-toolbar"><span>' + unreadNewsCount() + ' unread</span>' +
      '<button class="btn btn-quiet" data-read-all-news ' + (!rows.length ? "disabled" : "") + '>Mark all read</button></div>' +
      (setting("showNewsNotifications") ?
        '<div class="news-list">' + (rows.length ? newsItemsMarkup(rows) :
          '<div class="empty-state"><h3>No notifications yet</h3><p>New anime headlines appear here when the feed updates.</p></div>') +
          '</div>' :
        '<div class="empty-state"><h3>News alerts are disabled</h3><p>Enable them under Settings.</p></div>');
    void loadNews();
  }
  function profileGreetingMarkup() {
    const user = window.AniDashAccount?.currentUser() || window.AniDashMal?.currentUser();
    const avatar = user?.avatar?.large || user?.avatar?.medium || user?.picture || "";
    const photo = /^https:\/\//i.test(avatar)
      ? '<img src="' + escapeHtml(avatar) + '" alt="" referrerpolicy="no-referrer">'
      : uiIcon("user");
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    return '<button class="home-profile" data-route="/account" aria-label="View account profile">' +
      '<span class="home-profile-photo">' + photo + '</span><span class="home-profile-copy">' +
      '<span class="home-greeting">' + greeting + '</span><strong>' + escapeHtml(user?.name || "Guest") + '</strong>' +
      '</span></button>';
  }
  function renderHomeProfile() {
    const node = $("#home-profile-slot");
    if (node) node.innerHTML = profileGreetingMarkup();
  }

  function spotlightMarkup(media) {
    const image = media?.bannerImage || imageOf(media);
    return '<section class="hero-stage home-hero"><div class="hero-bg" style="background-image:url(&quot;' +
      escapeHtml(image) + '&quot;)"></div><div class="hero-content">' +
      '<div class="hero-kicker">Trending on AniDash</div>' +
      '<h1 class="hero-title">' + escapeHtml(titleOf(media)) + '</h1>' +
      '<div class="hero-meta"><span>' + uiIcon("star") + ' ' + formatScore(media?.averageScore) + '</span>' +
      '<span>' + escapeHtml(animeSeasonBadge(media)) + '</span>' +
      '<span>' + escapeHtml(media?.format || "Anime") + '</span>' +
      '<span>' + escapeHtml(mediaYear(media)) + '</span></div>' +
      '<div class="hero-actions"><button class="btn btn-primary" data-anime="' + media.id + '">' +
        uiIcon("play") + ' Explore Anime</button><button class="btn btn-secondary" data-watchlist="' + media.id + '">' +
        uiIcon("bookmark") + ' Save</button></div></div></section>';
  }
  function showSpotlight(index) {
    if (state.route !== "/home" || !state.spotlight?.length) return;
    const items = state.spotlight;
    state.spotlightIndex = (index + items.length) % items.length;
    const panel = $("#spotlight-content");
    if (panel) panel.innerHTML = spotlightMarkup(items[state.spotlightIndex]);
    $$("[data-spotlight-index]").forEach(el => {
      el.classList.toggle("active", Number(el.getAttribute("data-spotlight-index")) === state.spotlightIndex);
    });
    const count = $("#spotlight-count");
    if (count) count.textContent = (state.spotlightIndex + 1) + " / " + items.length;
    scheduleSpotlight();
  }
  function scheduleSpotlight() {
    if (state.spotlightTimer) window.clearTimeout(state.spotlightTimer);
    if (state.route !== "/home" || !state.spotlight || state.spotlight.length < 2) return;
    state.spotlightTimer = window.setTimeout(() => {
      if (state.route !== "/home") return;
      if (document.visibilityState === "hidden") { scheduleSpotlight(); return; }
      showSpotlight(state.spotlightIndex + 1);
    }, 2000);
    if (state.spotlightTimer?.unref) state.spotlightTimer.unref();
  }
  function spotlightPanel(items) {
    const first = items[0];
    if (!first) return "";
    return '<div class="spotlight-shell" aria-label="Trending anime carousel">' +
      '<div id="spotlight-content">' + spotlightMarkup(first) + '</div>' +
      '<button class="spotlight-control prev" data-spotlight-prev title="Previous trending anime" aria-label="Previous trending anime">' +
        uiIcon("chevron-left") + '</button>' +
      '<button class="spotlight-control next" data-spotlight-next title="Next trending anime" aria-label="Next trending anime">' +
        uiIcon("chevron-right") + '</button>' +
      '<div class="spotlight-count" id="spotlight-count">1 / ' + items.length + '</div>' +
      '<div class="spotlight-dots">' + items.map((_,i) =>
        '<button data-spotlight-index="' + i + '" class="' + (i===0 ? "active" : "") +
        '" aria-label="Go to trending anime ' + (i+1) + '"></button>').join("") + '</div></div>';
  }
  async function renderSection(key, page = 1) {
    const config = SECTIONS[key];
    if (!config) { navigate("/discover"); return; }
    const token = ++state.token;
    showLoading("Loading " + config.title + "…");
    try {
      const result = await getCollection(config.sort, page, config.ranked ? 25 : 24, config.extra);
      if (token !== state.token || state.route !== "/section") return;
      const items = result.media || [];
      const ranked = config.ranked;
      const listHtml = ranked
        ? '<div class="section-rank-list">' + items.map((media, index) =>
            '<button class="section-rank-item" data-anime="' + media.id + '">' +
            '<span class="section-rank-num">' + ((page - 1) * 25 + index + 1) + '</span>' +
            '<img src="' + escapeHtml(imageOf(media)) + '" loading="lazy" alt="">' +
            '<div><strong>' + escapeHtml(titleOf(media)) + '</strong><p>' +
              escapeHtml([animeSeasonBadge(media), media.format, mediaYear(media),
                media.episodes ? media.episodes + " episodes" : ""].filter(Boolean).join(" · ")) +
            '</p><span class="preview-stat">' + (media.averageScore ? "★ " + formatScore(media.averageScore) : "") +
            '</span></div>' + uiIcon("chevron-right") + '</button>'
          ).join("") + '</div>'
        : grid(items);
      $("#view").innerHTML =
        pageHead("EXPLORE ANIME", config.title, "A dedicated collection like the Android app",
          '<button class="btn btn-quiet" data-route="/home">' + uiIcon("chevron-left") + ' Back</button>') +
        listHtml + '<div class="section-pager">' +
        '<button class="btn btn-secondary" data-section-page="' + key + '" data-page="' + (page-1) +
          '"' + (page <= 1 ? " disabled" : "") + '>Previous</button>' +
        '<span>Page ' + page + '</span>' +
        '<button class="btn btn-primary" data-section-page="' + key + '" data-page="' + (page+1) +
          '"' + (!result.pageInfo?.hasNextPage ? " disabled" : "") + '>Show More</button></div>';
    } catch (error) {
      if (token !== state.token) return;
      $("#view").innerHTML = '<div class="empty-state"><h3>Could not load this section</h3><p>' +
        escapeHtml(error.message) + '</p><button class="btn btn-primary" data-route="/discover">Browse other sections</button></div>';
    }
  }

  async function renderHome() {
    const token = ++state.token;
    showLoading("Building your anime home…");
    try {
      const requests = [
        getCollection("TRENDING_DESC", 1, 18),
        getCollection("POPULARITY_DESC", 1, 18),
        getCollection("SCORE_DESC", 1, 18),
        getCollection("TRENDING_DESC", 1, 18, ", status: RELEASING"),
        getCollection("POPULARITY_DESC", 1, 18, ", status: NOT_YET_RELEASED"),
        getCollection("POPULARITY_DESC", 1, 18, ", format: MOVIE"),
        getCollection("SCORE_DESC", 1, 18, ", averageScore_greater: 75, popularity_lesser: 35000")
      ];
      const settled = await Promise.allSettled(requests);
      if (token !== state.token) return;
      const rows = settled.map(result => result.status === "fulfilled" && result.value && Array.isArray(result.value.media)
        ? result.value.media : []);
      const [trending, popular, top, airing, upcoming, movies, hidden] = rows;
      if (![...rows].some(list => list.length)) throw new Error("AniList did not return any anime sections. Please retry.");

      state.home = { trending, popular, top, airing, upcoming, movies, hidden };
      const spotlightItems = (trending.length ? trending : popular.length ? popular : top).slice(0, 10);
      state.spotlight = spotlightItems;
      state.spotlightIndex = 0;
      const continueItems = Object.values(store.history)
        .filter(item => item && item.media && item.episode)
        .sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 12);
      const watchlistItems = Object.values(store.watchlist).slice(0, 12);

      const quickLinks = '<div class="home-shortcuts">' +
        '<button data-route="/discover"><span>◈</span> Discover</button>' +
        '<button data-route="/search"><span>⌕</span> Search anime</button>' +
        '<button data-route="/library"><span>♡</span> My watchlist</button>' +
        '<button data-route="/account">' + uiIcon("user") + ' Account</button>' +
      '</div>';

      $("#view").innerHTML =
        '<section class="home-welcome native-home-header"><div id="home-profile-slot">' + profileGreetingMarkup() + '</div>' +
          '<div class="welcome-actions"><button data-route="/news" aria-label="Anime news">' + uiIcon("news") + '</button>' +
          '<button class="notification-button" data-route="/notifications" aria-label="Notifications">' + uiIcon("bell") + '<span class="news-badge" data-news-badge hidden></span></button>' +
          '<button data-route="/settings" aria-label="Settings">' + uiIcon("settings") + '</button></div></section>' +
        '<div class="trending-label">' + uiIcon("star") + ' Trending anime</div>' +
        spotlightPanel(spotlightItems) +
        quickLinks +
        newsPreview() +
        resumeShelf(continueItems) +
        shelf("Currently airing", "Fresh episodes from currently releasing series.", airing.slice(0, 14), sectionUrl("airing")) +
        shelf("Trending right now", "The series viewers are talking about.", trending.slice(0, 14), sectionUrl("trending")) +
        shelf("Popular with fans", "Big adventures, favourites and crowd-pleasers.", popular.slice(0, 14), sectionUrl("popular")) +
        (watchlistItems.length ? shelf("From your watchlist", "Saved anime, ready when you are.", watchlistItems, "/library") : '') +
        shelf("Coming soon", "Upcoming anime to add to your list.", upcoming.slice(0, 14), sectionUrl("upcoming")) +
        shelf("Anime movies", "Feature-length stories for your next movie night.", movies.slice(0, 14), sectionUrl("movies")) +
        shelf("Top rated", "Highly rated titles from the AniList catalogue.", top.slice(0, 14), sectionUrl("top")) +
        shelf("Hidden gems", "Well-rated series beyond the most popular charts.", hidden.slice(0, 14), sectionUrl("hidden"));
      scheduleSpotlight();
      updateNewsBadge();
      void loadNews();
    } catch (error) {
      if (token !== state.token) return;
      $("#view").innerHTML = '<div class="empty-state"><div class="empty-icon">◌</div><h3>Could not load the catalogue</h3><p>' + escapeHtml(error.message) + '</p><button class="btn btn-primary" data-route="/home">Try again</button></div>';
    }
  }


  async function renderDiscover() {
    const token = ++state.token;
    showLoading("Opening discovery…");
    try {
      const sort = state.discoverSort || "TRENDING_DESC";
      const data = await getCollection(sort, 1, 30);
      if (token !== state.token || state.route !== "/discover") return;
      state.discover = data.media || [];
      const options = [
        ["TRENDING_DESC", "Trending"], ["POPULARITY_DESC", "Most popular"], ["SCORE_DESC", "Top rated"]
      ];
      const home = state.home;
      const extraRows = (popular, upcoming) =>
        shelf("All Time Popular", "", popular, sectionUrl("popular")) +
        shelf("Upcoming Anime", "", upcoming, sectionUrl("upcoming"));
      $("#view").innerHTML =
        pageHead("", "Discover Anime", "Find your next favorite series") +
        '<button class="discover-search-launch" data-route="/search"><span>⌕</span>Search anime titles…</button>' +
        shelf(sort === "TRENDING_DESC" ? "Trending Now" : sort === "POPULARITY_DESC" ? "Most Popular" : "Top Rated", "", (data.media || []).slice(0, 14), sectionUrl(sort === "TRENDING_DESC" ? "trending" : sort === "POPULARITY_DESC" ? "popular" : "top")) +
        '<div id="discover-extras">' + (home ? extraRows(home.popular.slice(0, 12), home.upcoming.slice(0, 12)) : '') + '</div>' +
        '<section class="section"><div class="section-heading"><h2 class="section-title">Explore anime</h2></div>' +
        '<div class="toolbar"><select class="select-control" id="discover-sort">' + options.map(o =>
          '<option value="' + o[0] + '"' + (sort === o[0] ? " selected" : "") + '>' + o[1] + '</option>'
        ).join("") + '</select></div><div style="height:15px"></div>' +
        '<div id="discover-grid">' + grid(data.media || []) + '</div></section>';
      if (!home) {
        Promise.allSettled([
          getCollection("POPULARITY_DESC", 1, 14),
          getCollection("POPULARITY_DESC", 1, 14, ", status: NOT_YET_RELEASED")
        ]).then(rows => {
          if (token !== state.token || state.route !== "/discover") return;
          const popular = rows[0].status === "fulfilled" ? rows[0].value.media || [] : [];
          const upcoming = rows[1].status === "fulfilled" ? rows[1].value.media || [] : [];
          const container = $("#discover-extras");
          if (container) container.innerHTML = extraRows(popular, upcoming);
        }).catch(() => {});
      }
    } catch (error) {
      if (token !== state.token) return;
      $("#view").innerHTML = '<div class="empty-state"><h3>Catalogue unavailable</h3><p>' + escapeHtml(error.message) + '</p><button class="btn btn-primary" data-route="/discover">Retry</button></div>';
    }
  }

  async function renderSearch(term) {
    const token = ++state.token;
    state.searchTerm = term || "";
    $("#view").innerHTML = pageHead("SEARCH", "Search anime", "Search titles using the AniList catalogue.") +
      '<form id="search-form" class="search-box-large"><span>⌕</span><input id="search-page-input" value="' + escapeHtml(term || "") + '" placeholder="Try Naruto, Frieren, One Piece…" autocomplete="off"><button class="btn btn-primary" type="submit">Search</button></form>' +
      '<div id="search-results"><div class="empty-state"><div class="empty-icon">⌕</div><h3>What are you in the mood for?</h3><p>Enter an anime title to find matching entries.</p></div></div>';
    if (!term) return;
    try {
      const result = await searchAniList(term, 1);
      if (token !== state.token) return;
      state.search = result.media || [];
      $("#search-results").innerHTML = '<div class="section-heading"><div><h2 class="section-title">Results</h2><p class="section-note">' + state.search.length + ' matching titles</p></div></div>' + grid(state.search);
    } catch (error) {
      if (token !== state.token) return;
      $("#search-results").innerHTML = '<div class="empty-state"><h3>Search could not complete</h3><p>' + escapeHtml(error.message) + '</p></div>';
    }
    const input = $("#search-page-input");
    if (input) input.focus({ preventScroll: true });
  }


  const MANGA_FIELDS = [
    "id title { romaji english native } synonyms",
    "coverImage { extraLarge large medium } bannerImage format status chapters volumes",
    "genres averageScore popularity siteUrl isAdult",
    "description(asHtml: false) externalLinks { url site type language }"
  ].join(" ");
  const MANGA_SECTIONS = {
    trending: { title:"Trending Manga", sort:"TRENDING_DESC", extra:"" },
    popular: { title:"Popular Manga", sort:"POPULARITY_DESC", extra:"" },
    upcoming: { title:"Upcoming Manga", sort:"POPULARITY_DESC", extra:", status: NOT_YET_RELEASED" },
    top: { title:"Top Rated Manga", sort:"SCORE_DESC", extra:"" }
  };
  async function getMangaCollection(sort, page = 1, perPage = 20, extra = "", searchTerm = "") {
    if (searchTerm) {
      const query = "query ($search:String!,$page:Int!,$perPage:Int!){ Page(page:$page,perPage:$perPage){pageInfo{hasNextPage currentPage} media(type:MANGA,search:$search,sort:SEARCH_MATCH,isAdult:false){" + MANGA_FIELDS + "}}}";
      const data = await gql(query, { search:searchTerm, page, perPage });
      return data.Page;
    }
    const query = "query ($page:Int!,$perPage:Int!){ Page(page:$page,perPage:$perPage){pageInfo{hasNextPage currentPage} media(type:MANGA,sort:" +
      sort + ",isAdult:false" + extra + "){" + MANGA_FIELDS + "}}}";
    const data = await gql(query, { page, perPage });
    return data.Page;
  }
  function mangaGrid(items) {
    if (!items?.length) return '<div class="empty-state"><h3>No manga found</h3><p>Try a different category or search term.</p></div>';
    return '<div class="anime-grid">' + items.map(item => card(item, "MANGA")).join("") + '</div>';
  }
  function mangaShelf(title, rows, sectionKey) {
    if (!rows?.length) return "";
    return '<section class="section shelf-section"><div class="section-heading"><h2 class="section-title">' +
      escapeHtml(title) + '</h2><button class="section-link" data-route="/manga-section/' + sectionKey +
      '">View all ' + uiIcon("chevron-right") + '</button></div><div class="anime-shelf">' +
      rows.map(item => card(item, "MANGA")).join("") + '</div></section>';
  }

  function savedMangaShelf() {
    const entries = Object.values(store.mangaList || {}).filter(media => media?.id);
    if (!entries.length) return "";
    return '<section class="section"><div class="section-heading"><h2 class="section-title">Your Manga Library</h2>' +
      '<button class="section-link" data-route="/manga-library">View all ' + uiIcon("chevron-right") +
      '</button></div><div class="anime-shelf">' +
      entries.slice(0,12).map(media => card(media,"MANGA")).join("") + '</div></section>';
  }
  async function renderSavedManga() {
    const token = ++state.token;
    showLoading("Opening saved manga…");
    if (window.AniDashAccount?.authenticated()) {
      try {
        const entries = await window.AniDashAccount.listManga();
        for (const entry of entries) {
          if (entry?.media?.id && !store.mangaList[String(entry.media.id)]) {
            store.mangaList[String(entry.media.id)] = entry.media;
          }
        }
        if (entries.length) persist();
      } catch (error) { toast("Saved manga available locally; AniList refresh failed: " + error.message); }
    }
    if (token !== state.token || state.route !== "/manga-library") return;
    const items = Object.values(store.mangaList).filter(media => media?.id);
    $("#view").innerHTML = pageHead("", "Your Manga Library", "Saved locally and imported from AniList") +
      '<div class="account-actions"><button class="btn btn-secondary" data-route="/manga">' +
      uiIcon("chevron-left") + ' Discover manga</button><button class="btn btn-secondary" data-route="/downloads">' +
      uiIcon("download") + ' Offline downloads</button></div>' +
      (items.length ? mangaGrid(items) : '<div class="empty-state"><h3>No saved manga</h3>' +
      '<p>Save a manga from its details page or connect AniList to import your reading list.</p>' +
      '<button class="btn btn-primary" data-route="/manga">Browse manga</button></div>');
  }
  async function renderDownloads() {
    const token = ++state.token;
    showLoading("Loading offline downloads…");
    const files = await (window.AniDashStorage?.listMangaFiles?.() || Promise.resolve([]));
    if (token !== state.token || state.route !== "/downloads") return;
    const rows = files.map(info => '<div class="download-item"><div class="download-glyph">' +
      uiIcon("manga") + '</div><div class="download-details"><strong>' +
      escapeHtml(info.name) + '</strong><p>' + (info.size / 1048576).toFixed(1) +
      ' MB · Saved on this device</p></div><button class="btn btn-primary" data-read-offline="' +
      escapeHtml(info.id) + '">' + uiIcon("eye") + ' Read</button><button class="btn btn-quiet" ' +
      'data-remove-offline="' + escapeHtml(info.id) + '" aria-label="Delete offline manga ' +
      escapeHtml(info.name) + '">Remove</button></div>').join("");
    $("#view").innerHTML = pageHead("", "Downloads", "Your offline CBZ files, stored privately on this device") +
      '<div class="account-actions"><button class="btn btn-primary" data-open-cbz>' +
      uiIcon("download") + ' Import CBZ</button><button class="btn btn-secondary" data-route="/manga-library">' +
      uiIcon("manga") + ' Saved Manga</button></div>' +
      '<input id="cbz-file-input" type="file" accept=".cbz,application/zip" hidden>' +
      (files.length ? '<div class="download-list">' + rows + '</div>' :
      '<div class="empty-state"><h3>No offline manga yet</h3><p>Import a CBZ file you own. It can then be reopened without selecting it again.</p>' +
      '<button class="btn btn-secondary" data-open-cbz>Choose CBZ file</button></div>') +
      '<p class="official-read-note">Files stay in your browser’s IndexedDB and are not uploaded. Clearing site data can erase them, and available space depends on your browser.</p>';
  }
  async function renderManga(term = "") {
    const token = ++state.token;
    showLoading("Opening Manga Library…");
    const query = String(term || "").trim();
    try {
      const results = query
        ? await Promise.all([getMangaCollection("SEARCH_MATCH",1,24,"",query)])
        : await Promise.all([
          getMangaCollection("TRENDING_DESC",1,15),
          getMangaCollection("POPULARITY_DESC",1,15),
          getMangaCollection("POPULARITY_DESC",1,15,", status: NOT_YET_RELEASED")
        ]);
      if (token !== state.token || state.route !== "/manga") return;
      const rows = results.map(item => item?.media || []);
      $("#view").innerHTML = pageHead("", "Manga", "Discover manga, save reading lists and read CBZ files locally") +
        '<form id="manga-search-form" class="search-box-large">' + uiIcon("search") +
        '<input id="manga-search-input" autocomplete="off" aria-label="Search manga" placeholder="Search manga titles…" value="' +
        escapeHtml(query) + '"><button class="btn btn-primary" type="submit">Search</button></form>' +
        '<div class="manga-topline"><div class="feature-chip">' + uiIcon("manga") +
        ' AniList manga catalogue</div><div class="account-actions"><button class="btn btn-secondary" data-route="/manga-library">' +
        uiIcon("bookmark") + ' Saved</button><button class="btn btn-secondary" data-route="/downloads">' +
        uiIcon("download") + ' Downloads</button><button class="btn btn-secondary" data-open-cbz>' +
        uiIcon("manga") + ' Import CBZ</button></div></div>' +
        '<input id="cbz-file-input" type="file" accept=".cbz,application/zip" style="display:none">' +
        savedMangaShelf() +
        (query ? '<section class="section"><h2 class="section-title">Search results</h2>' + mangaGrid(rows[0]) + '</section>'
         : mangaShelf("Trending Manga",rows[0],"trending") +
           mangaShelf("All Time Popular",rows[1],"popular") +
           mangaShelf("Upcoming Manga",rows[2],"upcoming")) +
        '<p class="official-read-note">Read chapters through official publisher links when available. Local CBZ reading is supported for files you own.</p>';
    } catch (error) {
      if (token !== state.token) return;
      $("#view").innerHTML = '<div class="empty-state"><h3>Could not load manga</h3><p>' +
        escapeHtml(error.message) + '</p><button class="btn btn-primary" data-route="/manga">Retry</button></div>';
    }
  }
  async function renderMangaSection(sectionKey, page = 1) {
    const section = MANGA_SECTIONS[sectionKey];
    if (!section) { navigate("/manga"); return; }
    const token = ++state.token;
    showLoading("Loading " + section.title + "…");
    try {
      const result = await getMangaCollection(section.sort,page,24,section.extra);
      if (token !== state.token || state.route !== "/manga-section") return;
      $("#view").innerHTML = pageHead("MANGA",section.title,"Browse all titles in this collection",
        '<button class="btn btn-secondary" data-route="/manga">' + uiIcon("chevron-left") + ' Back to Manga</button>') +
        mangaGrid(result?.media || []) +
        '<div class="section-pager"><button class="btn btn-secondary" data-manga-section-page="' + sectionKey +
        '" data-page="' + (page-1) + '"' + (page<=1?" disabled":"") + '>Previous</button>' +
        '<span>Page ' + page + '</span><button class="btn btn-primary" data-manga-section-page="' +
        sectionKey + '" data-page="' + (page+1) + '"' +
        (!result.pageInfo?.hasNextPage?" disabled":"") + '>Next</button></div>';
    } catch (error) {
      if (token !== state.token) return;
      $("#view").innerHTML = '<div class="empty-state"><h3>Manga unavailable</h3><p>' +
      escapeHtml(error.message) + '</p></div>';
    }
  }
  async function renderMangaDetails(id) {
    const token = ++state.token;
    showLoading("Loading manga details…");
    try {
      const data = await gql("query ($id:Int!){Media(id:$id,type:MANGA){" + MANGA_FIELDS + "}}",{id:Number(id)});
      if (token !== state.token || state.route !== "/manga-detail") return;
      const media = data?.Media;
      if (!media) throw new Error("Manga not found");
      state.mangaDetail = media;
      const allowedDomains = ["mangaplus.shueisha.co.jp","viz.com","kodansha.us",
        "bookwalker.jp","global.bookwalker.jp","webtoons.com","mangaupdates.com",
        "comic-walker.com","yenpress.com","tapas.io","manga-up.com"];
      const official = (media.externalLinks || []).filter(link => {
        try {
          const url = new URL(link.url);
          return url.protocol === "https:" && allowedDomains.some(host => url.hostname === host || url.hostname.endsWith("." + host));
        } catch (_) {return false;}
      });
      const cover = imageOf(media);
      $("#view").innerHTML = '<div class="details-hero"><div class="details-banner" style="background-image:url(&quot;' +
        escapeHtml(media.bannerImage || cover) + '&quot;)"></div><div class="details-content">' +
        '<img class="details-poster" src="' + escapeHtml(cover) + '" alt="">' +
        '<div class="details-copy"><div class="eyebrow">MANGA DETAILS</div><h1 class="details-title">' +
        escapeHtml(titleOf(media)) + '</h1><div class="details-meta"><span class="meta-chip">' +
        escapeHtml(media.format || "Manga") + '</span><span class="meta-chip">' +
        escapeHtml(media.chapters ? media.chapters + " Chapters" : "Ongoing chapters") +
        '</span><span class="meta-chip">' + escapeHtml(media.status || "") +
        '</span></div><p class="manga-detail-description">' + escapeHtml(cleanText(media.description) || "No description available.") +
        '</p><div class="account-actions">' +
        (official.length ? official.slice(0,3).map(link =>
          '<a class="btn btn-primary" rel="noopener noreferrer" target="_blank" href="' + escapeHtml(link.url) +
          '">' + uiIcon("manga") + ' Read at ' + escapeHtml(link.site || "Publisher") + '</a>').join("") : '') +
        '<button class="btn btn-secondary" data-save-manga="' + media.id + '">' +
          uiIcon("bookmark") + ' Save to reading list</button>' +
        '<button class="btn btn-quiet" data-open-cbz>' + uiIcon("manga") + ' Open local CBZ</button>' +
        '<input id="cbz-file-input" type="file" accept=".cbz,application/zip" style="display:none"></div>' +
        '<p class="official-read-note">' + (official.length ?
          'Publisher links open the licensed reading site. Local CBZ files never leave your device.' :
          'No verified publisher chapter URL was listed by AniList; use a legitimate copy or open your own CBZ file.') +
        '</p></div></div></div>';
    } catch (error) {
      if (token !== state.token) return;
      $("#view").innerHTML = '<div class="empty-state"><h3>Manga details unavailable</h3><p>' +
        escapeHtml(error.message) + '</p><button class="btn btn-secondary" data-route="/manga">Back</button></div>';
    }
  }

  const BUILTIN_PROVIDERS = [
    { id: "justanime", name: "JustAnime", language: "SUB / DUB", description: "Momo, Zoko, Gigi and Neko servers" },
    { id: "hianime", name: "HiAnime", language: "SUB / DUB", description: "HiAnime API and AniList-mapped episode fallback" },
    { id: "anikoto", name: "AniKoto", language: "SUB / DUB", description: "AniKoto catalogue and Kwik stream extraction" }
  ];

  function currentProviders() {
    return BUILTIN_PROVIDERS;
  }

  async function loadProviders() {
    state.providers = BUILTIN_PROVIDERS;
    return state.providers;
  }


  async function providerGet(provider, action, values) {
    const params = new URLSearchParams({ action: action });
    Object.entries(values || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), action === "streams" ? 9500 : 8000);
    // Node's test runner should not be held open by an intentionally stalled upstream.
    if (timeout && typeof timeout.unref === "function") timeout.unref();
    try {
      const response = await fetch("/api/" + encodeURIComponent(provider.id) + "?" + params.toString(), {
        method: "GET",
        headers: { "Accept": "application/json" },
        cache: action === "streams" ? "no-store" : "default",
        signal: controller.signal
      });
      let payload;
      try { payload = await response.json(); }
      catch (_) { throw new Error(provider.name + " returned an invalid response."); }
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error || (provider.name + " returned HTTP " + response.status));
      }
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(provider.name + " did not respond in time.");
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function extractArray(payload, names) {
    if (Array.isArray(payload)) return payload;
    const candidates = names || ["results", "items", "list", "episodes", "sources", "data"];
    for (const candidate of candidates) {
      const value = String(candidate).split(".").reduce((current, key) => current && current[key], payload);
      if (Array.isArray(value)) return value;
      if (payload && payload.data && Array.isArray(payload.data[candidate])) return payload.data[candidate];
      if (payload && payload.result && Array.isArray(payload.result[candidate])) return payload.result[candidate];
    }
    if (payload && Array.isArray(payload.data)) return payload.data;
    if (payload && payload.data && Array.isArray(payload.data.episodes)) return payload.data.episodes;
    return [];
  }

  function normaliseResult(item) {
    const title = item.title || item.name || item.animeTitle || item.jname || "Unknown";
    return {
      id: item.id || item.animeId || item.session || item.slug || item.url || item.link,
      title: typeof title === "string" ? title : (title.english || title.romaji || title.native || "Unknown"),
      image: item.image || item.cover || item.poster || item.imageUrl || item.thumbnail || "",
      raw: item
    };
  }

  function titleMatchScore(a, b) {
    const x = slug(a);
    const y = slug(b);
    if (!x || !y) return 0;
    if (x === y) return 100;
    if (x.includes(y) || y.includes(x)) return 80;
    const xs = new Set(x.split(" "));
    const ys = new Set(y.split(" "));
    let overlap = 0;
    xs.forEach(word => { if (ys.has(word)) overlap++; });
    return Math.round((overlap / Math.max(xs.size, ys.size)) * 65);
  }

  async function findProviderMatches(media) {
    const providers = await loadProviders();
    const rawTitles = media && media.title ? [
      media.title.english,
      media.title.romaji,
      media.title.native,
      titleOf(media)
    ] : [titleOf(media)];
    const terms = [...new Set(rawTitles.map(value => String(value || "").trim()).filter(Boolean))].slice(0, 3);
    const found = await Promise.all(providers.map(async provider => {
      if (provider.id === "justanime" && media && media.id != null) {
        return {
          provider,
          animeId: String(media.id),
          item: { id: String(media.id), title: titleOf(media) },
          score: 100,
          mapped: true,
          idSource: "AniList"
        };
      }
      try {
        const payloads = await Promise.all(terms.map(query => providerGet(provider, "search", {
          query: query,
          page: 1,
          anilistId: media.id,
          malId: media.idMal,
          title: titleOf(media)
        }).catch(() => null)));
        const results = payloads.flatMap(payload =>
          extractArray(payload, ["results", "items", "list", "anime", "data"])
        ).map(normaliseResult).filter(item => item.id);
        const unique = new Map();
        results.forEach(item => {
          const key = String(item.id);
          if (!unique.has(key)) unique.set(key, item);
        });
        const best = [...unique.values()].map(item => ({
          item,
          score: Math.max(...rawTitles.map(title => titleMatchScore(title, item.title)))
        })).sort((a, b) => b.score - a.score)[0];
        return best && best.score >= 45
          ? { provider, animeId: String(best.item.id), item: best.item, score: best.score }
          : { provider, error: "No confident title match was found.", score: 0 };
      } catch (error) {
        return { provider, error: error.message, score: 0 };
      }
    }));
    return found;
  }

  async function episodesFromMatch(match, media) {
    if (!match || !match.provider) return [];
    const payload = await providerGet(match.provider, "episodes", {
      id: match.animeId,
      anilistId: media.id,
      malId: media.idMal,
      title: titleOf(media),
      page: 1
    });
    const list = extractArray(payload, ["episodes", "items", "results", "list", "data"]);
    return list.map((item, index) => {
      const number = Number(item.number || item.episode || item.episodeNumber || index + 1);
      return {
        id: String(item.id || item.episodeId || item.url || number),
        number: number,
        title: item.title || item.name || "Episode " + number,
        thumbnail: item.thumbnail || item.image || item.snapshot || "",
        date: item.date || item.airDate || item.aired || "",
        isFiller: item.isFiller === true || item.filler === true || item.filler === 1,
        raw: item
      };
    }).filter(item => Number.isFinite(item.number) && item.number > 0)
      .sort((a, b) => a.number - b.number);
  }

  function generatedEpisodes(media) {
    // Ongoing series often have no AniList 'episodes' total; the next-airing
    // episode supplies a better count for a quick-access list.
    const declared = Number(media?.episodes || 0);
    const nextAiring = Number(media?.nextAiringEpisode?.episode || 0) - 1;
    const known = Math.max(declared, nextAiring, 0);
    // Without a known count, expose only a small, explicitly provisional set
    // rather than showing an empty episode page while sources are checked.
    const total = known || 30;
    const limit = Math.min(total, 3000);
    return Array.from({ length: limit }, (_, index) => ({
      id: String(index + 1), number: index + 1, title: "Episode " + (index + 1),
      thumbnail: "", date: "", isFiller: false, generated: true
    }));
  }

  const DETAIL_EPISODES_PER_PAGE = 50;
  const PLAYER_EPISODES_PER_PAGE = 30;

  function matchingEpisodes(items, query) {
    const term = slug(query || "");
    if (!term) return items || [];
    return (items || []).filter(item =>
      slug(String(item.number) + " " + String(item.title || "")).includes(term)
    );
  }

  function episodePagerMarkup(total, page, pageSize, scope) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const first = total ? ((page - 1) * pageSize) + 1 : 0;
    const last = Math.min(total, page * pageSize);
    const previousDisabled = page <= 1 ? " disabled" : "";
    const nextDisabled = page >= pages ? " disabled" : "";
    return '<div class="episode-pagination">' +
      '<span class="episode-range">' + (total ? (first + "–" + last + " of " + total + " episodes") : "No episodes found") + '</span>' +
      '<div class="episode-page-actions">' +
        '<button class="btn btn-quiet" data-episode-page="first" data-episode-scope="' + scope + '"' + previousDisabled + '>«</button>' +
        '<button class="btn btn-quiet" data-episode-page="prev" data-episode-scope="' + scope + '"' + previousDisabled + '>Prev</button>' +
        '<span class="episode-page-label">Page ' + page + ' / ' + pages + '</span>' +
        '<button class="btn btn-quiet" data-episode-page="next" data-episode-scope="' + scope + '"' + nextDisabled + '>Next</button>' +
        '<button class="btn btn-quiet" data-episode-page="last" data-episode-scope="' + scope + '"' + nextDisabled + '>»</button>' +
      '</div></div>';
  }

  function renderEpisodeBrowser() {
    const container = $("#episode-list");
    const pagination = $("#episode-pagination");
    if (!container || !pagination) return;
    const filtered = matchingEpisodes(state.detailEpisodes, state.episodeFilter);
    const pageCount = Math.max(1, Math.ceil(filtered.length / DETAIL_EPISODES_PER_PAGE));
    state.episodePage = Math.max(1, Math.min(pageCount, Number(state.episodePage) || 1));
    const start = (state.episodePage - 1) * DETAIL_EPISODES_PER_PAGE;
    container.innerHTML = filtered.slice(start, start + DETAIL_EPISODES_PER_PAGE).map(episodeCard).join("") ||
      '<div class="empty-state compact-empty">No matching episodes. Try another episode number or title.</div>';
    pagination.innerHTML = episodePagerMarkup(filtered.length, state.episodePage, DETAIL_EPISODES_PER_PAGE, "detail");
  }

  function renderPlayerEpisodeBrowser() {
    const container = $("#player-episode-items");
    const pagination = $("#player-episode-pagination");
    if (!container || !pagination || !state.player) return;
    const filtered = matchingEpisodes(state.detailEpisodes, state.playerEpisodeFilter);
    const pageCount = Math.max(1, Math.ceil(filtered.length / PLAYER_EPISODES_PER_PAGE));
    state.playerEpisodePage = Math.max(1, Math.min(pageCount, Number(state.playerEpisodePage) || 1));
    const start = (state.playerEpisodePage - 1) * PLAYER_EPISODES_PER_PAGE;
    container.innerHTML = filtered.slice(start, start + PLAYER_EPISODES_PER_PAGE).map(episode =>
      '<button class="player-episode' + (Number(episode.number) === Number(state.player.episode.number) ? " active" : "") +
      '" data-player-episode="' + episode.number + '"><span class="player-episode-number">' + episode.number + '</span>' +
      (episode.thumbnail ? '<img class="player-episode-thumb" src="' + escapeHtml(episode.thumbnail) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') +
      '<span class="player-episode-title">' + escapeHtml(episode.title || ("Episode " + episode.number)) + '</span></button>'
    ).join("") || '<div class="compact-empty">No matching episodes.</div>';
    pagination.innerHTML = episodePagerMarkup(filtered.length, state.playerEpisodePage, PLAYER_EPISODES_PER_PAGE, "player");
  }

  function jumpToEpisode(scope) {
    const input = scope === "player" ? $("#player-episode-jump") : $("#episode-jump");
    const query = input ? Number.parseInt(input.value, 10) : Number.NaN;
    if (!Number.isFinite(query) || query < 1) {
      toast("Enter a valid episode number.");
      return;
    }
    const filtered = matchingEpisodes(
      state.detailEpisodes,
      scope === "player" ? state.playerEpisodeFilter : state.episodeFilter
    );
    const index = filtered.findIndex(item => Number(item.number) === query);
    if (index < 0) {
      toast("Episode " + query + " was not found in the current source list.");
      return;
    }
    if (scope === "player") {
      state.playerEpisodePage = Math.floor(index / PLAYER_EPISODES_PER_PAGE) + 1;
      renderPlayerEpisodeBrowser();
    } else {
      state.episodePage = Math.floor(index / DETAIL_EPISODES_PER_PAGE) + 1;
      renderEpisodeBrowser();
    }
  }

  async function prepareMediaSources(media) {
    const matches = await findProviderMatches(media);

    // JustAnime's native Android provider uses AniList IDs as its anime IDs.
    // Searching can miss a title even when the direct numeric ID is valid.
    const justAnime = BUILTIN_PROVIDERS.find(provider => provider.id === "justanime");
    const hasJustAnimeMatch = matches.some(match => match.provider.id === "justanime" && !match.error);
    if (justAnime && !hasJustAnimeMatch && media.id != null) {
      matches.unshift({
        provider: justAnime,
        animeId: String(media.id),
        item: { id: String(media.id), title: titleOf(media) },
        score: 0,
        mapped: true,
        idSource: "AniList"
      });
    }

    // Fetch each built-in provider's own episode IDs. Keeping the episode
    // object on the match is essential: AniKoto uses session IDs, HiAnime uses
    // episode IDs/query IDs, and JustAnime uses episode numbers.
    const checked = await Promise.all(matches.map(async match => {
      if (!match || !match.provider || match.error) return match;
      try {
        const episodes = await episodesFromMatch(match, media);
        if (!episodes.length) {
          return { ...match, error: "The provider returned no episodes.", episodes: [] };
        }
        return { ...match, episodes, episodesReady: true };
      } catch (error) {
        return { ...match, error: "Episode lookup failed: " + error.message, episodes: [] };
      }
    }));

    // Use AniList/AniZip episode numbers independently for each provider.
    // JustAnime and VidNest accept AniList IDs + episode numbers, so they do not
    // need the legacy provider's own episode session IDs to attempt playback.
    const hasReadyProvider = providerId => checked.some(match =>
      match && match.provider?.id === providerId && match.episodesReady === true &&
      Array.isArray(match.episodes) && match.episodes.length > 0
    );

    let aniListMappedEpisodes = [];
    const validAniListId = media.id != null && /^\d{1,12}$/.test(String(media.id));
    if (validAniListId) {
      try {
        const response = await fetch("/api/episode-map?anilistId=" + encodeURIComponent(String(media.id)), {
          headers: { Accept: "application/json" },
          cache: "default"
        });
        const payload = await response.json();
        aniListMappedEpisodes = response.ok && Array.isArray(payload?.episodes)
          ? payload.episodes.map(item => ({
              id: String(item.id || item.number),
              number: Number(item.number),
              title: item.title || "Episode " + item.number,
              thumbnail: item.thumbnail || "",
              date: item.date || "",
              isFiller: item.isFiller === true,
              mapped: true,
              raw: item
            })).filter(item => Number.isFinite(item.number) && item.number > 0)
              .sort((a, b) => a.number - b.number)
          : [];
      } catch (_) {
        aniListMappedEpisodes = [];
      }
    }

    // Combine authoritative Ani.zip titles/thumbnails with source-specific
    // episode IDs so metadata improvements never break playback.
    if (aniListMappedEpisodes.length) {
      const byNumber = new Map(aniListMappedEpisodes.map(item => [Number(item.number), item]));
      for (const match of checked) {
        if (!match || !Array.isArray(match.episodes)) continue;
        match.episodes = match.episodes.map(item => {
          const known = byNumber.get(Number(item.number));
          if (!known) return item;
          const generic = /^(?:episode|ep)\s*#?\d+$/i.test(String(item.title || "").trim());
          return { ...item, title: generic || !item.title ? known.title : item.title,
            thumbnail: item.thumbnail || known.thumbnail, date: item.date || known.date };
        });
      }
      const history = store.history[String(media.id)];
      const matched = history && byNumber.get(Number(history.episode));
      if (matched && /^(?:episode|ep)\s*#?\d+$/i.test(String(history.episodeTitle || ""))) {
        history.episodeTitle = matched.title; persist();
      }
    }
    // If AniZip is down but AniList knows the total count, create episode-number
    // candidates. These IDs are valid for the AniList-based JustAnime/VidNest
    // resolver and for AniKoto's external-ID embed providers.
    const fallbackEpisodeNumbers = aniListMappedEpisodes.length
      ? aniListMappedEpisodes
      : generatedEpisodes(media);

    for (const providerId of ["justanime", "hianime"]) {
      if (hasReadyProvider(providerId) || !validAniListId || !fallbackEpisodeNumbers.length) continue;
      const provider = BUILTIN_PROVIDERS.find(item => item.id === providerId);
      if (!provider) continue;
      const mappedMatch = {
        provider,
        animeId: String(media.id),
        item: { id: String(media.id), title: titleOf(media) },
        score: 0,
        mapped: true,
        mappingOnly: true,
        idSource: "AniList",
        episodes: fallbackEpisodeNumbers.map(item => ({
          ...item,
          id: String(item.number)
        })),
        episodesReady: true
      };
      const existingIndex = checked.findIndex(match => match?.provider?.id === providerId);
      if (existingIndex >= 0) checked[existingIndex] = mappedMatch;
      else checked.push(mappedMatch);
    }

    // If AniKoto's catalogue session lookup fails, keep an AniList/MAL-mapped
    // entry so its direct iframe providers can still be attempted.
    const hasAniKoto = hasReadyProvider("anikoto");
    const episodeSource = checked.find(match =>
      match && match.episodesReady && Array.isArray(match.episodes) && match.episodes.length
    );
    const mappedEpisodes = episodeSource
      ? episodeSource.episodes.map(item => ({ ...item, id: String(item.number) }))
      : fallbackEpisodeNumbers;
    const anikoto = BUILTIN_PROVIDERS.find(provider => provider.id === "anikoto");
    if (!hasAniKoto && anikoto && mappedEpisodes.length && (validAniListId || media.idMal != null)) {
      const anikotoMatch = {
        provider: anikoto,
        animeId: String(media.id || media.idMal),
        item: { id: String(media.id || media.idMal), title: titleOf(media) },
        score: 0,
        mapped: true,
        mappingOnly: true,
        embedOnly: true,
        idSource: "AniList/MAL",
        episodes: mappedEpisodes,
        episodesReady: true
      };
      const existingIndex = checked.findIndex(match => match?.provider?.id === "anikoto");
      if (existingIndex >= 0) checked[existingIndex] = anikotoMatch;
      else checked.push(anikotoMatch);
    }

    const order = { justanime: 0, hianime: 1, anikoto: 2 };
    checked.sort((a, b) => (order[a.provider?.id] ?? 9) - (order[b.provider?.id] ?? 9));
    const selected = checked.find(match => match && match.episodesReady) || null;
    return { matches: checked, selected, episodes: selected ? selected.episodes : [] };
  }


  const preparedSourceCache = new Map();
  const preparedSourcePending = new Map();

  // Show real AniList episode numbers immediately, and resolve provider-specific
  // IDs in the background. These numbers are NOT a claim that a stream exists.
  function instantMediaSources(media, requestedEpisode) {
    const episodes = generatedEpisodes(media);
    const requested = Number(requestedEpisode);
    if (!episodes.length && Number.isInteger(requested) && requested > 0) {
      episodes.push({
        id: String(requested), number: requested, title: "Episode " + requested,
        thumbnail: "", generated: true
      });
    }
    if (!episodes.length || media.id == null) {
      return { matches: [], selected: null, episodes };
    }
    const matches = BUILTIN_PROVIDERS.map(provider => ({
      provider,
      animeId: String(media.id),
      item: { id: String(media.id), title: titleOf(media) },
      mapped: true,
      mappingOnly: true,
      embedOnly: provider.id === "anikoto",
      provisional: true,
      episodes: episodes.map(item => ({ ...item, id: String(item.number) })),
      episodesReady: true
    }));
    return { matches, selected: matches[0], episodes };
  }

  async function getPreparedMediaSources(media, force) {
    const key = String(media.id);
    if (!force && preparedSourceCache.has(key)) return preparedSourceCache.get(key);
    if (preparedSourcePending.has(key)) return preparedSourcePending.get(key);
    const request = prepareMediaSources(media).then(prepared => {
      if (prepared.selected && prepared.episodes.length) preparedSourceCache.set(key, prepared);
      return prepared;
    }).finally(() => preparedSourcePending.delete(key));
    preparedSourcePending.set(key, request);
    return request;
  }

  function applyPreparedSources(prepared, preferredProviderId) {
    state.detailMatches = prepared.matches;
    state.selectedMatch = prepared.matches.find(match =>
      match && match.episodesReady && match.provider.id === preferredProviderId
    ) || prepared.selected;
    state.detailEpisodes = (state.selectedMatch && state.selectedMatch.episodes && state.selectedMatch.episodes.length
      ? state.selectedMatch.episodes : prepared.episodes);
    if (!state.detailEpisodes.length && state.detail) state.detailEpisodes = generatedEpisodes(state.detail);
  }

  async function renderAnime(id) {
    const token = ++state.token;
    state.detail = null;
    state.detailMatches = [];
    state.detailEpisodes = [];
    state.selectedMatch = null;
    state.episodePage = 1;
    state.episodeFilter = "";
    showLoading("Opening anime…");
    try {
      const media = await getAnime(id);
      if (token !== state.token || state.route !== "/anime") return;
      state.detail = media;

      // Do not block the entire screen with a provider search spinner.
      const ready = preparedSourceCache.get(String(media.id)) || instantMediaSources(media);
      applyPreparedSources(ready);
      paintAnimeDetails(media);

      if (!preparedSourceCache.has(String(media.id))) {
        getPreparedMediaSources(media).then(prepared => {
          if (token !== state.token || state.route !== "/anime" || state.detail?.id !== media.id) return;
          const preferred = state.selectedMatch?.provider?.id;
          applyPreparedSources(prepared, preferred);
          paintAnimeDetails(media);
        }).catch(error => {
          if (token === state.token && state.route === "/anime") {
            toast("Some streaming sources are unavailable. You can still try an episode.");
          }
        });
      }
    } catch (error) {
      if (token !== state.token) return;
      $("#view").innerHTML = '<div class="empty-state"><h3>Anime details unavailable</h3><p>' + escapeHtml(error.message) + '</p><button class="btn btn-primary" data-route="/home">Back home</button></div>';
    }
  }

  function isInWatchlist(id) {
    return !!store.watchlist[String(id)];
  }

  function paintAnimeDetails(media) {
    const banner = media.bannerImage || imageOf(media);
    const genres = (media.genres || []).slice(0, 10);
    const watched = isInWatchlist(media.id);
    const matches = state.detailMatches.filter(match => !match.error);
    const sourceInfo = "Episode numbers come from the anime catalogue. Playback is checked when an episode opens.";
    const episodes = state.detailEpisodes || [];
    const relationItems = media.relations && media.relations.edges ? media.relations.edges.filter(edge => edge.node && edge.node.type === "ANIME").slice(0, 6) : [];
    const malLink = media.idMal ? '<a href="https://myanimelist.net/anime/' + media.idMal + '" target="_blank" rel="noopener">MyAnimeList ↗</a>' : "Not mapped";
    $("#view").innerHTML =
      '<div class="details-hero"><div class="details-banner" style="background-image:url(&quot;' + escapeHtml(banner) + '&quot;)"></div><div class="details-content">' +
        '<img class="details-poster" src="' + escapeHtml(imageOf(media)) + '" alt="' + escapeHtml(titleOf(media)) + '">' +
        '<div class="details-copy"><div class="eyebrow">ANIME DETAILS</div><h1 class="details-title">' + escapeHtml(titleOf(media)) + '</h1>' +
          '<div class="details-native">' + escapeHtml(media.title && (media.title.romaji || media.title.native) || "") + '</div>' +
          '<div class="details-meta"><span class="meta-chip">★ ' + formatScore(media.averageScore) + '</span><span class="meta-chip">' + escapeHtml(media.format || "Anime") + '</span><span class="meta-chip">' + escapeHtml(media.status || "Unknown") + '</span><span class="meta-chip">' + escapeHtml(media.episodes ? media.episodes + " episodes" : "Episode count unknown") + '</span><span class="meta-chip">' + escapeHtml(mediaYear(media)) + '</span></div>' +
          '<p class="details-description">' + escapeHtml(cleanText(media.description) || "No synopsis is available for this title yet.") + '</p>' +
          '<div class="button-row"><button class="btn btn-primary" data-play-first="' + media.id + '" ' + (episodes.length ? "" : "disabled") + '>▶ Start watching</button><button class="btn btn-secondary" data-watchlist="' + media.id + '">' + (watched ? "✓ In watchlist" : "♡ Add to watchlist") + '</button></div>' +
        '</div></div></div>' +
      '<div class="details-layout"><section class="content-panel"><div class="section-heading"><div><h2 class="panel-title">Episodes</h2><p class="section-note">' + (matches.length ? escapeHtml(sourceInfo) : "Open an episode to check available streams.") + '</p></div><span class="watchlist-badge">' + episodes.length + ' listed</span></div>' +
        '<div class="episode-toolbar"><input id="episode-filter" class="input-control" style="max-width:180px" placeholder="Search episodes…"><input id="episode-jump" class="input-control episode-jump-input" type="number" min="1" placeholder="EP #"><button class="btn btn-quiet" data-episode-go="detail">Go</button><button class="btn btn-quiet" data-refresh-sources>Retry sources</button></div>' +
        '<div id="episode-list" class="episode-list"></div><div id="episode-pagination"></div>' +
        (!episodes.length ? '<div class="notice" style="margin-top:14px">No episodes are listed yet. Refresh the episode list.</div>' : '') +
        '</section><aside class="content-panel"><h2 class="panel-title">About this anime</h2><div class="info-list">' +
        infoRow("Genres", genres.length ? genres.join(", ") : "Not listed") +
        infoRow("Season", [media.season, media.seasonYear].filter(Boolean).join(" ") || "Not listed") +
        infoRow("Studios", media.studios && media.studios.nodes.length ? media.studios.nodes.map(studio => studio.name).join(", ") : "Not listed") +
        infoRow("MyAnimeList", malLink) +
        infoRow("AniList", '<a href="https://anilist.co/anime/' + media.id + '" target="_blank" rel="noopener">Open AniList ↗</a>') +
        infoRow("Playback", "Streams are checked when an episode opens") +
      '</div></aside></div>' +
      (relationItems.length ? '<section class="section" style="margin-top:28px"><div class="section-heading"><div><h2 class="section-title">Related anime</h2></div></div><div class="anime-grid">' + relationItems.map(edge => relationCard(edge.node)).join("") + '</div></section>' : '');
    renderEpisodeBrowser();
  }

  function relationCard(item) {
    const poster = item.coverImage && item.coverImage.large || "";
    return '<article class="anime-card" data-anime="' + item.id + '" tabindex="0"><div class="poster-wrap">' + (poster ? '<img loading="lazy" src="' + escapeHtml(poster) + '" alt="' + escapeHtml(item.title && (item.title.english || item.title.romaji) || "Related anime") + '">' : '<div class="poster-fallback">Related anime</div>') + '</div><div class="card-title">' + escapeHtml(item.title && (item.title.english || item.title.romaji) || "Related anime") + '</div><p class="card-subtitle">Related title</p></article>';
  }

  function infoRow(label, value) {
    return '<div class="info-row"><div class="info-label">' + escapeHtml(label) + '</div><div class="info-value">' + value + '</div></div>';
  }

  function episodeCard(episode) {
    const thumb = episode.thumbnail ? '<img class="episode-thumb" loading="lazy" referrerpolicy="no-referrer" src="' + escapeHtml(episode.thumbnail) + '" alt="Episode ' + escapeHtml(episode.number) + ' still">' : '<div class="episode-thumb episode-thumb-fallback"><span>' + escapeHtml(episode.number) + '</span></div>';
    return '<button class="episode-item" data-play-episode="' + escapeHtml(episode.number) + '|' + escapeHtml(episode.id) + '">' + thumb +
      '<span><span class="episode-number">EPISODE ' + escapeHtml(episode.number) + (episode.isFiller ? ' · FILLER' : '') + '</span><span class="episode-name">' + escapeHtml(episode.title) + '</span><span class="episode-date">' + escapeHtml(episode.date || (episode.generated ? "Episode metadata fallback" : "")) + '</span></span><span class="episode-play">›</span></button>';
  }

  async function selectDetailProvider(index) {
    if (!state.detail) return;
    const match = state.detailMatches.filter(item => !item.error)[Number(index)];
    if (!match) return;
    try {
      const episodes = match.episodesReady && match.episodes
        ? match.episodes
        : await episodesFromMatch(match, state.detail);
      if (!episodes.length) throw new Error("The provider returned no episodes.");
      match.episodes = episodes;
      match.episodesReady = true;
      state.selectedMatch = match;
      state.detailEpisodes = episodes;
      state.episodePage = 1;
      state.episodeFilter = "";
      paintAnimeDetails(state.detail);
    } catch (error) {
      toast("Source unavailable: " + error.message);
      paintAnimeDetails(state.detail);
    }
  }

  function findLocalMedia(id) {
    const key = String(id);
    if (state.detail && String(state.detail.id) === key) return state.detail;
    for (const collection of [
      state.home && Object.values(state.home).flat(),
      state.discover,
      state.search,
      Object.values(store.watchlist),
      Object.values(store.history).map(entry => entry.media)
    ]) {
      const match = (collection || []).find(item => item && String(item.id) === key);
      if (match) return match;
    }
    return null;
  }

  function importCloudPosition(media, entry, source) {
    if (!media?.id || !entry) return;
    const key = String(media.id);
    let episode, seconds, duration, updatedAt;
    if (source === "ANILIST") {
      const resumed = window.AniDashAccount?.resumeFromEntry(entry, Number(media.episodes || 0));
      if (!resumed) return;
      ({ episode, seconds, duration, updatedAt } = resumed);
    } else {
      const watched = Number(entry?.list_status?.num_episodes_watched || 0);
      episode = Math.max(1, watched + 1);
      seconds = 0;
      duration = 0;
      updatedAt = 0;
    }
    if (!Number.isSafeInteger(episode) || episode < 1) return;
    const local = store.history[key];
    // Avoid overwriting a newer partial locally with an older cloud update.
    if (local && Number(local.episode) > Number(episode)) return;
    if (local && Number(local.episode) === Number(episode) &&
        Number(local.position || 0) > Number(seconds || 0) &&
        Number(local.updatedAt || 0) > Number(updatedAt || 0)) return;
    store.history[key] = {
      media: {
        id: media.id, idMal: media.idMal, title: media.title, coverImage: media.coverImage,
        bannerImage: media.bannerImage, format: media.format, status: media.status,
        episodes: media.episodes, averageScore: media.averageScore, seasonYear: media.seasonYear
      },
      episode, episodeTitle: "Episode " + episode,
      position: seconds || 0, duration: duration || 0,
      updatedAt: updatedAt || 0,
      syncedFrom: source
    };
  }
  async function syncAniListLibrary() {
    const account = window.AniDashAccount;
    if (!account?.authenticated()) return null;
    try {
      const cloudEntries = await account.list();
      for (const entry of cloudEntries) {
        const id = String(entry.mediaId);
        if (!entry.media) continue;
        store.libraryStatuses[id] = entry.status || "PLANNING";
        if (!store.hiddenCloudEntries[id] && !store.watchlist[id]) store.watchlist[id] = entry.media;
        if (entry.status === "CURRENT" || entry.status === "REPEATING") {
          importCloudPosition(entry.media, entry, "ANILIST");
        }
      }
      const [favoritesResult, mangaResult] = await Promise.allSettled([
        account.favorites(), account.listManga()
      ]);
      if (favoritesResult.status === "fulfilled") {
        for (const id of favoritesResult.value) store.localFavorites[String(id)] = true;
      }
      if (mangaResult.status === "fulfilled") {
        for (const entry of mangaResult.value) {
          if (entry?.media?.id && !store.mangaList[String(entry.media.id)]) {
            store.mangaList[String(entry.media.id)] = entry.media;
          }
        }
      }
      persist();
      if (state.route === "/library") renderLibrary();
      if (state.route === "/history") renderHistory();
      if (state.route === "/account") renderAccount();
      if (state.route === "/home") renderHome();
      return cloudEntries;
    } catch (error) {
      toast("AniList sync unavailable: " + error.message);
      return null;
    }
  }
  async function syncMalLibrary() {
    const mal = window.AniDashMal;
    if (!mal?.authenticated()) return null;
    try {
      const remote = await mal.list();
      const mapped = [];
      const ids = [...new Set(remote.map(item => Number(item?.node?.id)).filter(Number.isSafeInteger))];
      for (let i = 0; i < ids.length; i += 40) {
        const data = await gql("query ($ids:[Int]) { Page(perPage:50) { media(type:ANIME,idMal_in:$ids) { " +
          MEDIA_FIELDS + " } } }", { ids: ids.slice(i,i+40) });
        mapped.push(...(data?.Page?.media || []));
      }
      const byMalId = new Map(mapped.map(media => [Number(media.idMal), media]));
      state.malEntries = remote;
      const statuses = { watching:"CURRENT",completed:"COMPLETED",on_hold:"PAUSED",
        dropped:"DROPPED",plan_to_watch:"PLANNING" };
      for (const entry of remote) {
        const media = byMalId.get(Number(entry?.node?.id));
        if (!media) continue; // Unmapped MAL entries remain accessible on MAL's own website.
        const key = String(media.id);
        const status = statuses[entry?.list_status?.status] || "PLANNING";
        store.malStatuses[key] = status;
        if (!window.AniDashAccount?.getEntry(media.id)) store.libraryStatuses[key] = status;
        if (!store.hiddenCloudEntries[key] && !store.watchlist[key]) store.watchlist[key] = media;
        if (status === "CURRENT" && !window.AniDashAccount?.getEntry(media.id)) {
          importCloudPosition(media, entry, "MAL");
        }
      }
      persist();
      if (state.route === "/library") renderLibrary();
      if (state.route === "/history") renderHistory();
      if (state.route === "/account") renderAccount();
      if (state.route === "/home") renderHome();
      return remote;
    } catch (error) {
      toast("MyAnimeList sync unavailable: " + error.message);
      return null;
    }
  }

  async function toggleWatchlist(id) {
    const key = String(id);
    const account = window.AniDashAccount;
    if (store.watchlist[key]) {
      delete store.watchlist[key];
      delete store.libraryStatuses[key];
      delete store.localFavorites[key];
      store.hiddenCloudEntries[key] = true;
      persist();
      toast("Removed from this device's watchlist.");
      if (account?.authenticated() && account.getEntry(id)?.status === "PLANNING") {
        if (confirm("Also remove this title from your AniList Planning list?")) {
          account.deletePlanning(id).then(ok => {
            if (ok) toast("Removed from AniList as well.");
          }).catch(error => toast("AniList removal failed: " + error.message));
        }
      }
    } else {
      const media = findLocalMedia(id) || await getAnime(id).catch(() => null);
      if (!media) {
        toast("Could not save this title. Try again.");
        return;
      }
      store.watchlist[key] = media;
      store.libraryStatuses[key] = "PLANNING";
      delete store.hiddenCloudEntries[key];
      persist();
      toast("Added to your watchlist and saved on this device.");
      if (account?.authenticated()) {
        account.saveToList(Number(key), "PLANNING").then(() => {
          toast("Watchlist synced to AniList.");
        }).catch(error => {
          toast("Saved locally; AniList sync failed: " + error.message);
        });
      }
    }
    if (state.detail && String(state.detail.id) === key && state.route === "/anime") paintAnimeDetails(state.detail);
    if (state.route === "/library") renderLibrary();
  }

  async function startEpisode(number, episodeId) {
    if (!state.detail) return;
    const episode = state.detailEpisodes.find(item => Number(item.number) === Number(number)) || {
      id: episodeId, number: Number(number), title: "Episode " + number
    };
    state.player = {
      media: state.detail,
      episode: episode,
      match: state.selectedMatch,
      streams: [],
      servers: [],
      tracks: [],
      selectedServer: state.selectedMatch && state.selectedMatch.provider ? ({ justanime: "auto", hianime: "hd-1", anikoto: "anikoto" }[state.selectedMatch.provider.id] || "auto") : "auto",
      category: setting("preferredAudio") === "sub" ? "sub" : "dub",
      intro: null,
      outro: null,
      requestId: 0
    };
    location.hash = "#/watch/" + state.detail.id + "/" + number;
  }

  function playerEpisodeItems() {
    return '<div class="player-episode-tools"><input id="player-episode-filter" class="input-control" placeholder="Find episode…"><input id="player-episode-jump" class="input-control episode-jump-input" type="number" min="1" placeholder="EP #"><button class="btn btn-quiet" data-episode-go="player">Go</button></div>' +
      '<div id="player-episode-items"></div><div id="player-episode-pagination"></div>';
  }


  async function renderWatch(id, number) {
    const token = ++state.token;
    const media = state.detail && String(state.detail.id) === String(id)
      ? state.detail : await getAnime(id).catch(() => null);
    if (!media || token !== state.token) {
      if (token === state.token) {
        $("#view").innerHTML = '<div class="empty-state"><h3>Anime not found</h3><p>Return to the catalogue and try this title again.</p><button class="btn btn-primary" data-route="/home">Home</button></div>';
      }
      return;
    }

    if (!state.detail || String(state.detail.id) !== String(id) || !state.detailMatches.some(match => match?.episodesReady)) {
      state.detail = media;
      const cached = preparedSourceCache.get(String(media.id));
      applyPreparedSources(cached || instantMediaSources(media, number));
      state.episodePage = 1;
      state.episodeFilter = "";
      state.playerEpisodeFilter = "";
    }

    const episode = state.detailEpisodes.find(item => Number(item.number) === Number(number)) || {
      id: String(number), number: Number(number), title: "Episode " + number, generated: true
    };
    const existingPlayer = state.player && String(state.player.media?.id) === String(id) ? state.player : null;
    const player = existingPlayer || {
      media, episode, match: state.selectedMatch, streams: [], embeds: [],
      availableProviders: [], servers: [], tracks: [], selectedServer: "auto",
      category: setting("preferredAudio") === "sub" ? "sub" : "dub", intro: null, outro: null, requestId: 0,
      requestId: 0
    };
    const changedEpisode = Number(player.lastRenderedEpisode) !== Number(episode.number);
    player.lastRenderedEpisode = Number(episode.number);
    state.player = player;
    player.media = media;
    player.episode = episode;
    player.needsProviderRetry = false;
    if (changedEpisode) {
      player.failedProviders = [];
      player.streams = [];
      player.embeds = [];
      player.candidates = [];
      player.candidateIndex = 0;
      player.tracks = [];
      player.servers = [];
      player.selectedServer = "auto";
    }
    if (!player.match || !state.detailMatches.some(match => match.provider.id === player.match.provider.id)) {
      player.match = state.selectedMatch;
    }
    if (!player.selectedServer || player.selectedServer === "default") {
      player.selectedServer = ({ justanime: "auto", hianime: "hd-1", anikoto: "anikoto" }[player.match?.provider?.id] || "auto");
    }
    const index = state.detailEpisodes.findIndex(item => Number(item.number) === Number(number));
    state.playerEpisodePage = index >= 0 ? Math.floor(index / PLAYER_EPISODES_PER_PAGE) + 1 : 1;

    // Remember the selected episode immediately, even if the provider uses an
    // iframe (where browsers cannot expose exact playback time to AniDash).
    if (setting("trackProgress")) {
      const historyKey = String(media.id);
      const saved = store.history[historyKey];
      if (!saved || Number(saved.episode) !== Number(episode.number)) {
        store.history[historyKey] = {
          media: {
            id: media.id, idMal: media.idMal, title: media.title,
            coverImage: media.coverImage, bannerImage: media.bannerImage,
            format: media.format, status: media.status, episodes: media.episodes,
            averageScore: media.averageScore, seasonYear: media.seasonYear
          },
          episode: episode.number, episodeTitle: episode.title,
          position: 0, duration: 0, updatedAt: Date.now()
        };
        persist();
      }
    }
    // Paint the player before any provider call; discovery happens independently.
    paintPlayer();
    void loadPlayerStreams(token);

    if (!preparedSourceCache.has(String(media.id))) {
      getPreparedMediaSources(media).then(prepared => {
        if (token !== state.token || state.route !== "/watch" || state.player !== player) return;
        const preferredId = player.match?.provider?.id;
        applyPreparedSources(prepared, preferredId);
        const refreshed = state.detailMatches.find(match => match?.provider?.id === preferredId && match.episodesReady);
        if (refreshed) player.match = refreshed;
        const updated = state.detailEpisodes.find(item => Number(item.number) === Number(player.episode.number));
        if (updated) {
          player.episode = { ...player.episode, title: updated.title, thumbnail: updated.thumbnail };
          const titleNode = $("#player-episode-heading");
          if (titleNode) titleNode.textContent = updated.title;
          const inlineTitle = $("#player-episode-inline-title");
          if (inlineTitle) inlineTitle.textContent = updated.title;
        }
        renderPlayerEpisodeBrowser();
        if (player.needsProviderRetry) {
          player.needsProviderRetry = false;
          player.failedProviders = [];
          void loadPlayerStreams(token);
        }
      }).catch(() => {});
    }
  }

  function paintPlayer() {
    const player = state.player;
    const media = player.media;
    const episode = player.episode;
    const episodeIndex = state.detailEpisodes.findIndex(item => Number(item.number) === Number(episode.number));
    const hasPrev = episodeIndex > 0;
    const hasNext = episodeIndex >= 0 && episodeIndex < state.detailEpisodes.length - 1;
    $("#view").innerHTML = '<div class="player-page"><div class="player-topline"><button class="back-button" data-anime="' + media.id + '" aria-label="Back to anime">←</button><div><h1>' + escapeHtml(titleOf(media)) + '</h1><p>Episode ' + escapeHtml(episode.number) + ' · <span id="player-episode-heading">' + escapeHtml(episode.title) + '</span></p></div></div>' +
      '<div class="player-layout"><section><div class="video-frame"><video id="anime-video" controls playsinline webkit-playsinline preload="metadata"></video><iframe id="anime-embed" title="Episode stream" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen hidden></iframe><div class="video-ui" id="video-ui" hidden><div class="video-ui-top"><span>' + escapeHtml(titleOf(media)) + ' · Episode ' + escapeHtml(episode.number) + '</span></div><div class="video-ui-bottom"><input class="video-seek" id="video-seek" type="range" min="0" max="1000" value="0" aria-label="Seek position"><div class="video-ui-buttons"><button data-player-toggle aria-label="Play or pause">' + uiIcon("play") + '</button><button data-player-jump="-10" aria-label="Back 10 seconds">−10</button><button data-player-jump="10" aria-label="Forward 10 seconds">+10</button><span id="video-clock" class="video-timecode">00:00 / --:--</span><span class="video-ui-spacer"></span><button data-player-speed aria-label="Playback speed">1×</button><button data-player-fullscreen aria-label="Fullscreen">' + uiIcon("expand") + '</button></div></div></div><div class="player-overlay" id="player-overlay" role="status"><div class="player-mini-loader"></div><strong>Opening episode…</strong></div></div>' +
      '<div class="player-under"><div><h2 id="player-episode-inline-title">' + escapeHtml(episode.title) + '</h2><p>' + escapeHtml(titleOf(media)) + ' · Episode ' + escapeHtml(episode.number) + '</p></div><div class="player-controls"><button class="btn btn-quiet" data-prev ' + (hasPrev ? "" : "disabled") + '>← Previous</button><button class="btn btn-quiet" data-next ' + (hasNext ? "" : "disabled") + '>Next →</button></div></div>' +
      '<div class="button-row" style="margin-top:14px" id="skip-buttons"></div></section>' +
      '<aside class="player-sidebar"><div class="player-panel player-audio-panel"><div class="player-panel-head"><h3>Audio language</h3><span class="stream-state" id="stream-status" role="status">Checking streams</span></div><div class="source-row" id="category-pills" role="group" aria-label="Audio language"><button class="source-pill' + (player.category === "sub" ? " active" : "") + '" data-category="sub" aria-pressed="' + (player.category === "sub") + '">Subtitled</button><button class="source-pill' + (player.category !== "sub" ? " active" : "") + '" data-category="dub" aria-pressed="' + (player.category !== "sub") + '">English dub</button></div></div>' +
      '<div class="player-panel player-stream-panel" id="available-streams-panel" hidden><div class="player-panel-head"><h3>Available streams</h3><span class="stream-hint">Resolved links only</span></div><div class="source-row" id="quality-pills" role="group" aria-label="Available streams"></div></div>' +
      '<div class="player-panel"><h3>Episode list</h3><div class="player-episode-list">' + playerEpisodeItems() + '</div></div>' +
      '</aside></div></div>';
    renderPlayerEpisodeBrowser();
    updateActiveNav("/watch");
  }

  async function loadPlayerStreams(token) {
    const player = state.player;
    if (!player) return;
    const requestId = player.requestId = (player.requestId || 0) + 1;
    const requestedEpisode = Number(player.episode.number);
    const stillCurrent = () => token === state.token && state.player === player &&
      player.requestId === requestId && Number(player.episode.number) === requestedEpisode;

    const defaults = { justanime: "auto", hianime: "hd-1", anikoto: "anikoto" };
    const category = player.category === "sub" ? "sub" : "dub";
    player.category = category;
    player.failedProviders = Array.isArray(player.failedProviders) ? player.failedProviders : [];

    const allMatches = (state.detailMatches || []).filter(match =>
      match && match.provider && match.episodesReady &&
      Array.isArray(match.episodes) && match.episodes.length
    );
    const preferred = allMatches.find(match => match.provider.id === setting("preferredSource"));
    const firstMatch = player.manualProvider ? player.match : (preferred || player.match);
    const orderedMatches = [
      firstMatch,
      ...allMatches.filter(match => match !== firstMatch)
    ].filter((match, index, rows) =>
      match && match.provider && match.episodesReady &&
      Array.isArray(match.episodes) &&
      !player.failedProviders.includes(match.provider.id) &&
      rows.indexOf(match) === index
    );

    if (!orderedMatches.length) {
      player.needsProviderRetry = !preparedSourceCache.has(String(player.media.id));
      showPlayerOverlay(
        "No episode source is ready",
        "Episode sources are unavailable right now. Retry or open another episode.",
        true
      );
      return;
    }

    player.availableProviders = orderedMatches;
    player.streams = [];
    player.tracks = [];
    player.embeds = [];
    player.candidates = [];
    player.candidateIndex = 0;
    renderPlayerOptions();

    showPlayerOverlay("Opening episode…", "", false);

    async function resolveProvider(match) {
      const provider = match.provider;
      const episode = match.episodes.find(item =>
        Number(item.number) === Number(player.episode.number)
      );
      if (!episode) {
        throw new Error(provider.name + ": this episode is not listed.");
      }

      const isCurrentProvider = player.match && player.match.provider.id === provider.id;
      const selectedServer = isCurrentProvider && player.selectedServer &&
        player.selectedServer !== "default"
        ? player.selectedServer
        : (defaults[provider.id] || "auto");

      const payload = await providerGet(provider, "streams", {
        id: match.animeId,
        episodeId: episode.id,
        episode: episode.number,
        anilistId: player.media.id,
        malId: player.media.idMal,
        category: category,
        server: selectedServer
      });

      const hasMediaLink = item => {
        const link = item && (item.url || item.src || item.file);
        if (typeof link !== "string") return false;
        try {
          const parsed = new URL(link);
          return parsed.protocol === "https:" || parsed.hostname === "localhost";
        } catch (_) { return false; }
      };
      const rawStreams = extractArray(payload, ["sources", "streams", "videos", "data.sources"]).filter(hasMediaLink);
      const rawEmbeds = extractArray(payload, ["embeds", "embedSources", "providers"]).filter(hasMediaLink);

      const wantsDub = category === "dub";
      // Do not label an unverified audio track as an English dub.
      const matchesAudio = item => wantsDub ? item.isDub === true : item.isDub !== true;
      const streams = rawStreams.filter(matchesAudio);
      const embeds = rawEmbeds.filter(matchesAudio);

      if (!streams.length && !embeds.length) {
        throw new Error(payload && payload.error
          ? payload.error
          : "No English " + category.toUpperCase() + " stream was returned.");
      }

      const fallbackServers = provider.id === "justanime"
        ? [
            { id: "auto", name: "Automatic (Best available)" },
            { id: "megaplay", name: "Momo (HLS)" },
            { id: "zokoanime", name: "Zoko (HLS)" },
            { id: "animegg", name: "Gigi (MP4)" },
            { id: "anineko", name: "Neko (HLS)" }
          ]
        : provider.id === "anikoto"
        ? [{ id: "anikoto", name: "AniKoto direct embeds" }]
        : [
            { id: "hd-1", name: "AniWave • HLS" },
            { id: "hd-2", name: "HiAnime HD-2" },
            { id: "megaplay", name: "MegaPlay" }
          ];

      return {
        match,
        episode,
        selectedServer,
        servers: extractArray(payload, ["servers", "serverList", "data.servers"]).length
          ? extractArray(payload, ["servers", "serverList", "data.servers"])
          : fallbackServers,
        streams,
        embeds: embeds.map(item => ({
          ...item,
          type: "embed",
          isEmbed: true,
          quality: item.quality || item.name || item.id || "Embedded player"
        })),
        tracks: extractArray(payload, ["tracks", "subtitles", "data.tracks"])
          .sort((a, b) => {
            const aEnglish = /^(en|eng|english)\b/i.test(String(a.lang || a.label || ""));
            const bEnglish = /^(en|eng|english)\b/i.test(String(b.lang || b.label || ""));
            return Number(bEnglish) - Number(aEnglish);
          }),
        intro: payload && payload.intro || null,
        outro: payload && payload.outro || null
      };
    }

    // Resolve all providers together. Prefer an actual HLS/MP4 URL as soon as
    // one arrives; only use an iframe provider when no direct source responds
    // within a short grace window.
    const attemptPromises = orderedMatches.map(match =>
      resolveProvider(match).then(
        result => ({ ...result, providerId: match.provider.id }),
        error => ({ providerId: match.provider.id, error: error.message || String(error), streams: [], embeds: [] })
      )
    );

    let directWinner = null;
    let embedWinner = null;
    let completed = 0;
    const results = [];
    let resolveDirect;
    let resolveEmbed;
    let resolveAll;
    const directReady = new Promise(resolve => { resolveDirect = resolve; });
    const embedReady = new Promise(resolve => { resolveEmbed = resolve; });
    const allReady = new Promise(resolve => { resolveAll = resolve; });

    attemptPromises.forEach((attempt, index) => {
      attempt.then(result => {
        results[index] = result;
        completed += 1;

        if (!directWinner && result.streams && result.streams.length) {
          directWinner = result;
          resolveDirect(result);
        }
        if (!embedWinner && result.embeds && result.embeds.length) {
          embedWinner = result;
          resolveEmbed(result);
        }
        if (completed === attemptPromises.length) {
          if (!directWinner) resolveDirect(null);
          if (!embedWinner) resolveEmbed(null);
          resolveAll(results);
        }
      });
    });

    const embedWithGrace = embedReady.then(async fallback => {
      if (!fallback) return null;
      const preferredDirect = await Promise.race([
        directReady,
        new Promise(resolve => window.setTimeout(() => resolve(null), 180))
      ]);
      return preferredDirect || fallback;
    });

    const winner = await Promise.race([
      directReady,
      embedWithGrace,
      allReady.then(rows =>
        rows.find(item => item && item.streams && item.streams.length) ||
        rows.find(item => item && item.embeds && item.embeds.length) ||
        null
      )
    ]);

    if (!stillCurrent()) return;
    if (!winner) {
      player.needsProviderRetry = !preparedSourceCache.has(String(player.media.id));
      const failures = results.filter(item => item && item.error)
        .map(item => item.error).slice(0, 3);
      player.streams = [];
      player.tracks = [];
      player.embeds = [];
      player.candidates = [];
      player.failedProviders = [...new Set([
        ...player.failedProviders,
        ...results.filter(item => item?.error).map(item => item.providerId)
      ])];
      renderPlayerOptions();
      showPlayerOverlay(
        "No English " + category.toUpperCase() + " stream found",
        "No " + (category === "dub" ? "English-dubbed" : "subtitled") + " stream was returned for this episode. Retry or switch audio language.",
        true
      );
      return;
    }

    player.needsProviderRetry = false;
    player.match = winner.match;
    player.episode = winner.episode;
    player.servers = winner.servers;
    player.selectedServer = winner.selectedServer;
    player.streams = winner.streams;
    player.embeds = winner.embeds;
    const targetQuality = setting("defaultQuality");
    const targetPixels = Number.parseInt(String(targetQuality), 10);
    const qualityPixels = stream => {
      const found = /(?:^|[^\d])(2160|1440|1080|720|480|360)(?:p|[^\d]|$)/i.exec(
        String(stream.quality || stream.label || stream.name || "")
      );
      return found ? Number(found[1]) : 0;
    };
    const rankedStreams = [...winner.streams].sort((a, b) => {
      const qa = qualityPixels(a);
      const qb = qualityPixels(b);
      if (Number.isFinite(targetPixels)) {
        if (!qa && !qb) return 0;
        if (!qa) return 1;
        if (!qb) return -1;
        return Math.abs(qa - targetPixels) - Math.abs(qb - targetPixels);
      }
      return qb - qa;
    });
    player.candidates = [...rankedStreams, ...winner.embeds];
    player.candidateIndex = 0;
    player.tracks = winner.tracks;
    player.intro = winner.intro;
    player.outro = winner.outro;
    renderPlayerOptions();

    const first = player.candidates[0];
    attachStream(first.url || first.src || first.file, first, first.isEmbed ? [] : player.tracks);
    toast((category === "dub" ? "English dub" : "Subtitled") + " stream ready.");
  }


  function showPlayerOverlay(title, description, showAction) {
    const overlay = $("#player-overlay");
    if (!overlay) return;
    overlay.style.display = "grid";
    overlay.classList.toggle("has-error", Boolean(showAction));
    overlay.innerHTML = showAction
      ? '<div class="player-error-symbol">!</div><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(description) + '</p><div class="player-error-actions"><button class="btn btn-primary" data-retry-sources>Retry playback</button>' + (state.player?.category === "dub" ? '<button class="btn btn-secondary" data-category="sub">Try subtitled</button>' : '') + '</div>'
      : '<div class="player-mini-loader"></div><strong>Opening episode…</strong>';
  }

  function renderPlayerOptions() {
    const player = state.player;
    if (!player) return;
    const candidates = Array.isArray(player.candidates) ? player.candidates : [];
    const panel = $("#available-streams-panel");
    if (panel) panel.hidden = candidates.length === 0;
    const qualities = $("#quality-pills");
    if (qualities) {
      qualities.innerHTML = candidates.map((stream, index) => {
        const quality = /(?:^|[^0-9])(2160|1440|1080|720|480|360)\s*p(?:[^0-9]|$)/i.exec(String(stream.quality || ""));
        const label = "Stream " + (index + 1) + (quality ? " · " + quality[1] + "p" : "");
        return '<button class="source-pill' + (index === Number(player.candidateIndex || 0) ? " active" : "") +
          '" data-stream="' + index + '" aria-pressed="' + (index === Number(player.candidateIndex || 0)) + '">' + escapeHtml(label) + '</button>';
      }).join("");
    }
    const status = $("#stream-status");
    if (status) status.textContent = candidates.length
      ? candidates.length + (candidates.length === 1 ? " stream" : " streams") + " found"
      : "Checking streams";
    const skip = $("#skip-buttons");
    if (skip) {
      skip.innerHTML = (player.intro && Number(player.intro.end) > Number(player.intro.start) ? '<button class="btn btn-quiet" data-skip="intro">Skip intro</button>' : '') +
        (player.outro && Number(player.outro.end) > Number(player.outro.start) ? '<button class="btn btn-quiet" data-skip="outro">Skip outro</button>' : '');
    }
  }

  function fallbackToNextProvider(reason) {
    const player = state.player;
    if (!player || !player.match || !player.match.provider) return;

    const candidates = Array.isArray(player.candidates) ? player.candidates : [];
    const nextCandidateIndex = Number(player.candidateIndex || 0) + 1;
    if (nextCandidateIndex < candidates.length) {
      player.candidateIndex = nextCandidateIndex;
      const candidate = candidates[nextCandidateIndex];
      renderPlayerOptions();
      showPlayerOverlay(
        "Trying another server",
        "Trying the next available stream.",
        false
      );
      attachStream(candidate.url || candidate.src || candidate.file, candidate, candidate.isEmbed ? [] : player.tracks);
      return;
    }

    player.failedProviders = Array.isArray(player.failedProviders) ? player.failedProviders : [];
    const failedId = player.match.provider.id;
    if (!player.failedProviders.includes(failedId)) player.failedProviders.push(failedId);
    player.streams = [];
    player.embeds = [];
    player.candidates = [];
    player.tracks = [];
    const next = (state.detailMatches || []).find(match =>
      match && match.provider && match.episodesReady &&
      !player.failedProviders.includes(match.provider.id) &&
      Array.isArray(match.episodes) &&
      match.episodes.some(item => Number(item.number) === Number(player.episode.number))
    );
    if (next) {
      player.match = next;
      player.selectedServer = ({ justanime: "auto", hianime: "hd-1", anikoto: "anikoto" }[next.provider.id] || "auto");
      showPlayerOverlay("Switching stream", "Trying another available source.", false);
      loadPlayerStreams(state.token);
      return;
    }
    showPlayerOverlay(
      "Playback unavailable",
      "None of the available streams could play in this browser. Try another audio language or episode.",
      true
    );
  }


  function updateVideoControls() {
    const video = $("#anime-video");
    if (!video) return;
    const clock = $("#video-clock");
    if (clock) {
      const valid = Number.isFinite(video.duration) && video.duration > 0;
      clock.textContent = hhmmss(video.currentTime) + " / " + (valid ? hhmmss(video.duration) : "--:--");
    }
    const seek = $("#video-seek");
    if (seek && Number.isFinite(video.duration) && video.duration > 0) {
      seek.value = String(Math.round(Math.min(1, video.currentTime / video.duration) * 1000));
    }
    const toggle = $('[data-player-toggle]');
    if (toggle) {
      toggle.innerHTML = uiIcon(video.paused ? "play" : "pause");
      toggle.setAttribute("aria-label", video.paused ? "Play" : "Pause");
    }
    const speed = $('[data-player-speed]');
    if (speed) speed.textContent = Number(video.playbackRate || 1).toFixed(2).replace(/0$/, "").replace(/\.$/, "") + "×";
  }

  function attachStream(url, stream, tracks) {
    if (!url) {
      fallbackToNextProvider("The provider did not return a media URL.");
      return;
    }
    let parsed;
    try { parsed = new URL(url); } catch (_) {
      fallbackToNextProvider("The source returned an invalid media URL.");
      return;
    }
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      fallbackToNextProvider("The source returned a non-HTTPS URL, which AniDash blocks for safety.");
      return;
    }

    const video = $("#anime-video");
    const embed = $("#anime-embed");
    const overlay = $("#player-overlay");
    if (!video) return;
    const playerUI = $("#video-ui");
    if (playerUI) playerUI.hidden = true;
    video.controls = true;
    if (state.playbackWatchdog) {
      window.clearTimeout(state.playbackWatchdog);
      state.playbackWatchdog = null;
    }
    if (state.hls) {
      try { state.hls.destroy(); } catch (_) {}
      state.hls = null;
    }

    const isEmbed = !!(stream && (stream.isEmbed === true || String(stream.type || "").toLowerCase() === "embed"));
    if (isEmbed) {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.style.display = "none";
      if (embed) {
        embed.hidden = false;
        embed.onerror = () => {
          if (state.currentVideo === parsed.toString()) {
            fallbackToNextProvider("The embedded player could not be loaded.");
          }
        };
        embed.src = parsed.toString();
      }
      state.currentVideo = parsed.toString();
      if (overlay) overlay.style.display = "none";
      const skip = $("#skip-buttons");
      if (skip) skip.innerHTML = "";
      return;
    }

    if (embed) {
      embed.hidden = true;
      embed.src = "about:blank";
    }
    video.style.display = "block";
    video.preload = "auto";
    video.pause();
    video.removeAttribute("src");
    while (video.firstChild) video.removeChild(video.firstChild);
    (tracks || []).forEach(track => {
      if (!track.url) return;
      const el = document.createElement("track");
      el.kind = track.type === "captions" ? "captions" : "subtitles";
      el.label = track.lang || "Subtitles";
      el.srclang = (track.lang || "en").slice(0, 2).toLowerCase();
      el.src = track.url;
      video.appendChild(el);
    });
    const isHls = stream && (stream.isM3U8 === true || String(stream.type || "").toLowerCase().includes("hls") || /\.m3u8(\?|$)/i.test(url));
    if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
    } else if (isHls && window.Hls && window.Hls.isSupported()) {
      state.hls = new window.Hls({ enableWorker: true, lowLatencyMode: false, startLevel: -1, capLevelToPlayerSize: true, startFragPrefetch: true, backBufferLength: 20, maxBufferLength: 24, maxMaxBufferLength: 48 });
      state.hls.loadSource(url);
      state.hls.attachMedia(video);
      const activeHls = state.hls;
      state.hls.on(window.Hls.Events.ERROR, function (_event, data) {
        if (data && data.fatal && state.currentVideo === url) {
          try { activeHls.destroy(); } catch (_) {}
          if (state.hls === activeHls) state.hls = null;
          fallbackToNextProvider("The browser could not load this stream.");
        }
      });
    } else {
      video.src = url;
    }
    state.currentVideo = url;
    if (overlay) {
      overlay.style.display = "grid";
      overlay.classList.remove("has-error");
      overlay.innerHTML = '<div class="player-mini-loader"></div><strong>Opening episode…</strong>';
    }
    state.playbackWatchdog = window.setTimeout(() => {
      if (state.currentVideo === url && video.readyState < 2) {
        fallbackToNextProvider("This server took too long to start playback.");
      }
    }, 12000);
    video.onloadedmetadata = () => {
      const key = String(state.player.media.id);
      const saved = store.history[key];
      if (saved && Number(saved.episode) === Number(state.player.episode.number) && saved.position > 15 && video.duration > saved.position + 15) {
        video.currentTime = saved.position;
      }
      if (video.textTracks && video.textTracks.length) {
        try {
          [...video.textTracks].forEach(track => {
            track.mode = setting("autoEnableSubtitles") ? "showing" : "disabled";
          });
        } catch (_) {}
      }
      if (state.currentVideo !== url) return;
      const playerUI = $("#video-ui");
      if (playerUI) { playerUI.hidden = false; video.controls = false; }
      updateVideoControls();
      video.play().catch(error => {
        if (state.currentVideo !== url) return;
        if (error?.name === "NotAllowedError") {
          if (overlay) {
            overlay.style.display = "grid";
            overlay.innerHTML = '<strong>Ready to watch</strong><button class="btn btn-primary" data-play-video>▶ Tap to play</button>';
          }
        } else if (error?.name !== "AbortError") {
          fallbackToNextProvider("The selected source could not start.");
        }
      });
    };
    video.onplaying = () => {
      if (state.currentVideo !== url) return;
      if (state.playbackWatchdog) window.clearTimeout(state.playbackWatchdog);
      state.playbackWatchdog = null;
      if (overlay) overlay.style.display = "none";
      updateVideoControls();
    };
    video.onwaiting = () => {
      if (state.currentVideo === url && !video.paused && overlay) {
        overlay.style.display = "grid";
        overlay.innerHTML = '<div class="player-mini-loader"></div><strong>Buffering…</strong>';
      }
    };
    video.onerror = () => {
      if (state.currentVideo !== url) return;
      if (state.playbackWatchdog) window.clearTimeout(state.playbackWatchdog);
      state.playbackWatchdog = null;
      if (state.player && state.player.match) {
        fallbackToNextProvider("The browser could not play the returned video URL.");
      } else {
        showPlayerOverlay("Playback unavailable", "The selected link is not playable in this browser.", true);
      }
    };
    video.ontimeupdate = () => {
      updateVideoControls();
      savePlaybackProgress(video);
      const intro = state.player?.intro;
      if (setting("autoSkipIntro") && intro && Number.isFinite(Number(intro.start)) &&
          Number.isFinite(Number(intro.end)) && Number(intro.end) > Number(intro.start) &&
          video.currentTime >= Number(intro.start) && video.currentTime < Number(intro.end)) {
        video.currentTime = Number(intro.end);
      }
    };
    video.onpause = () => { updateVideoControls(); savePlaybackProgress(video, false, true); };
    video.onended = () => {
      updateVideoControls();
      savePlaybackProgress(video, true, true);
      if (setting("showNextEpisodePrompt")) {
        const next = state.detailEpisodes.find(ep => Number(ep.number) === Number(state.player.episode.number) + 1);
        if (next) {
          const over = $("#player-overlay");
          if (over) {
            over.style.display = "grid";
            over.innerHTML = '<strong>Episode finished</strong><button class="btn btn-primary" data-next>▶ Next episode</button>';
          }
        } else toast("Episode finished.");
      }
      // Exact AniList notes are queued by savePlaybackProgress().
      const mal = window.AniDashMal;
      const completed = Number(state.player.episode.number);
      if (setting("trackProgress") && mal?.authenticated() && state.player.media.idMal) {
        mal.updateProgress(state.player.media.idMal, completed,
          state.player.media.episodes && completed >= Number(state.player.media.episodes) ? "completed" : "watching"
        ).catch(() => toast("Saved locally; MAL episode sync unavailable."));
      }
    };
  }

  function savePlaybackProgress(video, ended, force = false) {
    if (!setting("trackProgress") || !state.player) return;
    const currentTime = Number(video?.currentTime || 0);
    if (!Number.isFinite(currentTime) || currentTime < 0) return;
    const duration = Number.isFinite(Number(video.duration)) && Number(video.duration) > 0
      ? Number(video.duration) : 0;
    if (!currentTime && !duration) return;
    const now = Date.now();
    if (!force && !ended && now - state.progressTimer < 3000) return;
    state.progressTimer = now;
    const media = state.player.media;
    const episode = state.player.episode;
    store.history[String(media.id)] = {
      media: {
        id: media.id, idMal: media.idMal, title: media.title, coverImage: media.coverImage,
        bannerImage: media.bannerImage, format: media.format, status: media.status,
        episodes: media.episodes, averageScore: media.averageScore, seasonYear: media.seasonYear
      },
      episode: episode.number,
      episodeTitle: episode.title,
      position: ended ? duration : currentTime,
      duration,
      updatedAt: now
    };
    if (!store.libraryStatuses[String(media.id)] ||
        store.libraryStatuses[String(media.id)] === "PLANNING") {
      store.libraryStatuses[String(media.id)] = "CURRENT";
    }
    if (ended && media.episodes && Number(episode.number) >= Number(media.episodes)) {
      store.libraryStatuses[String(media.id)] = "COMPLETED";
    }
    persist();
    const account = window.AniDashAccount;
    if (account?.authenticated()) {
      const key = String(media.id);
      const previous = state.lastCloudProgressSync.get(key);
      const position = Math.max(0,Math.floor(ended ? duration : currentTime));
      const same = previous && previous.episode === Number(episode.number) &&
        previous.position === position && now - previous.time < 10000;
      if (!same && (force || ended || !previous || now - previous.time >= 10000)) {
        state.lastCloudProgressSync.set(key,{episode:Number(episode.number),position,time:now});
        account.syncPosition(media.id,Number(episode.number),position,Math.floor(duration),Boolean(ended))
          .catch(error => {
            if (state.route === "/watch") toast("Saved locally; AniList sync failed: " + error.message);
          });
      }
    }
  }


  const LIBRARY_TABS = [
    ["CURRENT", "Watching"], ["COMPLETED", "Completed"], ["PAUSED", "On Hold"],
    ["PLANNING", "Plan to Watch"], ["DROPPED", "Dropped"],
    ["REPEATING", "Repeating"], ["FAVORITES", "Favorites"]
  ];
  function libraryStatus(media) {
    const key = String(media.id);
    return store.libraryStatuses[key] || (store.history[key] ? "CURRENT" : "PLANNING");
  }
  function renderLibrary() {
    const chosen = state.libraryTab || "CURRENT";
    const items = Object.values(store.watchlist).filter(item => item?.id);
    const counts = Object.fromEntries(LIBRARY_TABS.map(([id]) => [id, items.filter(item =>
      id === "FAVORITES" ? store.localFavorites[String(item.id)] : libraryStatus(item) === id
    ).length]));
    const filtered = items.filter(item => chosen === "FAVORITES" ?
      store.localFavorites[String(item.id)] : libraryStatus(item) === chosen)
      .sort((a,b) => titleOf(a).localeCompare(titleOf(b)));
    const online = window.AniDashAccount?.authenticated() || window.AniDashMal?.authenticated();
    const statusOptions = item => LIBRARY_TABS.filter(([value]) => value !== "FAVORITES").map(([value,label]) =>
      '<option value="' + value + '"' + (libraryStatus(item) === value ? " selected" : "") +
      '>' + escapeHtml(label) + '</option>').join("");
    const cells = filtered.length ? '<div class="anime-grid">' + filtered.map(item => {
      const favorite = Boolean(store.localFavorites[String(item.id)]);
      return '<div class="library-item">' + card(item) +
        '<div class="library-action-row"><select class="select-control status-select" aria-label="Tracking status for ' +
        escapeHtml(titleOf(item)) + '" data-library-status="' + item.id + '">' + statusOptions(item) +
        '</select><button class="btn btn-quiet" aria-label="' + (favorite ? "Unfavorite" : "Favorite") +
        ' ' + escapeHtml(titleOf(item)) + '" data-library-favorite="' + item.id + '">' +
        uiIcon("heart") + (favorite ? ' Saved' : ' Favorite') + '</button></div></div>';
    }).join("") + '</div>' :
      '<div class="empty-state"><h3>No ' + escapeHtml(LIBRARY_TABS.find(([id]) => id === chosen)?.[1] || "anime") +
      ' titles yet</h3><p>Add titles from discovery or import your AniList / MAL library.</p>' +
      '<button class="btn btn-primary" data-route="/discover">Browse anime</button></div>';
    $("#view").innerHTML =
      pageHead("", "Your Library", "Watching, completed, on hold, plan to watch, dropped and favorites") +
      '<div class="library-toolbar"><div class="library-save-status">' +
      (online ? uiIcon("cloud") + ' Connected to tracking services · synced to this browser'
        : uiIcon("bookmark") + ' Saved locally · <button class="text-button" data-route="/account">Connect AniList or MAL</button>') +
      '</div><div class="account-actions"><button class="btn btn-quiet" data-route="/history">' +
      uiIcon("history") + ' Continue Watching</button>' +
      (online ? '<button class="btn btn-quiet" data-sync-all>' + uiIcon("refresh") + ' Sync</button>' : '') +
      '</div></div><div class="status-tabs" role="tablist" aria-label="Anime library statuses">' +
      LIBRARY_TABS.map(([value,label]) =>
        '<button role="tab" aria-selected="' + (chosen===value?"true":"false") +
        '" data-library-tab="' + value + '" class="' + (chosen===value?"active":"") + '">' +
        escapeHtml(label) + ' ' + counts[value] + '</button>').join("") +
      '</div>' + cells +
      '<p class="list-status-note">AniList sync saves list statuses and watch positions in tracker notes. MyAnimeList syncs watched episode counts. Exact playback positions from Android require AniList synchronization.</p>';
  }

  function renderHistory() {
    const items = Object.values(store.history).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const media = items.map(item => item.media).filter(Boolean);
    $("#view").innerHTML = pageHead("", "Your Library", "Your playback progress on this device") +
      '<nav class="library-tabs" aria-label="Library sections"><button data-route="/library">Watchlist</button><button class="active" data-route="/history">Continue Watching</button></nav>' +
      (items.length ? '<div class="anime-grid">' + items.map(item => {
        const pct = item.duration ? Math.min(100, Math.max(0, item.position / item.duration * 100)) : 0;
        const poster = imageOf(item.media);
        return '<article class="anime-card" data-resume="' + item.media.id + '" tabindex="0"><div class="poster-wrap">' + (poster ? '<img loading="lazy" src="' + escapeHtml(poster) + '" alt="">' : '<div class="poster-fallback">' + escapeHtml(titleOf(item.media)) + '</div>') + '<span class="poster-score">EP ' + escapeHtml(item.episode) + '</span></div><div class="card-title">' + escapeHtml(titleOf(item.media)) + '</div><p class="card-subtitle">' + escapeHtml(item.episodeTitle || "Episode " + item.episode) + '</p><div class="card-progress"><span style="width:' + pct + '%"></span></div><div class="card-resume">' + escapeHtml(progressCaption(item)) + '</div></article>';
      }).join("") + '</div>' : '<div class="empty-state"><div class="empty-icon">◷</div><h3>No episodes watched yet</h3><p>When you start watching, AniDash will remember your episode and playback position on this device.</p><button class="btn btn-primary" data-route="/discover">Find anime</button></div>');
  }


  function refreshProfileChip(user) {
    const name = $(".profile-name");
    const avatar = $(".profile-avatar");
    const malUser = window.AniDashMal?.currentUser();
    const active = user || malUser;
    if (name) name.textContent = active?.name || "Sign in";
    if (state.route === "/home") renderHomeProfile();
    if (avatar) {
      const source = user?.avatar?.medium || user?.avatar?.large || malUser?.picture;
      if (source && /^https:\/\//.test(source)) {
        avatar.innerHTML = '<img src="' + escapeHtml(source) + '" alt="">';
      } else {
        avatar.textContent = active?.name ? active.name.slice(0, 1).toUpperCase() : "◎";
      }
    }
  }

  function renderAccount() {
    const anilist = window.AniDashAccount;
    const mal = window.AniDashMal;
    const user = anilist?.currentUser();
    const malUser = mal?.currentUser();
    const avatarUrl = user?.avatar?.large || user?.avatar?.medium || malUser?.picture || "";
    const avatar = avatarUrl.startsWith("https://")
      ? '<img src="' + escapeHtml(avatarUrl) + '" alt="">'
      : escapeHtml((user?.name || malUser?.name || "A").slice(0,1).toUpperCase());
    const display = user?.name || malUser?.name || "Your AniDash Account";
    const anilistButton = user
      ? '<div class="account-name"><span class="connected-label">' + uiIcon("check") +
        ' Connected as ' + escapeHtml(user.name) + '</span></div>' +
        '<button class="btn btn-secondary" data-sync-library>' + uiIcon("refresh") + ' Sync AniList</button>' +
        '<button class="btn btn-quiet" data-logout-anilist>Sign out of AniList</button>'
      : '<button class="btn btn-primary" data-login-anilist' +
        (anilist?.configured() ? "" : " disabled") + '>Continue with AniList</button>';
    const malButton = malUser
      ? '<div class="account-name"><span class="connected-label">' + uiIcon("check") +
        ' Connected as ' + escapeHtml(malUser.name) + '</span></div>' +
        '<button class="btn btn-secondary" data-sync-mal>' + uiIcon("refresh") + ' Sync MAL</button>' +
        '<button class="btn btn-quiet" data-logout-mal>Sign out of MAL</button>'
      : '<button class="btn btn-primary" data-login-mal' +
        (mal?.configured() ? "" : " disabled") + '>Continue with MyAnimeList</button>';
    $("#view").innerHTML =
      pageHead("", "Your Account", "Connect one or both tracking services, just like AniDash Android") +
      '<section class="account-hero"><div class="account-avatar">' + avatar + '</div><div><h2>' +
        escapeHtml(display) + '</h2><p>' +
        (user || malUser ? "Your account connections and synced anime library" : "Sign in to bring your anime library to every device") +
        '</p><span class="profile-platform-tag">' + escapeHtml(user ? "AniList connected" : malUser ? "MyAnimeList connected" : "Guest mode") + '</span></div></section>' +
      '<div class="profile-stats"><div><strong>' + Object.keys(store.watchlist).length + '</strong><span>Saved titles</span></div><div><strong>' +
      Object.keys(store.history).length + '</strong><span>Watching history</span></div><div><strong>' +
      Object.keys(store.mangaList).length + '</strong><span>Saved manga</span></div></div>' +
      '<div class="account-providers">' +
        '<section class="account-provider"><div class="account-icon">AL</div><strong>AniList</strong>' +
        '<p>Sync watching lists, favourites and exact episode timestamps via Android-compatible progress notes.</p>' +
        '<div class="account-actions">' + anilistButton + '</div>' +
        (!user && !anilist?.configured()
          ? '<span class="preference-help">Site owner must set ANILIST_WEB_CLIENT_ID on Vercel.</span>' : '') +
        '</section>' +
        '<section class="account-provider mal"><div class="account-icon">MAL</div><strong>MyAnimeList</strong>' +
        '<p>Import your anime list and sync watched-episode counts using official MAL OAuth with PKCE.</p>' +
        '<div class="account-actions">' + malButton + '</div>' +
        (!malUser && !mal?.configured()
          ? '<span class="preference-help">Site owner must configure MAL_WEB_CLIENT_ID (and MAL_WEB_CLIENT_SECRET if required).</span>' : '') +
        '</section></div>' +
      '<div class="account-info"><strong>One AniDash library</strong>' +
      '<p>Connect AniList and/or MyAnimeList. AniDash merges supported lists without deleting local entries. Your passwords stay with their official login services.</p>' +
      '<p>For an exact 5-minute handoff from your Android app to this website, enable AniList tracking in the app. Android writes a <code>shx:ep=…&sec=…</code> note; AniDash Watch reads it and seeks to that timestamp. MAL shares episode counts, not exact seconds. Connected account APIs do not provide email addresses, so AniDash never labels an account as email-synced.</p>' +
      '<button class="btn btn-quiet" data-route="/library">' + uiIcon("library") + ' Open Library</button></div>';
  }

  function prefSelect(key, options, help) {
    return '<div class="preference-row"><div><h3 class="preference-title">' + escapeHtml(options.label) +
      '</h3><p class="preference-help">' + escapeHtml(help) + '</p></div><select class="select-control" data-setting="' +
      escapeHtml(key) + '">' + options.values.map(pair => '<option value="' + escapeHtml(pair[0]) +
      '"' + (String(setting(key)) === String(pair[0]) ? " selected" : "") + '>' + escapeHtml(pair[1]) + '</option>').join("") +
      '</select></div>';
  }
  function prefToggle(key, title, help) {
    return '<label class="preference-row"><div><h3 class="preference-title">' + escapeHtml(title) +
      '</h3><p class="preference-help">' + escapeHtml(help) + '</p></div><input class="preference-toggle" type="checkbox" data-setting="' +
      escapeHtml(key) + '"' + (setting(key) ? " checked" : "") + '></label>';
  }
  function settingsGroup(title, html) {
    return '<h2 class="settings-section-label">' + escapeHtml(title) + '</h2><div class="settings-group">' + html + '</div>';
  }

  function renderSettings() {
    const connected = window.AniDashAccount?.authenticated();
    $("#view").innerHTML = '<div class="settings-screen">' +
      pageHead("", "Settings", "Customize your AniDash web experience") +
      '<div class="settings-search-wrap">' + uiIcon("search") + '<input id="settings-filter" class="input-control" type="search" placeholder="Search settings" aria-label="Search settings"></div>' +
      settingsGroup("Account & sync", '<div class="preference-row"><div><h3 class="preference-title">AniList account</h3><p class="preference-help">' +
        (connected ? 'Connected · Watchlist sync available' : 'Guest mode · local data only until you sign in') +
        '</p></div><button class="btn btn-secondary" data-route="/account">' + (connected ? "Manage" : "Sign in") + '</button></div>' +
        prefToggle("trackProgress", "Save playback progress", "Keep exact playback time locally, and sync through AniList when connected.")) +
      settingsGroup("Video Player", 
        prefSelect("preferredAudio", { label:"Preferred audio", values:[["dub","English DUB"],["sub","Original SUB"]] }, "Default audio language when a source supports it.") +
        prefSelect("defaultQuality", { label:"Preferred quality", values:[["Auto","Auto (recommended)"],["1080p","1080p"],["720p","720p"],["480p","480p"],["360p","360p"]] }, "Choose the closest stream quality actually offered by a source.") +
        prefToggle("autoEnableSubtitles", "Auto-enable subtitles", "Enable available subtitle tracks when playback begins.") +
        prefToggle("autoSkipIntro", "Auto-skip intros", "Skip verified intro time ranges when providers supply AniSkip timing.") +
        prefToggle("showNextEpisodePrompt", "Next episode prompt", "Offer the next episode when the current video finishes.")) +
      settingsGroup("Appearance & layout",
        prefSelect("themeMode", { label:"Theme mode", values:[["light","Light"],["dark","Dark"],["system","Follow device"]] }, "Choose a light, dark or system-matched design.") +
        prefSelect("episodeViewMode", { label:"Episode layout", values:[["list","List"],["grid","Grid"]] }, "How episodes appear on the anime details screen.") +
        prefToggle("showMangaTab", "Show Manga navigation", "Off by default; enable Manga as an optional tab.") +
        prefToggle("showNewsSection", "News on Home", "Show real anime headlines on your homepage.")) +
      settingsGroup("News & notifications",
        prefToggle("showNewsNotifications", "In-app news notifications", "Unread anime headlines in the local inbox; not system push.") +
        '<div class="preference-row"><div><h3 class="preference-title">Notification inbox</h3><p class="preference-help">View and mark headlines read on this device.</p></div><button class="btn btn-quiet" data-route="/notifications">Open inbox</button></div>') +
      settingsGroup("Data & storage",
        '<div class="preference-row"><div><h3 class="preference-title">Local library backup</h3><p class="preference-help">Your watchlist, playback progress and settings are saved in browser storage with an IndexedDB recovery copy. Keep a JSON backup when changing browsers.</p></div><button class="btn btn-quiet" data-export-backup>Export JSON</button></div>' +
        '<div class="preference-row"><div><h3 class="preference-title">Restore your library</h3><p class="preference-help">Import an AniDash Watch JSON backup. Existing entries are merged, not replaced.</p></div><button class="btn btn-quiet" data-import-backup>Import JSON</button><input class="backup-import" type="file" id="backup-file" accept=".json,application/json"></div>' +
        '<div class="preference-row"><div><h3 class="preference-title">Protect offline storage</h3><p class="preference-help">Ask this browser to retain AniDash data when it supports persistent storage.</p></div><button class="btn btn-quiet" data-persist-storage>Request storage</button></div>' +
        '<div class="preference-row"><div><h3 class="preference-title">Clear saved playback progress</h3><p class="preference-help">Remove playback history from this device without deleting your watchlist.</p></div><button class="btn btn-quiet" data-clear-history>Clear</button></div>' +
        '<div class="preference-row"><div><h3 class="preference-title">Clear local watchlist</h3><p class="preference-help">Removes local titles only; AniList data will not be deleted.</p></div><button class="btn btn-quiet" data-clear-watchlist>Clear</button></div>') +
      settingsGroup("App & support",
        '<div class="preference-row"><div><h3 class="preference-title">Install AniDash</h3><p class="preference-help">Use the web app on an iPhone, Android phone or desktop.</p></div><button class="btn btn-quiet" data-install>Install guide</button></div>' +
        '<div class="preference-row"><div><h3 class="preference-title">Playback troubleshooting</h3><p class="preference-help">Stream options appear after AniDash resolves a supported media link.</p></div><button class="btn btn-quiet" data-open-sources>How playback works</button></div>' +
        '<div class="preference-row"><div><h3 class="preference-title">About</h3><p class="preference-help">AniDash Watch PWA · Android-inspired UI. Native downloads, OS permissions, Android notifications and AniCORE are not implemented on the website.</p></div><a class="btn btn-quiet" href="https://github.com/anshdeepofficial1/AniDash-Website" target="_blank" rel="noopener">GitHub</a></div>') +
      '<p class="settings-footnote">Preferences are saved on this device. Logging into AniList syncs anime lists and optional watched-episode progress, but cannot transfer settings or exact video timestamps between browsers.</p></div>';
  }

  function openModal(content) {
    $("#modal-root").innerHTML = '<div class="modal-backdrop" data-close-modal><section class="modal-card" role="dialog" aria-modal="true">' + content + '</section></div>';
    const close = $(".modal-card [data-close]");
    if (close && typeof close.focus === "function") close.focus();
    // Never stop propagation within the dialog: delegated X/Done actions must work.
  }

  function closeModal() {
    $("#modal-root").innerHTML = "";
  }

  function openSourcesModal() {
    openModal('<div class="modal-head"><div><h2>How playback works</h2><p>AniDash checks media sources automatically when you open an episode. Stream options appear only after a media link is resolved.</p></div><button class="close-modal" data-close aria-label="Close">×</button></div>' +
      '<div class="account-info"><strong>Playback unavailable?</strong><p>Retry playback, switch to subtitled audio, or open another episode. Some titles do not have English audio available.</p></div>' +
      '<div class="modal-actions"><button class="btn btn-primary" data-close>Done</button></div>');
  }

  function openInstallGuide() {
    const ua = navigator.userAgent || "";
    const ios = /iPhone|iPad|iPod/i.test(ua);
    const android = /Android/i.test(ua);
    const steps = ios ? [
      "Open this site in Safari.",
      "Tap the Share button in the browser toolbar.",
      "Choose Add to Home Screen, then tap Add."
    ] : android ? [
      "Open this site in Chrome or Samsung Internet.",
      "Open the browser menu and choose Install app or Add to Home screen.",
      "Confirm the installation."
    ] : [
      "Open this site in a supported browser such as Chrome, Edge or Safari.",
      "Use the install icon in the address bar or the Install AniDash button.",
      "Confirm to add AniDash to your desktop or app launcher."
    ];
    openModal('<div class="modal-head"><div><div class="eyebrow">INSTALL ANIDASH</div><h2>Take your anime corner with you</h2><p>AniDash can be installed as a Progressive Web App. The app shell works offline; catalogue and streaming still need an internet connection.</p></div><button class="close-modal" data-close>×</button></div><div class="install-guide">' +
      steps.map((step, index) => '<div class="install-step"><b>' + (index + 1) + '</b><span>' + escapeHtml(step) + '</span></div>').join("") +
      '</div><div class="modal-actions"><button class="btn btn-primary" data-close>Got it</button></div>');
  }

  function updateActiveNav(route) {
    const active = route === "/watch" || route === "/section" ? "/discover" :
      route === "/manga-library" ? "/manga" : route;
    $$("[data-route]").forEach(item => {
      const value = item.getAttribute("data-route");
      item.classList.toggle("active", value === active || (route.startsWith("/anime") && value === "/discover"));
    });
  }

  async function route() {
    const hash = location.hash.replace(/^#/, "") || "/home";
    if (state.route === "/home" && !hash.startsWith("/home") && state.spotlightTimer) {
      window.clearTimeout(state.spotlightTimer);
      state.spotlightTimer = null;
    }
    const parts = hash.split("?")[0].split("/").filter(Boolean);
    const current = "/" + (parts[0] || "home");
    state.route = current;
    document.body.dataset.view = current.slice(1);
    updateActiveNav(current);
    if (current === "/home") return renderHome();
    if (current === "/discover") return renderDiscover();
    if (current === "/manga") {
      const params = new URLSearchParams(hash.split("?")[1] || "");
      return renderManga(params.get("q") || "");
    }
    if (current === "/manga-library") return renderSavedManga();
    if (current === "/downloads") return renderDownloads();
    if (current === "/manga-section" && parts[1]) {
      const params = new URLSearchParams(hash.split("?")[1] || "");
      return renderMangaSection(parts[1], Math.max(1, Number(params.get("page") || 1)));
    }
    if (current === "/manga-detail" && parts[1]) return renderMangaDetails(parts[1]);
    if (current === "/section" && parts[1]) {
      const params = new URLSearchParams(hash.split("?")[1] || "");
      return renderSection(parts[1], Math.max(1, Math.min(250, Number(params.get("page") || 1))));
    }
    if (current === "/search") {
      const params = new URLSearchParams(hash.split("?")[1] || "");
      return renderSearch(params.get("q") || "");
    }
    if (current === "/library") return renderLibrary();
    if (current === "/history") return renderHistory();
    if (current === "/account") return renderAccount();
    if (current === "/news") return renderNews();
    if (current === "/notifications") return renderNotifications();
    if (current === "/settings") return renderSettings();
    if (current === "/anime" && parts[1]) return renderAnime(parts[1]);
    if (current === "/watch" && parts[1]) return renderWatch(parts[1], parts[2] || "1");
    location.hash = "#/home";
  }

  function navigate(path) {
    const next = "#" + path;
    if (location.hash === next) { void route(); return; }
    location.hash = next;
  }

  async function submitSearch(term) {
    const value = String(term || "").trim();
    if (!value) return;
    navigate("/search?q=" + encodeURIComponent(value));
  }

  document.addEventListener("click", async event => {
    const target = event.target.closest("button,a,article");
    if (event.target.matches?.("[data-close-modal]")) { closeModal(); return; }
    if (!target) return;
    if (target.hasAttribute("data-player-toggle")) {
      const video = $("#anime-video");
      if (video) {
        if (video.paused) video.play().catch(() => toast("Playback was blocked by this browser."));
        else video.pause();
        updateVideoControls();
      }
      return;
    }
    if (target.hasAttribute("data-player-jump")) {
      const video = $("#anime-video");
      if (video && Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + Number(target.getAttribute("data-player-jump"))));
        updateVideoControls();
      }
      return;
    }
    if (target.hasAttribute("data-player-speed")) {
      const video = $("#anime-video");
      if (video) {
        const speeds = [1, 1.25, 1.5, 2, 0.75];
        const next = (speeds.indexOf(video.playbackRate) + 1) % speeds.length;
        video.playbackRate = speeds[next];
        updateVideoControls();
      }
      return;
    }
    if (target.hasAttribute("data-player-fullscreen")) {
      const video = $("#anime-video");
      const frame = $(".video-frame");
      try {
        if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
        else if (frame?.requestFullscreen) await frame.requestFullscreen();
        else if (video?.webkitEnterFullscreen) video.webkitEnterFullscreen();
        else toast("Fullscreen is unavailable in this browser.");
      } catch (_) { toast("Fullscreen could not be opened."); }
      return;
    }
    if (target.hasAttribute("data-open-news")) {
      const item = state.news[Number(target.getAttribute("data-open-news"))];
      if (item && /^https:\/\//i.test(item.url)) {
        markNewsRead(item);
        window.open(item.url, "_blank", "noopener,noreferrer");
        if (state.route === "/notifications") renderNotifications();
        if (state.route === "/news") renderNews();
      }
      return;
    }
    if (target.hasAttribute("data-read-all-news")) {
      state.news.forEach(markNewsRead);
      renderNotifications();
      return;
    }
    if (target.hasAttribute("data-refresh-news")) { void loadNews(true); return; }
    if (target.hasAttribute("data-route")) {
      event.preventDefault();
      navigate(target.getAttribute("data-route"));
      return;
    }
    if (target.hasAttribute("data-anime")) {
      navigate("/anime/" + target.getAttribute("data-anime"));
      return;
    }
    if (target.hasAttribute("data-manga")) {
      navigate("/manga-detail/" + target.getAttribute("data-manga"));
      return;
    }
    if (target.hasAttribute("data-manga-section-page")) {
      navigate("/manga-section/" + encodeURIComponent(target.getAttribute("data-manga-section-page")) +
        "?page=" + Math.max(1, Number(target.getAttribute("data-page") || 1)));
      return;
    }
    if (target.hasAttribute("data-open-cbz")) {
      const el = $("#cbz-file-input");
      if (el) el.click();
      return;
    }
    if (target.hasAttribute("data-read-offline")) {
      try { await window.AniDashCBZ.openSaved(target.getAttribute("data-read-offline")); }
      catch (error) { toast(error.message); }
      return;
    }
    if (target.hasAttribute("data-remove-offline")) {
      const id = target.getAttribute("data-remove-offline");
      if (confirm("Remove this CBZ from offline storage? The original file on your device will not be deleted.")) {
        const ok = await window.AniDashStorage?.deleteMangaFile(id);
        toast(ok ? "Offline file removed." : "Could not remove this file.");
        if (ok && state.route === "/downloads") renderDownloads();
      }
      return;
    }
    if (target.hasAttribute("data-save-manga")) {
      const media = state.mangaDetail;
      if (!media) return;
      const key = String(media.id);
      store.mangaList[key] = media;
      persist();
      toast("Manga saved to this device.");
      if (window.AniDashAccount?.authenticated()) {
        window.AniDashAccount.saveManga(media.id).then(() => toast("Manga synced to AniList."))
          .catch(error => toast("Manga saved locally; AniList sync failed: " + error.message));
      }
      return;
    }
    if (target.hasAttribute("data-library-tab")) {
      state.libraryTab = target.getAttribute("data-library-tab");
      renderLibrary();
      return;
    }
    if (target.hasAttribute("data-library-favorite")) {
      const id = target.getAttribute("data-library-favorite");
      const key = String(id);
      const wasFavorite = Boolean(store.localFavorites[key]);
      if (wasFavorite) delete store.localFavorites[key];
      else store.localFavorites[key] = true;
      persist();
      renderLibrary();
      if (window.AniDashAccount?.authenticated()) {
        window.AniDashAccount.toggleFavorite(Number(id)).catch(error =>
          toast("Favorite updated locally; AniList sync failed: " + error.message));
      }
      return;
    }
    if (target.hasAttribute("data-spotlight-next") || target.hasAttribute("data-spotlight-prev") ||
        target.hasAttribute("data-spotlight-index")) {
      const direction = target.hasAttribute("data-spotlight-next") ? 1 : -1;
      showSpotlight(target.hasAttribute("data-spotlight-index")
        ? Number(target.getAttribute("data-spotlight-index"))
        : state.spotlightIndex + direction);
      return;
    }
    if (target.hasAttribute("data-section-page")) {
      const key = target.getAttribute("data-section-page");
      const page = Math.max(1, Number(target.getAttribute("data-page") || 1));
      navigate(sectionUrl(key) + "?page=" + page);
      return;
    }
    if (target.hasAttribute("data-watchlist")) {
      void toggleWatchlist(target.getAttribute("data-watchlist"));
      return;
    }
    if (target.hasAttribute("data-login-anilist")) {
      try { await window.AniDashAccount.beginLogin(); }
      catch (error) { toast(error.message); }
      return;
    }
    if (target.hasAttribute("data-login-mal")) {
      try { await window.AniDashMal.beginLogin(); }
      catch (error) { toast(error.message); }
      return;
    }
    if (target.hasAttribute("data-logout-mal")) {
      if (confirm("Sign out of MyAnimeList? Local lists will remain saved.")) {
        window.AniDashMal?.logout();
        refreshProfileChip(window.AniDashAccount?.currentUser());
        renderAccount();
      }
      return;
    }
    if (target.hasAttribute("data-sync-mal")) {
      toast("Importing MyAnimeList…");
      const items = await syncMalLibrary();
      if (items) toast("Imported " + items.length + " MyAnimeList entries.");
      return;
    }
    if (target.hasAttribute("data-sync-all")) {
      await Promise.all([syncAniListLibrary(), syncMalLibrary()]);
      toast("Available tracking lists refreshed.");
      return;
    }
    if (target.hasAttribute("data-logout-anilist")) {
      if (confirm("Sign out of AniList on this device? Your local watchlist stays saved.")) {
        window.AniDashAccount?.logout();
        toast("Signed out. Local watchlist remains available.");
        renderAccount();
      }
      return;
    }
    if (target.hasAttribute("data-sync-library")) {
      toast("Syncing your AniList library…");
      const synced = await syncAniListLibrary();
      if (synced) toast("AniList library updated · " + synced.length + " entries available.");
      return;
    }
    if (target.hasAttribute("data-export-backup")) {
      try {
        const payload = {
          format: "anidash-watch-library",
          version: 2, exportedAt: new Date().toISOString(),
          watchlist: store.watchlist, history: store.history, mangaList: store.mangaList,
          libraryStatuses: store.libraryStatuses, localFavorites: store.localFavorites,
          malStatuses: store.malStatuses, preferences: store.preferences,
          hiddenCloudEntries: store.hiddenCloudEntries
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "anidash-watch-backup.json";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast("Backup exported.");
      } catch (error) { toast("Export failed: " + error.message); }
      return;
    }
    if (target.hasAttribute("data-import-backup")) {
      const input = $("#backup-file");
      if (input) input.click();
      return;
    }
    if (target.hasAttribute("data-persist-storage")) {
      if (navigator.storage?.persist) {
        const granted = await navigator.storage.persist();
        toast(granted ? "Persistent storage granted." : "Storage request declined. Export backups regularly.");
      } else toast("Persistent storage is not supported by this browser.");
      return;
    }
    if (target.hasAttribute("data-open-sources")) { openSourcesModal(); return; }
    if (target.hasAttribute("data-refresh-sources")) { if (state.detail) renderAnime(String(state.detail.id)); return; }
    if (target.hasAttribute("data-retry-sources")) {
      if (state.player) {
        state.player.failedProviders = [];
        state.player.candidates = [];
        state.player.candidateIndex = 0;
        state.player.streams = [];
        state.player.embeds = [];
        state.player.servers = [];
        state.player.selectedServer = ({ justanime: "auto", hianime: "hd-1", anikoto: "anikoto" }[state.player.match?.provider?.id] || "auto");
        loadPlayerStreams(state.token);
      }
      return;
    }
    if (target.hasAttribute("data-play-video")) {
      const video = $("#anime-video");
      if (video) {
        video.play().then(() => {
          const overlay = $("#player-overlay");
          if (overlay) overlay.style.display = "none";
        }).catch(() => toast("Unable to start this stream. Try another server."));
      }
      return;
    }
    if (target.hasAttribute("data-install")) { openInstallGuide(); return; }
    if (target.hasAttribute("data-close")) { closeModal(); return; }
    if (target.hasAttribute("data-play-first")) {
      const saved = setting("trackProgress") ? store.history[String(state.detail?.id)] : null;
      const first = saved
        ? state.detailEpisodes.find(ep => Number(ep.number) === Number(saved.episode)) || state.detailEpisodes[0]
        : state.detailEpisodes[0];
      if (first) startEpisode(first.number, first.id);
      return;
    }
    if (target.hasAttribute("data-play-episode")) {
      const pair = target.getAttribute("data-play-episode").split("|");
      startEpisode(pair[0], pair[1]);
      return;
    }
    if (target.hasAttribute("data-player-episode")) {
      const number = target.getAttribute("data-player-episode");
      const item = state.detailEpisodes.find(ep => Number(ep.number) === Number(number));
      if (item) {
        const oldVideo = $("#anime-video");
        if (oldVideo) { savePlaybackProgress(oldVideo, false, true); oldVideo.pause(); }
        state.player.episode = item;
        navigate("/watch/" + state.player.media.id + "/" + item.number);
      }
      return;
    }
    if (target.hasAttribute("data-next") || target.hasAttribute("data-prev")) {
      const direction = target.hasAttribute("data-next") ? 1 : -1;
      const index = state.detailEpisodes.findIndex(ep => Number(ep.number) === Number(state.player.episode.number));
      const item = state.detailEpisodes[index + direction];
      if (item) {
        const oldVideo = $("#anime-video");
        if (oldVideo) { savePlaybackProgress(oldVideo, false, true); oldVideo.pause(); }
        state.player.episode = item;
        navigate("/watch/" + state.player.media.id + "/" + item.number);
      }
      return;
    }
    if (target.hasAttribute("data-resume")) {
      const item = store.history[target.getAttribute("data-resume")];
      if (item) {
        const media = item.media;
        state.detail = media;
        state.detailMatches = [];
        state.detailEpisodes = [];
        state.selectedMatch = null;
        state.episodePage = 1;
        state.episodeFilter = "";
        state.playerEpisodePage = 1;
        state.playerEpisodeFilter = "";
        state.player = { media: media, episode: { id: String(item.episode), number: item.episode, title: item.episodeTitle || "Episode " + item.episode }, match: null, streams: [], embeds: [], availableProviders: [], servers: [], tracks: [], selectedServer: "default", category: "dub" };
        navigate("/watch/" + media.id + "/" + item.episode);
      }
      return;
    }
    if (target.hasAttribute("data-episode-go")) {
      jumpToEpisode(target.getAttribute("data-episode-go"));
      return;
    }
    if (target.hasAttribute("data-episode-page")) {
      const scope = target.getAttribute("data-episode-scope") || "detail";
      const pageSize = scope === "player" ? PLAYER_EPISODES_PER_PAGE : DETAIL_EPISODES_PER_PAGE;
      const filtered = matchingEpisodes(
        state.detailEpisodes,
        scope === "player" ? state.playerEpisodeFilter : state.episodeFilter
      );
      const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
      let page = scope === "player" ? state.playerEpisodePage : state.episodePage;
      const action = target.getAttribute("data-episode-page");
      if (action === "first") page = 1;
      else if (action === "prev") page--;
      else if (action === "next") page++;
      else if (action === "last") page = pageCount;
      page = Math.max(1, Math.min(pageCount, page));
      if (scope === "player") {
        state.playerEpisodePage = page;
        renderPlayerEpisodeBrowser();
      } else {
        state.episodePage = page;
        renderEpisodeBrowser();
      }
      return;
    }
    if (target.hasAttribute("data-provider")) {
      const providerId = target.getAttribute("data-provider");
      const match = (state.detailMatches || []).find(item => item && item.episodesReady && item.provider.id === providerId);
      if (match) {
        state.player.match = match;
        state.player.manualProvider = true;
        state.player.failedProviders = [];
        state.player.candidates = [];
        state.player.candidateIndex = 0;
        state.player.streams = [];
        state.player.embeds = [];
        state.player.servers = [];
        state.player.selectedServer = ({ justanime: "auto", hianime: "hd-1", anikoto: "anikoto" }[providerId] || "auto");
        loadPlayerStreams(state.token);
      }
      return;
    }
    if (target.hasAttribute("data-category")) {
      const category = target.getAttribute("data-category");
      state.player.category = category;
      state.player.failedProviders = [];
      state.player.candidates = [];
      state.player.candidateIndex = 0;
      state.player.streams = [];
      state.player.embeds = [];
      state.player.servers = [];
      state.player.selectedServer = ({ justanime: "auto", hianime: "hd-1", anikoto: "anikoto" }[state.player.match?.provider?.id] || "auto");
      $$("[data-category]").forEach(el => el.classList.toggle("active", el.getAttribute("data-category") === category));
      loadPlayerStreams(state.token);
      return;
    }
    if (target.hasAttribute("data-server")) {
      state.player.selectedServer = target.getAttribute("data-server");
      state.player.failedProviders = [];
      state.player.candidates = [];
      state.player.candidateIndex = 0;
      state.player.streams = [];
      state.player.embeds = [];
      loadPlayerStreams(state.token);
      return;
    }
    if (target.hasAttribute("data-stream")) {
      const index = Number(target.getAttribute("data-stream"));
      const list = Array.isArray(state.player.candidates) && state.player.candidates.length
        ? state.player.candidates
        : (state.player.streams.length ? state.player.streams : (state.player.embeds || []));
      const stream = list[index];
      if (stream) {
        state.player.candidateIndex = index;
        $$("[data-stream]").forEach(el => el.classList.toggle("active", Number(el.getAttribute("data-stream")) === index));
        renderPlayerOptions();
        attachStream(stream.url || stream.src || stream.file, stream, stream.isEmbed ? [] : state.player.tracks);
      }
      return;
    }
    if (target.hasAttribute("data-skip")) {
      const video = $("#anime-video");
      const range = target.getAttribute("data-skip") === "intro" ? state.player.intro : state.player.outro;
      if (video && range && Number.isFinite(Number(range.end))) {
        video.currentTime = Number(range.end);
        video.play().catch(() => {});
      }
      return;
    }
    if (target.hasAttribute("data-clear-history")) {
      if (confirm("Clear all locally saved watch progress?")) {
        store.history = {};
        persist();
        if (state.route === "/settings") renderSettings();
        toast("Local playback progress cleared.");
      }
      return;
    }
    if (target.hasAttribute("data-clear-watchlist")) {
      if (confirm("Clear your local watchlist?")) {
        Object.keys(store.watchlist).forEach(key => { store.hiddenCloudEntries[key] = true; });
        store.watchlist = {};
        persist();
        if (state.route === "/settings") renderSettings();
        if (state.route === "/library") renderLibrary();
        toast("Local watchlist cleared. AniList account entries were not changed.");
      }
      return;
    }
  });

  document.addEventListener("submit", event => {
    if (event.target.id === "manga-search-form") {
      event.preventDefault();
      navigate("/manga?q=" + encodeURIComponent($("#manga-search-input")?.value?.trim() || ""));
      return;
    }
    if (event.target.id === "search-form") {
      event.preventDefault();
      submitSearch($("#search-page-input").value);
    }
  });

  document.addEventListener("anidash:downloads-changed", () => {
    if (state.route === "/downloads") renderDownloads();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && $(".modal-backdrop")) { closeModal(); event.preventDefault(); }
  });
  document.addEventListener("change", async event => {
    if (event.target.id === "cbz-file-input") {
      const file = event.target.files?.[0];
      if (file && window.AniDashCBZ) {
        window.AniDashCBZ.open(file).catch(error => toast("Reader error: " + error.message));
      }
      return;
    }
    if (event.target.hasAttribute("data-library-status")) {
      const id = String(event.target.getAttribute("data-library-status"));
      const value = event.target.value;
      if (!LIBRARY_TABS.some(([status]) => status === value) || value === "FAVORITES") return;
      store.libraryStatuses[id] = value;
      persist(); renderLibrary();
      if (window.AniDashAccount?.authenticated()) {
        window.AniDashAccount.setStatus(Number(id),value).catch(error =>
          toast("Saved locally; AniList status update failed: " + error.message));
      }
      return;
    }
    if (event.target.id === "backup-file") {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        if (file.size > 5_000_000) throw new Error("Backup is too large (maximum 5 MB).");
        const payload = JSON.parse(await file.text());
        if (payload?.format !== "anidash-watch-library" || !payload.watchlist ||
            typeof payload.watchlist !== "object" || Array.isArray(payload.watchlist)) {
          throw new Error("This isn't an AniDash Watch backup.");
        }
        // Validate keys before merging to avoid imported prototype pollution.
        const safeEntries = obj => Object.fromEntries(
          Object.entries(obj || {}).filter(([id]) => /^\d{1,12}$/.test(id))
        );
        store.watchlist = { ...store.watchlist, ...safeEntries(payload.watchlist) };
        store.history = { ...store.history, ...safeEntries(payload.history) };
        store.mangaList = { ...store.mangaList, ...safeEntries(payload.mangaList) };
        store.libraryStatuses = { ...store.libraryStatuses, ...safeEntries(payload.libraryStatuses) };
        store.localFavorites = { ...store.localFavorites, ...safeEntries(payload.localFavorites) };
        store.malStatuses = { ...store.malStatuses, ...safeEntries(payload.malStatuses) };
        const allowed = Object.keys(DEFAULT_PREFERENCES);
        for (const key of allowed) {
          if (Object.prototype.hasOwnProperty.call(payload.preferences || {}, key)) {
            store.preferences[key] = payload.preferences[key];
          }
        }
        store.hiddenCloudEntries = { ...store.hiddenCloudEntries, ...safeEntries(payload.hiddenCloudEntries) };
        persist();
        applyPreferences();
        if (state.route === "/settings") renderSettings();
        toast("Backup restored. Your existing library was preserved.");
      } catch (error) { toast("Restore failed: " + error.message); }
      return;
    }
    if (event.target.hasAttribute("data-setting")) {
      const key = event.target.getAttribute("data-setting");
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_PREFERENCES, key)) return;
      store.preferences[key] = event.target.type === "checkbox"
        ? Boolean(event.target.checked) : event.target.value;
      persist();
      applyPreferences();
      toast("Preference saved.");
      return;
    }
    if (event.target.id === "discover-sort") {
      state.discoverSort = event.target.value;
      renderDiscover();
    }
  });

  document.addEventListener("input", event => {
    if (event.target.id === "settings-filter") {
      const query = String(event.target.value || "").trim().toLowerCase();
      const groups = $(".settings-screen .settings-group");
      const headings = $(".settings-screen .settings-section-label");
      groups.forEach((group, index) => {
        const title = String(headings[index]?.textContent || "").toLowerCase();
        const rows = Array.from(group.querySelectorAll(".preference-row"));
        let visible = 0;
        rows.forEach(row => {
          const matches = !query || title.includes(query) ||
            String(row.textContent || "").toLowerCase().includes(query);
          row.hidden = !matches;
          if (matches) visible++;
        });
        group.hidden = visible === 0;
        if (headings[index]) headings[index].hidden = visible === 0;
      });
      return;
    }
    if (event.target.id === "video-seek") {
      const video = $("#anime-video");
      if (video && Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.max(0, Math.min(video.duration, Number(event.target.value) / 1000 * video.duration));
        updateVideoControls();
      }
      return;
    }
    if (event.target.id === "episode-filter") {
      state.episodeFilter = event.target.value;
      state.episodePage = 1;
      renderEpisodeBrowser();
    }
    if (event.target.id === "player-episode-filter") {
      state.playerEpisodeFilter = event.target.value;
      state.playerEpisodePage = 1;
      renderPlayerEpisodeBrowser();
    }
  });

  const globalSearch = $("#global-search");
  globalSearch.addEventListener("keydown", event => {
    if (event.key === "Enter") submitSearch(globalSearch.value);
  });

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    state.installEvent = event;
    const button = $(".install-button");
    if (button) button.style.color = "var(--accent)";
  });


  // Stop orphaned audio and destroy HLS when leaving playback.
  window.addEventListener("hashchange", () => {
    if (typeof window.scrollTo === "function") window.scrollTo(0, 0);
    const nextRoute = location.hash.replace(/^#\//, "").split("/")[0];
    if (nextRoute !== "watch") {
      const video = $("#anime-video");
      const embed = $("#anime-embed");
      if (video) { savePlaybackProgress(video, false, true); video.pause(); video.removeAttribute("src"); video.load(); }
      if (embed) embed.src = "about:blank";
      if (state.hls) { try { state.hls.destroy(); } catch (_) {} state.hls = null; }
      if (state.playbackWatchdog) { window.clearTimeout(state.playbackWatchdog); state.playbackWatchdog = null; }
      if (state.player) state.player.requestId = (state.player.requestId || 0) + 1;
    }
    route();
  });
  window.addEventListener("pagehide", () => {
    const video = $("#anime-video");
    if (video) savePlaybackProgress(video, false, true);
    persist();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      const video = $("#anime-video");
      if (video) savePlaybackProgress(video, false, true);
    } else if (document.visibilityState === "visible") {
      passiveCloudRefresh();
    }
  });
  window.addEventListener("storage", event => {
    if (event.key !== STORE_KEY || !event.newValue) return;
    try {
      const data = JSON.parse(event.newValue);
      if (Number(data.updatedAt || 0) > Number(store.updatedAt || 0)) {
        Object.assign(store, data);
        store.preferences = { ...DEFAULT_PREFERENCES, ...store.preferences };
        applyPreferences();
        if (state.route === "/library") renderLibrary();
        if (state.route === "/settings") renderSettings();
      }
    } catch (_) {}
  });

  let lastPassiveCloudRefresh = 0;
  let passiveRefreshPending = null;
  function passiveCloudRefresh() {
    if (state.route === "/watch" || !navigator.onLine ||
        (!window.AniDashAccount?.authenticated() && !window.AniDashMal?.authenticated())) return;
    const now = Date.now();
    if (passiveRefreshPending || now - lastPassiveCloudRefresh < 120000) return;
    lastPassiveCloudRefresh = now;
    passiveRefreshPending = Promise.allSettled([
      syncAniListLibrary(), syncMalLibrary()
    ]).finally(() => { passiveRefreshPending = null; });
  }
  window.addEventListener("online", () => {
    toast("You are back online.");
    passiveCloudRefresh();
  });
  window.addEventListener("offline", () => toast("You are offline. The app shell is still available."));

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(registration => registration.update()).catch(() => {}));
  }

  loadProviders();
  const accountClient = window.AniDashAccount;
  const malClient = window.AniDashMal;
  if (accountClient) accountClient.captureRedirect();
  // Complete the OAuth callback before drawing Account; query-string codes
  // are cleared immediately by the MAL client.
  Promise.resolve().then(async () => {
    if (malClient) {
      try { await malClient.captureRedirect(); }
      catch (error) { toast("MyAnimeList login failed: " + error.message); }
    }
    await restoreStorage();
  }).finally(() => {
    route();
    if (accountClient) {
      accountClient.setHandler(user => {
        refreshProfileChip(user);
        if (state.route === "/account") renderAccount();
        if (state.route === "/library") renderLibrary();
      });
      accountClient.init().then(async user => {
        refreshProfileChip(user);
        if (user) await syncAniListLibrary();
      }).catch(() => {});
    }
    if (malClient) {
      malClient.setHandler(user => {
        refreshProfileChip(accountClient?.currentUser());
        if (state.route === "/account") renderAccount();
        if (state.route === "/library") renderLibrary();
      });
      malClient.configuration().then(() => {
        if (state.route === "/account") renderAccount();
      }).catch(() => {});
      malClient.init().then(async user => {
        refreshProfileChip(accountClient?.currentUser());
        if (user) await syncMalLibrary();
      }).catch(() => {});
    }
  });
})();