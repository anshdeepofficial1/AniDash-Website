(() => {
  "use strict";

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const STORE_KEY = "anidash.watch.web.v1";
  const API = "https://graphql.anilist.co";
  const MEDIA_FIELDS = [
    "id idMal",
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
        manualStreams: raw.manualStreams || {},
        providerManifest: raw.providerManifest || null,
        adultContent: raw.adultContent === true
      };
    } catch (_) {
      return { watchlist: {}, history: {}, manualStreams: {}, providerManifest: null, adultContent: false };
    }
  }

  const store = readStore();
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
    progressTimer: 0
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

  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
    catch (_) { toast("This browser storage is full. Some history may not save."); }
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

  async function gql(query, variables) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ query: query, variables: variables || {} }),
        signal: controller.signal
      });
      const body = await response.json();
      if (!response.ok || body.errors) {
        const message = body.errors && body.errors[0] && body.errors[0].message;
        throw new Error(message || "AniList is temporarily unavailable.");
      }
      return body.data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("AniList request timed out. Please retry.");
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function pageQuery(sort, page, perPage, extra) {
    return "query ($page: Int, $perPage: Int) { Page(page: $page, perPage: $perPage) { pageInfo { hasNextPage currentPage lastPage } media(type: ANIME, sort: " +
      sort + ", isAdult: false" + (extra || "") + ") { " + MEDIA_FIELDS + " } } }";
  }

  async function getCollection(sort, page, perPage, extra) {
    const data = await gql(pageQuery(sort, page || 1, perPage || 18, extra || ""), { page: page || 1, perPage: perPage || 18 });
    return data.Page;
  }

  async function getAnime(id) {
    const query = "query ($id: Int) { Media(id: $id, type: ANIME) { " + MEDIA_FIELDS +
      " description(asHtml: false) studios(isMain: true) { nodes { name } } relations { edges { relationType node { id type title { english romaji } coverImage { large } } } } recommendations(sort: RATING_DESC) { nodes { mediaRecommendation { id title { english romaji } coverImage { large } averageScore format } } } trailer { id site thumbnail } } }";
    const data = await gql(query, { id: Number(id) });
    return data.Media;
  }

  async function searchAniList(term, page) {
    const query = "query ($search: String!, $page: Int, $perPage: Int) { Page(page: $page, perPage: $perPage) { pageInfo { hasNextPage } media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: false) { " + MEDIA_FIELDS + " } } }";
    const data = await gql(query, { search: term, page: page || 1, perPage: 24 });
    return data.Page;
  }

  function showLoading(message) {
    $("#view").innerHTML = '<section class="loading-state"><div class="loader"></div><p>' + escapeHtml(message || "Loading…") + '</p></section>';
  }

  function card(media) {
    const progress = store.history[String(media.id)];
    const poster = imageOf(media);
    const pct = progress && progress.duration > 0 ? Math.max(0, Math.min(100, (progress.position / progress.duration) * 100)) : 0;
    return '<article class="anime-card" data-anime="' + escapeHtml(media.id) + '" tabindex="0" role="button" aria-label="Open ' + escapeHtml(titleOf(media)) + '">' +
      '<div class="poster-wrap">' +
        (poster ? '<img loading="lazy" src="' + escapeHtml(poster) + '" alt="' + escapeHtml(titleOf(media)) + '">' : '<div class="poster-fallback">' + escapeHtml(titleOf(media)) + '</div>') +
        '<div class="poster-shade"></div>' +
        (media.averageScore ? '<span class="poster-score">★ ' + formatScore(media.averageScore) + '</span>' : '') +
        (media.format ? '<span class="poster-format">' + escapeHtml(media.format) + '</span>' : '') +
      '</div>' +
      '<div class="card-title">' + escapeHtml(titleOf(media)) + '</div>' +
      '<p class="card-subtitle">' + escapeHtml([mediaYear(media), media.episodes ? media.episodes + " eps" : media.status].filter(Boolean).join(" · ")) + '</p>' +
      (progress ? '<div class="card-progress"><span style="width:' + pct + '%"></span></div><div class="card-resume">Resume episode ' + escapeHtml(progress.episode || 1) + '</div>' : '') +
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
      (route ? '<button class="section-link" data-route="' + route + '">View all ↗</button>' : '') +
      '</div><div class="anime-shelf">' + rows.map(card).join("") + '</div></section>';
  }

  function resumeShelf(items) {
    const rows = (items || []).filter(item => item && item.media);
    if (!rows.length) return "";
    return '<section class="section shelf-section"><div class="section-heading"><div><h2 class="section-title">Continue watching</h2><p class="section-note">Pick up exactly where you stopped.</p></div><button class="section-link" data-route="/history">View history ↗</button></div>' +
      '<div class="anime-shelf">' + rows.map(item => {
        const media = item.media;
        const pct = item.duration > 0 ? Math.min(100, Math.max(0, item.position / item.duration * 100)) : 0;
        const poster = imageOf(media);
        return '<article class="anime-card resume-card" data-resume="' + escapeHtml(media.id) + '" tabindex="0" role="button" aria-label="Resume ' + escapeHtml(titleOf(media)) + ' episode ' + escapeHtml(item.episode) + '">' +
          '<div class="poster-wrap">' + (poster ? '<img loading="lazy" src="' + escapeHtml(poster) + '" alt="">' : '<div class="poster-fallback">' + escapeHtml(titleOf(media)) + '</div>') +
          '<span class="poster-score">EP ' + escapeHtml(item.episode || 1) + '</span><span class="resume-play">▶</span></div>' +
          '<div class="card-title">' + escapeHtml(titleOf(media)) + '</div><p class="card-subtitle">' + escapeHtml(item.episodeTitle || ("Episode " + (item.episode || 1))) + '</p>' +
          '<div class="card-progress"><span style="width:' + pct + '%"></span></div></article>';
      }).join("") + '</div></section>';
  }

  function pageHead(eyebrow, title, subtitle, extra) {
    return '<div class="page-head"><div><div class="eyebrow">' + escapeHtml(eyebrow) + '</div><h1 class="page-title">' + escapeHtml(title) + '</h1>' +
      (subtitle ? '<p class="page-subtitle">' + escapeHtml(subtitle) + '</p>' : '') + '</div>' + (extra || '') + '</div>';
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
      const hero = trending[0] || popular[0] || top[0];
      const heroImage = hero && (hero.bannerImage || imageOf(hero));
      const continueItems = Object.values(store.history)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 10);
      const watchlistItems = Object.values(store.watchlist).slice(0, 12);

      const quickLinks = '<div class="home-shortcuts">' +
        '<button data-route="/discover"><span>◈</span> Discover</button>' +
        '<button data-route="/search"><span>⌕</span> Search anime</button>' +
        '<button data-route="/library"><span>♡</span> My watchlist</button>' +
        '<button data-route="/history"><span>◷</span> History</button>' +
      '</div>';

      $("#view").innerHTML =
        (hero ? '<section class="hero-stage home-hero"><div class="hero-bg" style="background-image:url(&quot;' + escapeHtml(heroImage) + '&quot;)"></div><div class="hero-content">' +
          '<div class="hero-kicker">Your next anime obsession</div><h1 class="hero-title">' + escapeHtml(titleOf(hero)) + '</h1>' +
          '<div class="hero-meta"><span>★ ' + formatScore(hero.averageScore) + '</span><span>' + escapeHtml(hero.format || "Anime") + '</span><span>' + escapeHtml(mediaYear(hero)) + '</span><span>' + escapeHtml(hero.status || "") + '</span></div>' +
          '<p class="hero-description">' + escapeHtml(cleanText(hero.description) || "Explore the story, browse episodes and discover more anime.") + '</p>' +
          '<div class="hero-actions"><button class="btn btn-primary" data-anime="' + hero.id + '">Explore anime <span>→</span></button><button class="btn btn-secondary" data-watchlist="' + hero.id + '">♡ Add to list</button></div>' +
          '</div></section>' : '') +
        quickLinks +
        resumeShelf(continueItems) +
        shelf("Airing this week", "Fresh episodes from currently releasing series.", airing.slice(0, 14), "/discover") +
        shelf("Trending right now", "The series viewers are talking about.", trending.slice(0, 14), "/discover") +
        shelf("Popular with fans", "Big adventures, favourites and crowd-pleasers.", popular.slice(0, 14), "/discover") +
        (watchlistItems.length ? shelf("From your watchlist", "Saved anime, ready when you are.", watchlistItems, "/library") : '') +
        shelf("Coming soon", "Upcoming anime to add to your list.", upcoming.slice(0, 14), "/discover") +
        shelf("Anime movies", "Feature-length stories for your next movie night.", movies.slice(0, 14), "/discover") +
        shelf("Top rated", "Highly rated titles from the AniList catalogue.", top.slice(0, 14), "/discover") +
        shelf("Hidden gems", "Well-rated series beyond the most popular charts.", hidden.slice(0, 14), "/discover");
    } catch (error) {
      if (token !== state.token) return;
      $("#view").innerHTML = '<div class="empty-state"><div class="empty-icon">◌</div><h3>Could not load the catalogue</h3><p>' + escapeHtml(error.message) + '</p><button class="btn btn-primary" data-route="/home">Try again</button></div>';
    }
  }

  async function renderDiscover() {
    const token = ++state.token;
    showLoading("Loading the catalogue…");
    try {
      const sort = state.discoverSort || "TRENDING_DESC";
      const data = await getCollection(sort, 1, 30);
      if (token !== state.token) return;
      state.discover = data.media;
      const options = [
        ["TRENDING_DESC", "Trending"], ["POPULARITY_DESC", "Most popular"], ["SCORE_DESC", "Top rated"]
      ];
      $("#view").innerHTML = pageHead("THE ANIME INDEX", "Find your next story", "Explore AniList metadata, ratings, seasons and series information.") +
        '<div class="toolbar"><select class="select-control" id="discover-sort">' + options.map(o => '<option value="' + o[0] + '"' + (sort === o[0] ? " selected" : "") + '>' + o[1] + '</option>').join("") + '</select><span class="form-help">Adult catalogue entries are hidden by default.</span></div>' +
        '<div style="height:18px"></div><div id="discover-grid">' + grid(data.media) + '</div>';
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
    const response = await fetch("/api/" + encodeURIComponent(provider.id) + "?" + params.toString(), {
      method: "GET",
      headers: { "Accept": "application/json" },
      cache: action === "streams" ? "no-store" : "default"
    });
    let payload;
    try { payload = await response.json(); }
    catch (_) { throw new Error(provider.name + " returned an invalid response."); }
    if (!response.ok || payload?.error) {
      throw new Error(payload?.error || (provider.name + " returned HTTP " + response.status));
    }
    return payload;
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
    const total = Number(media.episodes || 0);
    if (!total) return [];
    const limit = Math.min(total, 300);
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
      '<button class="player-episode' + (Number(episode.number) === Number(state.player.episode.number) ? " active" : "") + '" data-player-episode="' + episode.number + '"><span>' + episode.number + '</span>' + escapeHtml(episode.title) + '</button>'
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

    // If no native provider can supply an episode list, preserve Android's
    // AniList mapping fallback for display. This mapped HiAnime entry is kept
    // as a last-resort stream candidate only; it never blocks other providers.
    const hasEpisodes = checked.some(match => match && match.episodesReady);
    if (!hasEpisodes) {
      const hianime = BUILTIN_PROVIDERS.find(provider => provider.id === "hianime");
      if (hianime) {
        const mappedMatch = {
          provider: hianime,
          animeId: String(media.id),
          item: { id: String(media.id), title: titleOf(media) },
          score: 0,
          mapped: true,
          idSource: "AniList"
        };
        try {
          const episodes = await episodesFromMatch(mappedMatch, media);
          if (episodes.length) checked.push({ ...mappedMatch, episodes, episodesReady: true, mappingOnly: true });
        } catch (_) {}
      }
    }

    // The AniKoto web API can block its server-side AJAX stream calls. Keep a
    // mapped AniKoto entry available using the same AniList episode numbers;
    // its backend can then fall back to the official project's direct embed
    // provider route without requiring the blocked site session endpoint.
    const hasAniKoto = checked.some(match => match && match.provider.id === "anikoto" && match.episodesReady);
    const episodeSource = checked.find(match => match && match.episodesReady && match.episodes && match.episodes.length);
    const anikoto = BUILTIN_PROVIDERS.find(provider => provider.id === "anikoto");
    if (!hasAniKoto && anikoto && episodeSource && (media.id != null || media.idMal != null)) {
      checked.push({
        provider: anikoto,
        animeId: String(media.id || media.idMal),
        item: { id: String(media.id || media.idMal), title: titleOf(media) },
        score: 0,
        mapped: true,
        embedOnly: true,
        idSource: "AniList/MAL",
        episodes: episodeSource.episodes.map(item => ({ ...item, id: String(item.number) })),
        episodesReady: true
      });
    }

    const order = { justanime: 0, hianime: 1, anikoto: 2 };
    checked.sort((a, b) => (order[a.provider?.id] ?? 9) - (order[b.provider?.id] ?? 9));
    const selected = checked.find(match => match && match.episodesReady) || null;
    return { matches: checked, selected, episodes: selected ? selected.episodes : [] };
  }

  async function renderAnime(id) {
    const token = ++state.token;
    state.detail = null;
    state.detailMatches = [];
    state.detailEpisodes = [];
    state.selectedMatch = null;
    state.episodePage = 1;
    state.episodeFilter = "";
    showLoading("Loading anime details…");
    try {
      const media = await getAnime(id);
      if (token !== state.token) return;
      state.detail = media;
      $("#view").innerHTML = '<div class="loading-state"><div class="loader"></div><p>Checking JustAnime, HiAnime and AniKoto…</p></div>';
      const prepared = await prepareMediaSources(media);
      if (token !== state.token) return;
      state.detailMatches = prepared.matches;
      state.selectedMatch = prepared.selected;
      state.detailEpisodes = prepared.episodes.length ? prepared.episodes : generatedEpisodes(media);
      paintAnimeDetails(media);
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
    const sourceInfo = matches.length ? matches.map(match => match.provider.name + (match.mapped ? " (episode map)" : "")).join(", ") : "Built-in sources checked";
    const episodes = state.detailEpisodes || [];
    const providerRows = BUILTIN_PROVIDERS.map(provider => {
      const result = state.detailMatches.find(match =>
        match && match.provider && match.provider.id === provider.id && match.episodesReady && Array.isArray(match.episodes)
      ) || state.detailMatches.find(match => match && match.provider && match.provider.id === provider.id);
      const available = result && !result.error && result.episodesReady === true;
      const status = available ? (result.mapped ? "Episode map ready" : "Title matched") :
        result && result.error && result.error.toLowerCase().includes("no confident title match") ? "No title match" :
        result && result.error ? "Temporarily unavailable" : "Checking";
      const detail = available ? (result.mapped ? "AniList episode mapping fallback" : "Episode source found") :
        result && result.error ? result.error : "Source check has not completed";
      return '<div class="builtin-source-row"><div><strong>' + escapeHtml(provider.name) + '</strong><span>' + escapeHtml(provider.description) + '</span></div><div class="builtin-source-status ' + (available ? "is-ready" : "is-muted") + '"><b>' + escapeHtml(status) + '</b><small>' + escapeHtml(detail) + '</small></div></div>';
    }).join("");
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
      '<div class="details-layout"><section class="content-panel"><div class="section-heading"><div><h2 class="panel-title">Episodes</h2><p class="section-note">' + (matches.length ? "Source: " + escapeHtml(sourceInfo) : "AniDash checks all three built-in providers and uses AniList episode mapping as a fallback.") + '</p></div><span class="watchlist-badge">' + episodes.length + ' listed</span></div>' +
        '<div class="episode-toolbar"><select id="episode-source" class="select-control">' + (matches.length ? matches.map((match, index) => '<option value="' + index + '"' + (match === state.selectedMatch ? " selected" : "") + '>' + escapeHtml(match.provider.name + (match.mapped ? " (episode map)" : "")) + '</option>').join("") : '<option value="">No episode source available</option>') + '</select><input id="episode-filter" class="input-control" style="max-width:180px" placeholder="Search episodes…"><input id="episode-jump" class="input-control episode-jump-input" type="number" min="1" placeholder="EP #"><button class="btn btn-quiet" data-episode-go="detail">Go</button><button class="btn btn-quiet" data-refresh-sources>Retry sources</button></div>' +
        '<div id="episode-list" class="episode-list"></div><div id="episode-pagination"></div>' +
        (!episodes.length ? '<div class="notice" style="margin-top:14px">No episode list was returned. Check the source status below and retry when an upstream service is available.</div>' : '') +
        '<div class="builtin-sources-panel"><div class="section-heading"><div><h3 class="panel-title">Built-in sources</h3><p class="section-note">These three sources are included with AniDash. No extensions are needed.</p></div></div>' + providerRows + '</div>' +
      '</section><aside class="content-panel"><h2 class="panel-title">About this anime</h2><div class="info-list">' +
        infoRow("Genres", genres.length ? genres.join(", ") : "Not listed") +
        infoRow("Season", [media.season, media.seasonYear].filter(Boolean).join(" ") || "Not listed") +
        infoRow("Studios", media.studios && media.studios.nodes.length ? media.studios.nodes.map(studio => studio.name).join(", ") : "Not listed") +
        infoRow("MyAnimeList", malLink) +
        infoRow("AniList", '<a href="https://anilist.co/anime/' + media.id + '" target="_blank" rel="noopener">Open AniList ↗</a>') +
        infoRow("Sources", sourceInfo) +
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
    const thumb = episode.thumbnail ? '<img class="episode-thumb" loading="lazy" src="' + escapeHtml(episode.thumbnail) + '" alt="">' : '<div class="episode-thumb"></div>';
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

  function toggleWatchlist(id) {
    const key = String(id);
    if (store.watchlist[key]) {
      delete store.watchlist[key];
      toast("Removed from your watchlist.");
    } else {
      const media = state.detail && String(state.detail.id) === key ? state.detail :
        state.home && [...state.home.trending, ...state.home.popular].find(item => String(item.id) === key);
      if (media) store.watchlist[key] = media;
      else store.watchlist[key] = { id: Number(key), title: { english: "Saved anime " + key }, coverImage: {} };
      toast("Added to your watchlist.");
    }
    persist();
    if (state.detail && String(state.detail.id) === key) paintAnimeDetails(state.detail);
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
      category: "sub",
      intro: null,
      outro: null,
      direct: store.manualStreams[String(state.detail.id) + ":" + String(number)] || ""
    };
    location.hash = "#/watch/" + state.detail.id + "/" + number;
  }

  function playerEpisodeItems() {
    return '<div class="player-episode-tools"><input id="player-episode-filter" class="input-control" placeholder="Find episode…"><input id="player-episode-jump" class="input-control episode-jump-input" type="number" min="1" placeholder="EP #"><button class="btn btn-quiet" data-episode-go="player">Go</button></div>' +
      '<div id="player-episode-items"></div><div id="player-episode-pagination"></div>';
  }

  async function renderWatch(id, number) {
    const token = ++state.token;
    const media = state.detail && String(state.detail.id) === String(id) ? state.detail : await getAnime(id).catch(() => null);
    if (!media) {
      $("#view").innerHTML = '<div class="empty-state"><h3>Anime not found</h3><p>Return to the catalogue and open the title again.</p><button class="btn btn-primary" data-route="/home">Home</button></div>';
      return;
    }
    const hasPreparedSources = (state.detailMatches || []).some(match => match && match.episodesReady && Array.isArray(match.episodes));
    if (!state.detail || String(state.detail.id) !== String(id) || !hasPreparedSources) {
      state.detail = media;
      const prepared = await prepareMediaSources(media);
      if (token !== state.token) return;
      state.detailMatches = prepared.matches;
      state.selectedMatch = prepared.selected;
      state.detailEpisodes = prepared.episodes.length ? prepared.episodes : generatedEpisodes(media);
      state.episodePage = 1;
      state.episodeFilter = "";
      state.playerEpisodeFilter = "";
    }

    const episode = state.detailEpisodes.find(item => Number(item.number) === Number(number)) || {
      id: String(number), number: Number(number), title: "Episode " + number, generated: true
    };
    const currentMatchStillValid = state.player && state.player.match &&
      state.detailMatches.some(match => match.provider.id === state.player.match.provider.id && match.episodesReady);
    state.player = state.player && state.player.media && String(state.player.media.id) === String(id)
      ? state.player
      : {
          media: media,
          episode: episode,
          match: state.selectedMatch,
          streams: [],
          embeds: [],
          availableProviders: [],
          servers: [],
          tracks: [],
          selectedServer: "default",
          category: "sub",
          intro: null,
          outro: null,
          direct: store.manualStreams[String(id) + ":" + String(number)] || ""
        };
    const changedEpisode = Number(state.player.episode && state.player.episode.number) !== Number(episode.number);
    state.player.media = media;
    state.player.episode = episode;
    if (changedEpisode) {
      state.player.failedProviders = [];
      state.player.streams = [];
      state.player.embeds = [];
      state.player.tracks = [];
      state.player.selectedServer = "default";
    }
    if (!currentMatchStillValid || !state.player.match) state.player.match = state.selectedMatch;
    const activeEpisodeIndex = state.detailEpisodes.findIndex(item => Number(item.number) === Number(number));
    state.playerEpisodePage = activeEpisodeIndex >= 0 ? Math.floor(activeEpisodeIndex / PLAYER_EPISODES_PER_PAGE) + 1 : 1;

    const defaultServer = state.player.match && state.player.match.provider
      ? ({ justanime: "auto", hianime: "hd-1", anikoto: "anikoto" }[state.player.match.provider.id] || "auto")
      : "auto";
    if (!state.player.selectedServer || state.player.selectedServer === "default") {
      state.player.selectedServer = defaultServer;
    }
    if (token !== state.token) return;
    paintPlayer();
    if (state.player.direct) {
      attachStream(state.player.direct, { quality: "Direct link", type: /\.m3u8(\?|$)/i.test(state.player.direct) ? "hls" : "mp4" }, []);
    } else {
      await loadPlayerStreams(token);
    }
  }

  function paintPlayer() {
    const player = state.player;
    const media = player.media;
    const episode = player.episode;
    const episodeIndex = state.detailEpisodes.findIndex(item => Number(item.number) === Number(episode.number));
    const hasPrev = episodeIndex > 0;
    const hasNext = episodeIndex >= 0 && episodeIndex < state.detailEpisodes.length - 1;
    $("#view").innerHTML = '<div class="player-page"><div class="player-topline"><button class="back-button" data-anime="' + media.id + '" aria-label="Back to anime">←</button><div><h1>' + escapeHtml(titleOf(media)) + '</h1><p>Episode ' + escapeHtml(episode.number) + ' · ' + escapeHtml(episode.title) + '</p></div></div>' +
      '<div class="player-layout"><section><div class="video-frame"><video id="anime-video" controls playsinline webkit-playsinline preload="metadata"></video><iframe id="anime-embed" title="Episode stream" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen hidden></iframe><div class="player-overlay" id="player-overlay"><div class="loader"></div><strong>Preparing your player</strong><p>Checking the connected source and browser playback support…</p></div></div>' +
      '<div class="player-under"><div><h2>' + escapeHtml(episode.title) + '</h2><p>' + escapeHtml(titleOf(media)) + ' · Episode ' + escapeHtml(episode.number) + '</p></div><div class="player-controls"><button class="btn btn-quiet" data-prev ' + (hasPrev ? "" : "disabled") + '>← Previous</button><button class="btn btn-quiet" data-next ' + (hasNext ? "" : "disabled") + '>Next →</button><button class="btn btn-secondary" data-open-direct>Paste stream link</button></div></div>' +
      '<div class="button-row" style="margin-top:14px" id="skip-buttons"></div></section>' +
      '<aside class="player-sidebar"><div class="player-panel"><h3>Streaming source</h3><div class="source-row" id="provider-pills"></div><div style="height:12px"></div><h3>Audio & server</h3><div class="source-row" id="category-pills"><button class="source-pill active" data-category="sub">SUB</button><button class="source-pill" data-category="dub">DUB</button></div><div style="height:9px"></div><div class="source-row" id="server-pills"><span class="form-help">Loading built-in source servers…</span></div><div style="height:12px"></div><div class="source-row" id="quality-pills"></div></div>' +
      '<div class="player-panel"><h3>Episode list</h3><div class="player-episode-list">' + playerEpisodeItems() + '</div></div>' +
      '<div class="notice">Playback source: ' + escapeHtml(player.match && player.match.provider ? player.match.provider.name : "Direct link") + '. If this server fails, try another server or source.</div></aside></div></div>';
    renderPlayerEpisodeBrowser();
    updateActiveNav("/watch");
  }

  async function loadPlayerStreams(token) {
    const player = state.player;
    if (!player) return;

    const defaults = { justanime: "auto", hianime: "hd-1", anikoto: "anikoto" };
    player.failedProviders = Array.isArray(player.failedProviders) ? player.failedProviders : [];
    const allMatches = (state.detailMatches || []).filter(match =>
      match && match.provider && match.episodesReady && Array.isArray(match.episodes)
    );
    const orderedMatches = [
      player.match,
      ...allMatches.filter(match => match !== player.match)
    ].filter((match, index, rows) =>
      match && match.provider && match.episodesReady && Array.isArray(match.episodes) &&
      !player.failedProviders.includes(match.provider.id) &&
      rows.indexOf(match) === index
    );

    if (!orderedMatches.length) {
      showPlayerOverlay("No episode source is ready", "AniDash could not load an episode list from JustAnime, HiAnime or AniKoto. Return to the anime page and retry the built-in sources.", true);
      return;
    }

    player.availableProviders = orderedMatches;
    player.streams = [];
    player.tracks = [];
    player.embeds = [];
    renderPlayerOptions();
    const failures = [];

    showPlayerOverlay(
      "Finding a playable stream",
      "Trying " + orderedMatches.map(match => match.provider.name).join(" → ") + " automatically…",
      false
    );

    for (const match of orderedMatches) {
      if (token !== state.token) return;
      const provider = match.provider;
      const episode = match.episodes.find(item => Number(item.number) === Number(player.episode.number));
      if (!episode) {
        failures.push(provider.name + ": this episode is not listed.");
        continue;
      }

      const isCurrentProvider = player.match && player.match.provider.id === provider.id;
      const preferredServer = isCurrentProvider && player.selectedServer
        ? player.selectedServer
        : defaults[provider.id] || "auto";
      const common = {
        id: match.animeId,
        episodeId: episode.id,
        episode: episode.number,
        anilistId: player.media.id,
        malId: player.media.idMal,
        category: player.category || "sub"
      };

      try {
        showPlayerOverlay(
          "Trying " + provider.name,
          "Resolving episode " + episode.number + " using " + provider.name + "…",
          false
        );

        let serverPayload = null;
        try {
          serverPayload = await providerGet(provider, "servers", {
            ...common,
            server: preferredServer
          });
        } catch (_) {}

        if (token !== state.token) return;
        let servers = extractArray(serverPayload, ["servers", "serverList", "data.servers"]);
        if (!servers.length) {
          servers = provider.id === "justanime"
            ? [
                { id: "auto", name: "Automatic (Best available)" },
                { id: "megaplay", name: "Momo (HLS)" },
                { id: "zokoanime", name: "Zoko (HLS)" },
                { id: "animegg", name: "Gigi (MP4)" },
                { id: "anineko", name: "Neko (HLS)" }
              ]
            : provider.id === "anikoto"
            ? [{ id: "anikoto", name: "AniKoto • Kwik" }]
            : [
                { id: "aniwave", name: "AniWave • HLS" },
                { id: "hianime-hd-2", name: "HiAnime HD-2" },
                { id: "megaplay", name: "MegaPlay" }
              ];
        }

        const selectedExists = servers.some(server =>
          String(server.id || server.serverName || "") === String(preferredServer)
        );
        const preferred = servers.find(server =>
          String(server.id || server.serverName || "") === defaults[provider.id]
        );
        const selectedServer = selectedExists
          ? preferredServer
          : String((preferred || servers[0]).id || (preferred || servers[0]).serverName || defaults[provider.id]);

        const payload = await providerGet(provider, "streams", {
          ...common,
          server: selectedServer
        });
        if (token !== state.token) return;

        const streams = extractArray(payload, ["sources", "streams", "videos", "data.sources"])
          .filter(item => item && (item.url || item.src || item.file));
        const embeds = extractArray(payload, ["embeds", "embedSources", "providers"])
          .filter(item => item && (item.url || item.src));
        if (!streams.length && !embeds.length) {
          throw new Error(payload && payload.error ? payload.error : "No playable stream was returned.");
        }

        // Switch to this provider only after it actually returned a player source.
        player.match = match;
        player.episode = episode;
        player.servers = servers;
        player.selectedServer = selectedServer;
        player.streams = streams;
        player.embeds = embeds;
        player.tracks = extractArray(payload, ["tracks", "subtitles", "data.tracks"]);
        player.intro = payload && payload.intro || null;
        player.outro = payload && payload.outro || null;
        renderPlayerOptions();

        if (streams.length) {
          const first = streams[0];
          attachStream(first.url || first.src || first.file, first, player.tracks);
        } else {
          const firstEmbed = embeds[0];
          attachStream(firstEmbed.url || firstEmbed.src, {
            ...firstEmbed,
            type: "embed",
            isEmbed: true,
            quality: firstEmbed.name || firstEmbed.id || "Embedded player"
          }, []);
        }
        toast("Playing from " + provider.name + ".");
        return;
      } catch (error) {
        if (!player.failedProviders.includes(provider.id)) player.failedProviders.push(provider.id);
        failures.push(provider.name + ": " + error.message);
      }
    }

    if (token !== state.token) return;
    player.streams = [];
    player.tracks = [];
    player.embeds = [];
    renderPlayerOptions();
    const detail = failures.slice(0, 3).join(" · ");
    showPlayerOverlay(
      "No built-in source could play this episode",
      detail || "All available providers failed to return a playable stream. Try another episode or retry the sources.",
      true
    );
  }

  function showPlayerOverlay(title, description, showAction) {
    const overlay = $("#player-overlay");
    if (!overlay) return;
    overlay.innerHTML = '<div style="font-size:28px;color:#b99aff">◈</div><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(description) + '</p>' +
      (showAction ? '<button class="btn btn-primary" data-open-direct>Paste stream link</button>' : '');
  }

  function renderPlayerOptions() {
    const player = state.player;
    if (!player) return;
    const providers = $("#provider-pills");
    if (providers) {
      const candidates = player.availableProviders || (state.detailMatches || []).filter(match => match && match.episodesReady);
      providers.innerHTML = candidates.length ? candidates.map(match =>
        '<button class="source-pill' + (player.match && player.match.provider.id === match.provider.id ? " active" : "") + '" data-provider="' + escapeHtml(match.provider.id) + '">' + escapeHtml(match.provider.name) + '</button>'
      ).join("") : '<span class="form-help">No provider has an episode list.</span>';
    }
    const servers = $("#server-pills");
    if (servers) {
      servers.innerHTML = player.servers.length ? player.servers.map(server =>
        '<button class="source-pill' + (String(server.id) === String(player.selectedServer) ? " active" : "") + '" data-server="' + escapeHtml(server.id || "default") + '">' + escapeHtml(server.name || server.id || "Server") + '</button>'
      ).join("") : '<span class="form-help">Trying built-in servers…</span>';
    }
    const qualities = $("#quality-pills");
    if (qualities) {
      const qualityItems = player.streams.length ? player.streams : (player.embeds || []);
      qualities.innerHTML = qualityItems.map((stream, index) =>
        '<button class="source-pill' + (index === 0 ? " active" : "") + '" data-stream="' + index + '">' + escapeHtml(stream.quality || stream.name || stream.label || stream.type || ("Source " + (index + 1))) + '</button>'
      ).join("");
    }
    const skip = $("#skip-buttons");
    if (skip) {
      skip.innerHTML = (player.intro && Number(player.intro.end) > Number(player.intro.start) ? '<button class="btn btn-quiet" data-skip="intro">Skip intro ↗</button>' : '') +
        (player.outro && Number(player.outro.end) > Number(player.outro.start) ? '<button class="btn btn-quiet" data-skip="outro">Skip outro ↗</button>' : '');
    }
  }

  function fallbackToNextProvider(reason) {
    const player = state.player;
    if (!player || !player.match || !player.match.provider) return;
    player.failedProviders = Array.isArray(player.failedProviders) ? player.failedProviders : [];
    const failedId = player.match.provider.id;
    if (!player.failedProviders.includes(failedId)) player.failedProviders.push(failedId);
    player.streams = [];
    player.embeds = [];
    player.tracks = [];
    const next = (state.detailMatches || []).find(match =>
      match && match.provider && match.episodesReady &&
      !player.failedProviders.includes(match.provider.id) &&
      match.episodes.some(item => Number(item.number) === Number(player.episode.number))
    );
    if (next) {
      player.match = next;
      player.selectedServer = ({ justanime: "auto", hianime: "hd-1", anikoto: "anikoto" }[next.provider.id] || "auto");
      showPlayerOverlay("Switching streaming source", reason + " Trying " + next.provider.name + "…", false);
      loadPlayerStreams(state.token);
      return;
    }
    showPlayerOverlay("Playback failed on all built-in sources", reason + " No other provider returned a playable source for this episode. Try another episode or check back later.", true);
  }

  function attachStream(url, stream, tracks) {
    if (!url) {
      showPlayerOverlay("Invalid stream URL", "The provider did not return a media URL.", true);
      return;
    }
    let parsed;
    try { parsed = new URL(url); } catch (_) {
      showPlayerOverlay("Invalid stream URL", "The source URL is not valid.", true);
      return;
    }
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      showPlayerOverlay("Insecure stream blocked", "Only HTTPS video sources are allowed on the deployed website.", true);
      return;
    }

    const video = $("#anime-video");
    const embed = $("#anime-embed");
    const overlay = $("#player-overlay");
    if (!video) return;
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
      state.hls = new window.Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 45, maxBufferLength: 45 });
      state.hls.loadSource(url);
      state.hls.attachMedia(video);
      const activeHls = state.hls;
      state.hls.on(window.Hls.Events.ERROR, function (_event, data) {
        if (data && data.fatal && state.currentVideo === url) {
          try { activeHls.destroy(); } catch (_) {}
          if (state.hls === activeHls) state.hls = null;
          fallbackToNextProvider("The browser could not load the HLS stream from " + (state.player.match.provider.name || "this source") + ".");
        }
      });
    } else {
      video.src = url;
    }
    state.currentVideo = url;
    if (overlay) overlay.style.display = "none";
    video.onloadedmetadata = () => {
      const key = String(state.player.media.id);
      const saved = store.history[key];
      if (saved && Number(saved.episode) === Number(state.player.episode.number) && saved.position > 15 && video.duration > saved.position + 15) {
        video.currentTime = saved.position;
      }
      video.play().catch(() => {});
    };
    video.onerror = () => {
      if (state.player && state.player.match && state.currentVideo === url) {
        fallbackToNextProvider("The browser could not play the returned video URL.");
      }
    };
    video.ontimeupdate = () => savePlaybackProgress(video);
    video.onended = () => {
      savePlaybackProgress(video, true);
      toast("Episode finished. Choose Next to continue.");
    };
  }

  function savePlaybackProgress(video, ended) {
    if (!state.player || !video.duration || !Number.isFinite(video.duration)) return;
    const now = Date.now();
    if (!ended && now - state.progressTimer < 7000) return;
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
      position: ended ? video.duration : video.currentTime,
      duration: video.duration,
      updatedAt: now
    };
    persist();
  }

  function renderLibrary() {
    const items = Object.values(store.watchlist).sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    $("#view").innerHTML = pageHead("YOUR COLLECTION", "My watchlist", "Anime you have saved on this device.") +
      (items.length ? grid(items) : '<div class="empty-state"><div class="empty-icon">♡</div><h3>Your list is waiting</h3><p>Open any anime and tap Add to watchlist to keep it here.</p><button class="btn btn-primary" data-route="/discover">Explore anime</button></div>');
  }

  function renderHistory() {
    const items = Object.values(store.history).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const media = items.map(item => item.media).filter(Boolean);
    $("#view").innerHTML = pageHead("RECENT ACTIVITY", "Continue watching", "Your playback progress is stored locally in this browser.") +
      (items.length ? '<div class="anime-grid">' + items.map(item => {
        const pct = item.duration ? Math.min(100, Math.max(0, item.position / item.duration * 100)) : 0;
        const poster = imageOf(item.media);
        return '<article class="anime-card" data-resume="' + item.media.id + '" tabindex="0"><div class="poster-wrap">' + (poster ? '<img loading="lazy" src="' + escapeHtml(poster) + '" alt="">' : '<div class="poster-fallback">' + escapeHtml(titleOf(item.media)) + '</div>') + '<span class="poster-score">EP ' + escapeHtml(item.episode) + '</span></div><div class="card-title">' + escapeHtml(titleOf(item.media)) + '</div><p class="card-subtitle">' + escapeHtml(item.episodeTitle || "Episode " + item.episode) + '</p><div class="card-progress"><span style="width:' + pct + '%"></span></div><div class="card-resume">Resume at ' + Math.floor((item.position || 0) / 60) + ' min</div></article>';
      }).join("") + '</div>' : '<div class="empty-state"><div class="empty-icon">◷</div><h3>No episodes watched yet</h3><p>When you start watching, AniDash will remember your episode and playback position on this device.</p><button class="btn btn-primary" data-route="/discover">Find anime</button></div>');
  }

  function renderSettings() {
    loadProviders().then(providers => {
      if (state.route !== "/settings") return;
      const count = $("#provider-count");
      if (count) count.textContent = providers.map(provider => provider.name).join(" · ");
    });
    $("#view").innerHTML = pageHead("PREFERENCES", "Settings", "Manage built-in sources, playback defaults and the app experience.") +
      '<div class="settings-grid"><section class="settings-card"><div class="eyebrow">STREAMING</div><h3>Built-in sources</h3><p id="provider-count">JustAnime · HiAnime · AniKoto</p><p>AniDash ships with three native source providers. Their search, episode lists, SUB/DUB server choices and stream resolvers are maintained with the website. No extensions or user source manifests are required.</p><button class="btn btn-primary" data-open-sources>View built-in sources</button></section>' +
      '<section class="settings-card"><div class="eyebrow">LOCAL DATA</div><h3>Your watch activity</h3><p>Watchlist and playback progress are stored on this device. Clearing browser storage will remove this local data.</p><button class="btn btn-quiet" data-clear-history>Clear watch history</button><button class="btn btn-quiet" data-clear-watchlist style="margin-left:6px">Clear watchlist</button></section>' +
      '<section class="settings-card"><div class="eyebrow">INSTALLATION</div><h3>Install AniDash</h3><p>Add the website to your device home screen or desktop app launcher for an app-like experience.</p><button class="btn btn-secondary" data-install>Installation guide</button></section>' +
      '<section class="settings-card"><div class="eyebrow">CATALOGUE</div><h3>AniList + MAL metadata</h3><p>Anime details, artwork, ratings and MyAnimeList IDs are read from the AniList public catalogue. No account sign-in is required for discovery.</p><a class="btn btn-quiet" href="https://docs.anilist.co/guide/graphql/" target="_blank" rel="noopener">API information ↗</a></section></div>';
  }

  function openModal(content) {
    $("#modal-root").innerHTML = '<div class="modal-backdrop" data-close-modal><section class="modal-card" role="dialog" aria-modal="true">' + content + '</section></div>';
    const cardEl = $(".modal-card");
    if (cardEl) cardEl.addEventListener("click", event => event.stopPropagation());
  }

  function closeModal() {
    $("#modal-root").innerHTML = "";
  }

  function openSourcesModal() {
    const providers = BUILTIN_PROVIDERS;
    openModal('<div class="modal-head"><div><div class="eyebrow">ANIDASH BUILT-IN PROVIDERS</div><h2>Three native anime sources</h2><p>These sources are built into AniDash Watch. Their APIs are called through this website’s backend; viewers do not need to install or import extensions.</p></div><button class="close-modal" data-close>×</button></div>' +
      '<div class="settings-grid">' + providers.map(provider =>
        '<section class="settings-card"><div class="eyebrow">' + escapeHtml(provider.language) + '</div><h3>' + escapeHtml(provider.name) + '</h3><p>' + escapeHtml(provider.description) + '</p></section>'
      ).join("") + '</div><div class="notice" style="margin-top:14px">A source can occasionally be unavailable when its upstream website or API is down. AniDash reports that failure instead of pretending a stream is ready.</div><div class="modal-actions"><button class="btn btn-primary" data-close>Done</button></div>');
  }

  function openDirectModal() {
    const current = state.player && state.player.direct || "";
    openModal('<div class="modal-head"><div><div class="eyebrow">MANUAL SOURCE</div><h2>Paste a stream link</h2><p>Use an MP4 or HLS (.m3u8) URL that you own or are authorised to stream. The browser must be able to access it from this site.</p></div><button class="close-modal" data-close>×</button></div>' +
      '<div class="form-field"><label for="direct-url">Video URL</label><input class="input-control" id="direct-url" type="url" placeholder="https://media.example/video.m3u8" value="' + escapeHtml(current) + '"></div>' +
      '<div class="form-field"><label for="direct-subtitle">Optional English subtitle URL (.vtt)</label><input class="input-control" id="direct-subtitle" type="url" placeholder="https://media.example/subtitles/en.vtt"></div>' +
      '<div class="modal-actions"><button class="btn btn-quiet" data-close>Cancel</button><button class="btn btn-primary" data-save-direct>Play stream</button></div>');
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
    const active = route === "/watch" ? "/history" : route;
    $$("[data-route]").forEach(item => {
      const value = item.getAttribute("data-route");
      item.classList.toggle("active", value === active || (route.startsWith("/anime") && value === "/discover"));
    });
  }

  async function route() {
    const hash = location.hash.replace(/^#/, "") || "/home";
    const parts = hash.split("?")[0].split("/").filter(Boolean);
    const current = "/" + (parts[0] || "home");
    state.route = current;
    updateActiveNav(current);
    if (current === "/home") return renderHome();
    if (current === "/discover") return renderDiscover();
    if (current === "/search") {
      const params = new URLSearchParams(hash.split("?")[1] || "");
      return renderSearch(params.get("q") || "");
    }
    if (current === "/library") return renderLibrary();
    if (current === "/history") return renderHistory();
    if (current === "/settings") return renderSettings();
    if (current === "/anime" && parts[1]) return renderAnime(parts[1]);
    if (current === "/watch" && parts[1]) return renderWatch(parts[1], parts[2] || "1");
    location.hash = "#/home";
  }

  function navigate(path) {
    location.hash = "#" + path;
  }

  async function submitSearch(term) {
    const value = String(term || "").trim();
    if (!value) return;
    navigate("/search?q=" + encodeURIComponent(value));
  }

  document.addEventListener("click", async event => {
    const target = event.target.closest("button,a,article");
    if (!target) {
      if (event.target.matches("[data-close-modal]")) closeModal();
      return;
    }
    if (target.hasAttribute("data-route")) {
      event.preventDefault();
      navigate(target.getAttribute("data-route"));
      return;
    }
    if (target.hasAttribute("data-anime")) {
      navigate("/anime/" + target.getAttribute("data-anime"));
      return;
    }
    if (target.hasAttribute("data-watchlist")) {
      toggleWatchlist(target.getAttribute("data-watchlist"));
      return;
    }
    if (target.hasAttribute("data-open-sources")) { openSourcesModal(); return; }
    if (target.hasAttribute("data-refresh-sources")) { if (state.detail) renderAnime(String(state.detail.id)); return; }
    if (target.hasAttribute("data-open-direct")) { openDirectModal(); return; }
    if (target.hasAttribute("data-install")) { openInstallGuide(); return; }
    if (target.hasAttribute("data-close")) { closeModal(); return; }
    if (target.hasAttribute("data-play-first")) {
      const first = state.detailEpisodes[0];
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
        state.player.episode = item;
        state.player.direct = store.manualStreams[String(state.player.media.id) + ":" + String(item.number)] || "";
        navigate("/watch/" + state.player.media.id + "/" + item.number);
      }
      return;
    }
    if (target.hasAttribute("data-next") || target.hasAttribute("data-prev")) {
      const direction = target.hasAttribute("data-next") ? 1 : -1;
      const index = state.detailEpisodes.findIndex(ep => Number(ep.number) === Number(state.player.episode.number));
      const item = state.detailEpisodes[index + direction];
      if (item) {
        state.player.episode = item;
        state.player.direct = store.manualStreams[String(state.player.media.id) + ":" + String(item.number)] || "";
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
        state.player = { media: media, episode: { id: String(item.episode), number: item.episode, title: item.episodeTitle || "Episode " + item.episode }, match: null, streams: [], embeds: [], availableProviders: [], servers: [], tracks: [], selectedServer: "default", category: "sub", direct: store.manualStreams[String(media.id) + ":" + String(item.episode)] || "" };
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
        state.player.failedProviders = [];
        state.player.selectedServer = ({ justanime: "auto", hianime: "hd-1", anikoto: "anikoto" }[providerId] || "auto");
        loadPlayerStreams(state.token);
      }
      return;
    }
    if (target.hasAttribute("data-category")) {
      const category = target.getAttribute("data-category");
      state.player.category = category;
      $$("[data-category]").forEach(el => el.classList.toggle("active", el.getAttribute("data-category") === category));
      loadPlayerStreams(state.token);
      return;
    }
    if (target.hasAttribute("data-server")) {
      state.player.selectedServer = target.getAttribute("data-server");
      state.player.failedProviders = [];
      loadPlayerStreams(state.token);
      return;
    }
    if (target.hasAttribute("data-stream")) {
      const index = Number(target.getAttribute("data-stream"));
      const list = state.player.streams.length ? state.player.streams : (state.player.embeds || []);
      const stream = list[index];
      if (stream) {
        $$("[data-stream]").forEach(el => el.classList.toggle("active", Number(el.getAttribute("data-stream")) === index));
        attachStream(stream.url || stream.src || stream.file, stream, state.player.tracks);
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
    if (target.hasAttribute("data-save-direct")) {
      const url = String($("#direct-url").value || "").trim();
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error("Use a valid HTTPS URL.");
        if (!state.player) throw new Error("Open an episode first.");
        const key = String(state.player.media.id) + ":" + String(state.player.episode.number);
        store.manualStreams[key] = url;
        persist();
        state.player.direct = url;
        const subtitle = String($("#direct-subtitle").value || "").trim();
        const tracks = subtitle ? [{ url: subtitle, lang: "English", type: "subtitles" }] : [];
        closeModal();
        const video = $("#anime-video");
        if (video) {
          state.player.tracks = tracks;
          attachStream(url, { quality: "Direct link", type: /\.m3u8(\?|$)/i.test(url) ? "hls" : "mp4" }, tracks);
        }
        toast("Stream link saved for this episode.");
      } catch (error) { toast(error.message); }
      return;
    }
    if (target.hasAttribute("data-clear-history")) {
      if (confirm("Clear all locally saved watch progress?")) {
        store.history = {};
        persist();
        renderHistory();
        toast("Watch history cleared.");
      }
      return;
    }
    if (target.hasAttribute("data-clear-watchlist")) {
      if (confirm("Clear your local watchlist?")) {
        store.watchlist = {};
        persist();
        renderLibrary();
        toast("Watchlist cleared.");
      }
      return;
    }
  });

  document.addEventListener("submit", event => {
    if (event.target.id === "search-form") {
      event.preventDefault();
      submitSearch($("#search-page-input").value);
    }
  });

  document.addEventListener("change", event => {
    if (event.target.id === "discover-sort") {
      state.discoverSort = event.target.value;
      renderDiscover();
    }
    if (event.target.id === "episode-source") {
      selectDetailProvider(event.target.value);
    }
  });

  document.addEventListener("input", event => {
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

  window.addEventListener("hashchange", route);
  window.addEventListener("online", () => toast("You are back online."));
  window.addEventListener("offline", () => toast("You are offline. The app shell is still available."));

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(registration => registration.update()).catch(() => {}));
  }

  loadProviders();
  route();
})();