// AniList is the only supported external account integration.
// Source-site cookies/passwords are never requested, copied or proxied.
(() => {
  "use strict";
  const API = "https://graphql.anilist.co";
  const TOKEN_KEY = "anidash.watch.anilist.token";
  const OAUTH_STATE_KEY = "anidash.watch.anilist.oauth-state";
  let token = null;
  let viewer = null;
  let config = null;
  let entries = new Map();
  let mangaEntries = new Map();
  let favoriteIds = new Set();
  const pendingProgress = new Map();
  let changeHandler = () => {};
  const copy = x => x && typeof x === "object" ? JSON.parse(JSON.stringify(x)) : x;

  function setHandler(handler) {
    changeHandler = typeof handler === "function" ? handler : () => {};
  }
  function inform() { try { changeHandler(copy(viewer)); } catch (_) {} }
  function clearToken() {
    token = null;
    viewer = null;
    entries.clear(); mangaEntries.clear(); favoriteIds.clear();
    try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
    inform();
  }
  function redirectParams() {
    const hash = String(location.hash || "");
    if (!/^#(?:\/?|\?)access_token=/.test(hash)) return null;
    return new URLSearchParams(hash.slice(1).replace(/^[/?]/, ""));
  }
  function captureRedirect() {
    const params = redirectParams();
    if (!params) return false;
    const accessToken = String(params.get("access_token") || "");
    const returnedState = String(params.get("state") || "");
    let expectedState = null;
    try {
      expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
      sessionStorage.removeItem(OAUTH_STATE_KEY);
    } catch (_) {}
    // Refuse unsolicited/mismatched callbacks; never accept URL tokens blindly.
    if (!accessToken || !expectedState || expectedState !== returnedState) {
      clearToken();
      try { history.replaceState(null, "", location.pathname + location.search + "#/account"); }
      catch (_) { location.hash = "#/account"; }
      return "invalid";
    }
    token = accessToken;
    try { localStorage.setItem(TOKEN_KEY, token); } catch (_) {}
    try { history.replaceState(null, "", location.pathname + location.search + "#/account"); }
    catch (_) { location.hash = "#/account"; }
    return "success";
  }
  async function settings() {
    if (config) return config;
    try {
      const response = await fetch("/api/auth-config", { cache: "no-store" });
      if (!response.ok) throw new Error("config unavailable");
      const body = await response.json();
      config = { enabled: body.enabled === true, clientId: String(body.clientId || "") };
    } catch (_) { config = { enabled: false, clientId: "" }; }
    return config;
  }
  async function request(query, variables) {
    if (!token) throw new Error("Sign in with AniList first.");
    const response = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({ query, variables: variables || {} })
    });
    const body = await response.json();
    if (response.status === 401 || /invalid token|unauthorized/i.test(body?.errors?.[0]?.message || "")) {
      clearToken();
      throw new Error("Your AniList session expired. Please sign in again.");
    }
    if (!response.ok || body.errors) throw new Error(body.errors?.[0]?.message || "AniList is unavailable.");
    return body.data;
  }
  async function init() {
    if (!token) {
      try { token = localStorage.getItem(TOKEN_KEY); } catch (_) {}
    }
    await settings();
    if (!token) { inform(); return null; }
    try {
      const data = await request("query { Viewer { id name avatar { medium large } siteUrl } }");
      if (!data?.Viewer?.id) throw new Error("AniList did not return a profile.");
      viewer = data.Viewer;
      inform();
      return copy(viewer);
    } catch (error) {
      // Preserve the token on transient network failures, but don't pretend login succeeded.
      viewer = null;
      inform();
      return null;
    }
  }
  async function beginLogin() {
    const settingsResult = await settings();
    if (!settingsResult.enabled || !/^\d+$/.test(settingsResult.clientId)) {
      throw new Error("AniList sign-in is not configured for this website yet.");
    }
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const state = [...bytes].map(n => n.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
    const params = new URLSearchParams({
      client_id: settingsResult.clientId,
      response_type: "token",
      state
    });
    location.assign("https://anilist.co/api/v2/oauth/authorize?" + params.toString());
  }
  function logout() { clearToken(); }
  function currentUser() { return copy(viewer); }
  function configured() { return config?.enabled === true; }
  function authenticated() { return !!viewer && !!token; }
  function getEntry(mediaId, type = "ANIME") {
    return copy((type === "MANGA" ? mangaEntries : entries).get(Number(mediaId)) || null);
  }
  function parseWatchNotes(notes) {
    const match = /shx:ep=(\d+)&sec=(\d+)(?:&dur=(\d+))?/.exec(String(notes || ""));
    if (!match) return null;
    const episode = Number(match[1]), seconds = Number(match[2]), duration = Number(match[3] || 1440);
    if (!Number.isSafeInteger(episode) || episode < 1 || !Number.isFinite(seconds) || seconds < 0)
      return null;
    return { episode, seconds, duration };
  }
  function formatWatchNotes(existing, episode, seconds, duration) {
    const tag = "shx:ep=" + episode + "&sec=" + Math.max(0, Math.floor(seconds)) +
      (duration > 0 ? "&dur=" + Math.floor(duration) : "");
    const current = String(existing || "");
    const regex = /shx:ep=\d+&sec=\d+(?:&dur=\d+)?/;
    return regex.test(current) ? current.replace(regex, tag) : current.trim() ? tag + "\n" + current : tag;
  }
  function resumeFromEntry(entry, totalEpisodes) {
    if (!entry) return null;
    const completed = Math.max(0, Number(entry.progress || 0));
    const next = completed + 1;
    const notes = parseWatchNotes(entry.notes);
    const partial = notes && notes.episode >= next && notes.seconds > 0 &&
      (notes.duration <= 0 || notes.seconds < notes.duration);
    const ep = partial ? notes.episode : next;
    return {
      episode: totalEpisodes > 0 ? Math.min(ep, totalEpisodes) : ep,
      seconds: partial ? notes.seconds : 0,
      duration: notes?.duration || 1440,
      updatedAt: Number(entry.updatedAt || 0) * 1000,
      completedEpisodes: completed
    };
  }

  async function list() {
    if (!authenticated()) return [];
    const data = await request(
      "query ($userId: Int!) { MediaListCollection(userId: $userId, type: ANIME) { lists { entries { id mediaId status progress notes repeat updatedAt media { id idMal title { english romaji native } coverImage { extraLarge large medium } bannerImage episodes status format averageScore seasonYear nextAiringEpisode { episode } } } } } }",
      { userId: Number(viewer.id) }
    );
    const all = (data?.MediaListCollection?.lists || [])
      .flatMap(group => group?.entries || [])
      .filter(entry => Number.isInteger(Number(entry.mediaId)) && entry.media);
    entries = new Map(all.map(entry => [Number(entry.mediaId), entry]));
    return copy(all);
  }

  async function listManga() {
    if (!authenticated()) return [];
    const data = await request(
      "query ($userId: Int!) { MediaListCollection(userId: $userId, type: MANGA) { lists { entries { id mediaId status progress notes updatedAt media { id title { english romaji native } coverImage { extraLarge large medium } bannerImage format status chapters volumes averageScore seasonYear } } } } }",
      { userId: Number(viewer.id) }
    );
    const all = (data?.MediaListCollection?.lists || []).flatMap(group => group?.entries || []).filter(item => item.media);
    mangaEntries = new Map(all.map(item => [Number(item.mediaId), item]));
    return copy(all);
  }
  async function favorites() {
    if (!authenticated()) return [];
    const ids = [];
    for (let page = 1; page <= 20; page++) {
      const data = await request(
        "query ($page: Int!) { Viewer { favourites { anime(page: $page, perPage: 25) { nodes { id } pageInfo { hasNextPage } } } } }",
        { page }
      );
      const connection = data?.Viewer?.favourites?.anime;
      ids.push(...(connection?.nodes || []).map(node => Number(node.id)));
      if (!connection?.pageInfo?.hasNextPage) break;
    }
    favoriteIds = new Set(ids);
    return [...favoriteIds];
  }
  function isFavorite(mediaId) { return favoriteIds.has(Number(mediaId)); }
  async function toggleFavorite(mediaId) {
    const id = Number(mediaId);
    await request(
      "mutation ($id: Int!) { ToggleFavourite(animeId: $id) { anime { nodes { id } } } }", { id }
    );
    if (favoriteIds.has(id)) favoriteIds.delete(id);
    else favoriteIds.add(id);
    return favoriteIds.has(id);
  }
  async function setStatus(mediaId, status) {
    if (!["CURRENT", "COMPLETED", "PAUSED", "DROPPED", "PLANNING", "REPEATING"].includes(status))
      throw new Error("Invalid AniList status");
    const id = Number(mediaId);
    const existing = entries.get(id);
    const data = await request(
      "mutation ($id:Int!,$status:MediaListStatus) { SaveMediaListEntry(mediaId:$id,status:$status) {id mediaId status progress notes updatedAt} }",
      { id, status }
    );
    if (data?.SaveMediaListEntry) entries.set(id, { ...existing, ...data.SaveMediaListEntry });
    return copy(data?.SaveMediaListEntry || null);
  }
  async function syncPosition(mediaId, episode, seconds, duration, ended = false) {
    if (!authenticated()) return null;
    const id = Number(mediaId);
    const ep = Math.max(1, Math.floor(Number(episode) || 1));
    const sec = Math.max(0, Math.floor(Number(seconds) || 0));
    const dur = Math.max(0, Math.floor(Number(duration) || 0));
    const previous = pendingProgress.get(id) || Promise.resolve();
    const requestPromise = previous.catch(() => {}).then(async () => {
      const entry = entries.get(id);
      // Android uses the number of fully watched episodes, never increment on a partial episode.
      const progress = Math.max(Number(entry?.progress || 0), ended ? ep : ep - 1);
      const noteText = formatWatchNotes(entry?.notes, ep, ended && dur > 0 ? dur : sec, dur);
      const status = entry?.status === "COMPLETED" ? "COMPLETED" :
        (ended && entry?.media?.episodes && ep >= Number(entry.media.episodes) ? "COMPLETED" : "CURRENT");
      const data = await request(
        "mutation ($id:Int!,$status:MediaListStatus,$progress:Int,$notes:String) { SaveMediaListEntry(mediaId:$id,status:$status,progress:$progress,notes:$notes) {id mediaId status progress notes updatedAt} }",
        { id, status, progress, notes: noteText }
      );
      if (data?.SaveMediaListEntry) {
        entries.set(id, { ...entry, ...data.SaveMediaListEntry });
        return copy(data.SaveMediaListEntry);
      }
      return null;
    }).finally(() => {
      if (pendingProgress.get(id) === requestPromise) pendingProgress.delete(id);
    });
    pendingProgress.set(id, requestPromise);
    return requestPromise;
  }


  async function saveManga(mediaId, progress = 0) {
    if (!authenticated()) return null;
    const id = Number(mediaId);
    const old = mangaEntries.get(id);
    const status = old?.status || (progress > 0 ? "CURRENT" : "PLANNING");
    const vars = { mediaId:id, status, progress:Math.max(Number(old?.progress || 0),Number(progress || 0)) };
    const data = await request(
      "mutation ($mediaId:Int!,$status:MediaListStatus,$progress:Int){SaveMediaListEntry(mediaId:$mediaId,status:$status,progress:$progress){id mediaId status progress}}",
      vars
    );
    if (data?.SaveMediaListEntry) {
      mangaEntries.set(id, { ...old, ...data.SaveMediaListEntry });
      return copy(data.SaveMediaListEntry);
    }
    return null;
  }

  async function saveToList(mediaId, status = "PLANNING", progress) {
    if (!authenticated()) return null;
    const id = Number(mediaId);
    const existing = entries.get(id);
    // Do not downgrade an existing completed/watching entry to Planning.
    const resolvedStatus = existing?.status || status;
    const vars = { mediaId: id, status: resolvedStatus };
    if (Number.isInteger(progress) && progress >= 0) {
      vars.progress = Math.max(Number(existing?.progress || 0), progress);
      if (!existing) vars.status = "CURRENT";
    }
    const data = await request(
      "mutation ($mediaId: Int!, $status: MediaListStatus, $progress: Int) { SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress) { id mediaId status progress } }",
      vars
    );
    if (data?.SaveMediaListEntry) {
      entries.set(id, { ...(existing || {}), ...data.SaveMediaListEntry });
      return copy(data.SaveMediaListEntry);
    }
    return null;
  }
  async function deletePlanning(mediaId) {
    if (!authenticated()) return false;
    const entry = entries.get(Number(mediaId));
    if (!entry || entry.status !== "PLANNING" || !entry.id) return false;
    const data = await request(
      "mutation ($id: Int!) { DeleteMediaListEntry(id: $id) { deleted } }",
      { id: Number(entry.id) }
    );
    if (data?.DeleteMediaListEntry?.deleted) entries.delete(Number(mediaId));
    return data?.DeleteMediaListEntry?.deleted === true;
  }

  window.AniDashAccount = {
    captureRedirect, setHandler, settings, init, beginLogin, logout,
    currentUser, configured, authenticated, list, listManga, favorites, isFavorite, toggleFavorite,
    parseWatchNotes, formatWatchNotes, resumeFromEntry, syncPosition, setStatus, saveManga,
    getEntry, saveToList, deletePlanning
  };
})();
