// Official MyAnimeList OAuth 2.0 + PKCE. No provider passwords are collected.
(() => {
  "use strict";
  const STORAGE = "anidash.watch.mal.tokens.v1";
  const PENDING = "anidash.watch.mal.oauth.v1";
  const origin = () => location.origin || (location.protocol + "//" + location.host);
  let session = null;
  let viewer = null;
  let config = null;
  let entries = [];
  let notify = () => {};
  function clone(x) { return x == null ? null : JSON.parse(JSON.stringify(x)); }
  function setHandler(handler) { notify = typeof handler === "function" ? handler : () => {}; }
  function emit() { try { notify(clone(viewer)); } catch (_) {} }
  function clear() {
    session = null; viewer = null; entries = [];
    try { localStorage.removeItem(STORAGE); } catch (_) {}
    emit();
  }
  function readSession() {
    if (session) return session;
    try { session = JSON.parse(localStorage.getItem(STORAGE) || "null"); } catch (_) {}
    return session;
  }
  function saveSession(next) {
    session = { ...next, expires_at: Date.now() + Math.max(60, Number(next.expires_in || 3600) - 90) * 1000 };
    localStorage.setItem(STORAGE, JSON.stringify(session));
  }
  async function configuration() {
    if (config) return config;
    try {
      const response = await fetch("/api/mal-config", { cache: "no-store" });
      const data = await response.json();
      config = response.ok && data.enabled && data.clientId
        ? { enabled: true, clientId: data.clientId }
        : { enabled: false, clientId: "" };
    } catch (_) { config = { enabled: false, clientId: "" }; }
    return config;
  }
  function randomString(bytes = 32) {
    const buffer = new Uint8Array(bytes);
    crypto.getRandomValues(buffer);
    return Array.from(buffer, byte => byte.toString(16).padStart(2, "0")).join("");
  }
  async function beginLogin() {
    const config = await configuration();
    if (!config.enabled) throw new Error("MyAnimeList web login needs its own OAuth client ID in Vercel.");
    const state = randomString(20);
    const verifier = randomString(48);
    sessionStorage.setItem(PENDING, JSON.stringify({ state, verifier, createdAt: Date.now() }));
    const redirect = origin() + "/";
    const params = new URLSearchParams({
      response_type: "code", client_id: config.clientId, redirect_uri: redirect,
      code_challenge: verifier, code_challenge_method: "plain", state
    });
    location.assign("https://myanimelist.net/v1/oauth2/authorize?" + params.toString());
  }
  async function exchange(input) {
    const response = await fetch("/api/mal-token", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw new Error(data.error || "MyAnimeList login failed");
    saveSession(data);
  }
  async function captureRedirect() {
    const params = new URLSearchParams(location.search || "");
    if (!params.has("code") && !params.has("error")) return false;
    let pending = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(PENDING) || "null");
      sessionStorage.removeItem(PENDING);
    } catch (_) {}
    const valid = params.get("code") && pending && pending.state === params.get("state") &&
      Date.now() - pending.createdAt < 10 * 60 * 1000;
    try { history.replaceState(null, "", "/account"); }
    catch (_) { location.assign("/account"); }
    if (!valid) return "invalid";
    await exchange({
      grant_type: "authorization_code", code: params.get("code"),
      code_verifier: pending.verifier, redirect_uri: origin() + "/"
    });
    return "success";
  }
  async function token() {
    const current = readSession();
    if (!current?.access_token) throw new Error("Sign in with MyAnimeList first");
    if (current.expires_at > Date.now()) return current.access_token;
    if (!current.refresh_token) { clear(); throw new Error("MyAnimeList session expired"); }
    const response = await fetch("/api/mal-token", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: current.refresh_token })
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) {
      clear(); throw new Error("MyAnimeList session expired. Please sign in again.");
    }
    saveSession({ ...data, refresh_token: data.refresh_token || current.refresh_token });
    return session.access_token;
  }
  async function data(action, args = {}, method = "GET", payload) {
    const params = new URLSearchParams({ action, ...args });
    const response = await fetch("/api/mal-data?" + params, {
      method, headers: { Authorization: "Bearer " + await token(),
        ...(payload ? { "Content-Type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
    const output = await response.json();
    if (!response.ok) throw new Error(output.error || "MyAnimeList API unavailable");
    return output;
  }
  async function init() {
    try {
      if (!readSession()) { emit(); return null; }
      viewer = await data("profile");
    } catch (_) { viewer = null; }
    emit();
    return clone(viewer);
  }
  async function list() {
    if (!viewer) return [];
    const all = [];
    for (let offset = 0; offset < 10000; offset += 100) {
      const page = await data("list", { limit: 100, offset });
      const nodes = Array.isArray(page.data) ? page.data : [];
      all.push(...nodes);
      if (!page.paging?.next || nodes.length < 100) break;
    }
    entries = all;
    return clone(all);
  }
  async function updateProgress(malId, progress, status = "watching") {
    if (!viewer) return null;
    return data("progress", { id: malId }, "PUT", { progress, status });
  }
  const currentUser = () => clone(viewer);
  const authenticated = () => Boolean(viewer && readSession()?.access_token);
  const configured = () => Boolean(config?.enabled);
  const logout = () => clear();
  window.AniDashMal = {
    configuration, captureRedirect, beginLogin, init, currentUser, authenticated, configured,
    setHandler, list, updateProgress, logout
  };
})();