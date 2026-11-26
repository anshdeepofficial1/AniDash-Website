// AniList is the only supported external account integration.
// Source-site cookies/passwords are never requested, copied or proxied.
(() => {
  "use strict";
  const API = "https://graphql.anilist.co";
  const TOKEN_KEY = "anidash.watch.anilist.token";
  const OAUTH_STATE_KEY = "anidash.watch.anilist.oauth-state";
  const VIEWER_KEY = "anidash.watch.anilist.viewer";
  const BACKUP_DB = "anidash-account", BACKUP_STORE = "session", BACKUP_KEY = "anilist";
  let token = null, paired = false;
  let viewer = null;
  let config = null;
  let entries = new Map();
  let listPending = null, listAt = 0;
  let mangaEntries = new Map();
  let favoriteIds = new Set();
  const pendingProgress = new Map();
  let changeHandler = () => {};
  const copy = x => x && typeof x === "object" ? JSON.parse(JSON.stringify(x)) : x;

  function setHandler(handler) {
    changeHandler = typeof handler === "function" ? handler : () => {};
  }
  function inform() { try { changeHandler(copy(viewer)); } catch (_) {} }
  // Independent IndexedDB copy so one evicted/cleared storage area never signs the user out.
  function backupDb() {
    return new Promise(resolve => {
      try {
        if (!("indexedDB" in window)) return resolve(null);
        const r = indexedDB.open(BACKUP_DB, 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(BACKUP_STORE)) r.result.createObjectStore(BACKUP_STORE); };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }
  async function backupWrite(value) {
    try {
      const db = await backupDb(); if (!db) return;
      await new Promise(resolve => {
        const tx = db.transaction(BACKUP_STORE, "readwrite");
        if (value) tx.objectStore(BACKUP_STORE).put(value, BACKUP_KEY); else tx.objectStore(BACKUP_STORE).delete(BACKUP_KEY);
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
      });
      db.close();
    } catch (_) {}
  }
  async function backupRead() {
    try {
      const db = await backupDb(); if (!db) return null;
      const value = await new Promise(resolve => {
        const q = db.transaction(BACKUP_STORE, "readonly").objectStore(BACKUP_STORE).get(BACKUP_KEY);
        q.onsuccess = () => resolve(q.result || null); q.onerror = () => resolve(null);
      });
      db.close();
      return value;
    } catch (_) { return null; }
  }
  function persistSession() {
    try { localStorage.setItem(TOKEN_KEY, token); } catch (_) {}
    try { if (viewer) localStorage.setItem(VIEWER_KEY, JSON.stringify(viewer)); } catch (_) {}
    backupWrite(token ? { token, viewer } : null);
    try { navigator.storage?.persist?.(); } catch (_) {}
  }
  function readCachedViewer() {
    try {
      const v = JSON.parse(localStorage.getItem(VIEWER_KEY) || "null");
      return v && typeof v === "object" && v.id ? v : null;
    } catch (_) { return null; }
  }
  // Only an explicit Logout (or a token AniList itself rejects) ends the session.
  function clearToken() {
    token = null;
    viewer = null;
    entries.clear(); mangaEntries.clear(); favoriteIds.clear(); listAt = 0; listPending = null;
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(VIEWER_KEY); } catch (_) {}
    backupWrite(null);
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
      try { history.replaceState(null, "", "/account"); }
      catch (_) { location.assign("/account"); }
      return "invalid";
    }
    token = accessToken;
    viewer = null;
    persistSession();
    try { history.replaceState(null, "", "/account"); }
    catch (_) { location.assign("/account"); }
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
    if (!token && !paired) throw new Error("Sign in with AniList first.");
    const response = await fetch(paired ? "/api/device-pair/anilist" : API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(paired ? {} : { Authorization: "Bearer " + token })
      },
      body: JSON.stringify({ query, variables: variables || {} }),
      ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? {signal:AbortSignal.timeout(12000)} : {})
    });
    const body = await response.json();
    if (response.status === 401 || /invalid token/i.test(body?.errors?.[0]?.message || "")) {
      const err = new Error("Your AniList session expired. Please sign in again.");
      err.authRejected = true;
      throw err;
    }
    if (!response.ok || body.errors) throw new Error(body.errors?.[0]?.message || "AniList is unavailable.");
    return body.data;
  }
  let initPending = null;
  async function init() {
    if (viewer && (token || paired)) return copy(viewer);
    if(initPending)return initPending;
    const run=initAccount(); initPending=run; try{return await run}finally{if(initPending===run)initPending=null}
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function verifySession() {
    // Retry transient failures; only AniList explicitly rejecting the token twice ends the session.
    let rejected = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const data = await request("query { Viewer { id name avatar { medium large } siteUrl } }");
        if (!data?.Viewer?.id) throw new Error("AniList did not return a profile.");
        viewer = data.Viewer;
        persistSession();
        inform();
        return true;
      } catch (error) {
        if (error?.authRejected) { if (++rejected >= 2) { clearToken(); return false; } }
        await sleep(600 * (attempt + 1));
      }
    }
    return false;
  }
  async function initAccount() {
    try { const r = await fetch("/api/device-pair/account", {cache:"no-store"}); if (r.ok) { const a = await r.json(); if (a.success && a.accounts?.anilist?.id) { paired = true; token = null; viewer = a.accounts.anilist; try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(VIEWER_KEY); } catch (_) {} await backupWrite(null); inform(); return copy(viewer); } } } catch (_) {}
    if (!token) {
      try { token = localStorage.getItem(TOKEN_KEY); } catch (_) {}
    }
    if (!token) {
      const saved = await backupRead();
      if (saved?.token) {
        token = saved.token;
        try { localStorage.setItem(TOKEN_KEY, token); } catch (_) {}
        if (saved.viewer) { try { localStorage.setItem(VIEWER_KEY, JSON.stringify(saved.viewer)); } catch (_) {} }
      }
    }
    await settings();
    if (!token) { inform(); return null; }
    // Show the saved profile immediately so a slow or failed network call never looks like a sign-out.
    if (!viewer) viewer = readCachedViewer();
    if (viewer) {
      inform();
      persistSession();
      verifySession();
      return copy(viewer);
    }
    await verifySession();
    return viewer ? copy(viewer) : null;
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
  async function logout() { if (paired) { const r = await fetch("/api/device-pair/logout", {method:"POST"}); if (!r.ok) throw Error("Sign-out failed"); paired = false; } clearToken(); }
  function currentUser() { return copy(viewer); }
  function configured() { return config?.enabled === true; }
  function authenticated() { return !!viewer && (!!token || paired); }
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
    const hasNoteTime = notes && notes.seconds > 0;
    const isFinished = notes && notes.duration > 0 && notes.seconds >= notes.duration - 30;
    const resumeExact = hasNoteTime && !isFinished && notes.episode > 0;
    // Left in the last 30 seconds (credits): the viewer is done with that episode, so continue with the next one.
    const ep = resumeExact ? notes.episode
      : isFinished && notes.episode > 0 ? Math.max(notes.episode + 1, next)
      : (completed > 0 && (notes?.episode || next) <= completed ? next : (notes?.episode || next));
    const sec = resumeExact ? notes.seconds : 0;
    const dur = notes?.duration || 1440;
    return {
      episode: totalEpisodes > 0 ? Math.min(ep, totalEpisodes) : ep,
      seconds: sec,
      duration: dur,
      updatedAt: Number(entry.updatedAt || 0) * 1000,
      completedEpisodes: completed
    };
  }

  async function list(force = false) {
    if (!authenticated()) return [];
    if (listPending) return listPending;
    if (!force && listAt && Date.now() - listAt < 30000) return copy([...entries.values()].filter(e=>e.media));
    const userId=viewer.id;
    const run = (async()=>{
    const data = await request(
      "query ($userId: Int!) { MediaListCollection(userId: $userId, type: ANIME) { lists { entries { id mediaId status progress notes repeat updatedAt media { id idMal title { english romaji native userPreferred } coverImage { extraLarge large medium } bannerImage episodes status format averageScore seasonYear isAdult nextAiringEpisode { episode } } } } } }",
      { userId: Number(viewer.id) }
    );
    const all = (data?.MediaListCollection?.lists || [])
      .flatMap(group => group?.entries || [])
      .filter(entry => Number.isInteger(Number(entry.mediaId)) && entry.media);
    if(viewer?.id!==userId)return [];
    entries = new Map(all.map(entry => [Number(entry.mediaId), entry]));
    listAt=Date.now();
    return copy(all);
    })(); listPending=run; try{return await run}finally{if(listPending===run)listPending=null}
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
    if (!ended && dur > 0 && sec >= dur - 30) ended = true;
    const previous = pendingProgress.get(id) || Promise.resolve();
    const requestPromise = previous.catch(() => {}).then(async () => {
      if(!entries.has(id))await list(true);
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
        listAt=0;
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

  async function deleteEntry(mediaId) {
    if (!authenticated()) return false;
    const id = Number(mediaId);
    if (!entries.has(id)) await list(true);
    const entry = entries.get(id);
    if (!entry?.id) return false;
    const data = await request(
      "mutation ($id: Int!) { DeleteMediaListEntry(id: $id) { deleted } }",
      { id: Number(entry.id) }
    );
    if (data?.DeleteMediaListEntry?.deleted) { entries.delete(id); listAt = 0; }
    return data?.DeleteMediaListEntry?.deleted === true;
  }

  window.AniDashAccount = {
    captureRedirect, setHandler, settings, init, beginLogin, logout,
    currentUser, configured, authenticated, list, listManga, favorites, isFavorite, toggleFavorite,
    parseWatchNotes, formatWatchNotes, resumeFromEntry, syncPosition, setStatus, saveManga,
    getEntry, saveToList, deletePlanning, deleteEntry
  };
})();
