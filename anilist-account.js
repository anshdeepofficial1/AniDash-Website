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
  let changeHandler = () => {};
  const copy = x => x && typeof x === "object" ? JSON.parse(JSON.stringify(x)) : x;

  function setHandler(handler) {
    changeHandler = typeof handler === "function" ? handler : () => {};
  }
  function inform() { try { changeHandler(copy(viewer)); } catch (_) {} }
  function clearToken() {
    token = null;
    viewer = null;
    entries.clear();
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
  function getEntry(mediaId) { return copy(entries.get(Number(mediaId)) || null); }

  async function list() {
    if (!authenticated()) return [];
    const data = await request(
      "query ($userId: Int!) { MediaListCollection(userId: $userId, type: ANIME) { lists { entries { id mediaId status progress media { id idMal title { english romaji native } coverImage { extraLarge large medium } bannerImage episodes status format averageScore seasonYear } } } } }",
      { userId: Number(viewer.id) }
    );
    const all = (data?.MediaListCollection?.lists || [])
      .flatMap(group => group?.entries || [])
      .filter(entry => Number.isInteger(Number(entry.mediaId)) && entry.media);
    entries = new Map(all.map(entry => [Number(entry.mediaId), entry]));
    return copy(all);
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
    currentUser, configured, authenticated, list, getEntry, saveToList, deletePlanning
  };
})();
