import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../anilist-account.js", import.meta.url), "utf8");

function browser(options = {}) {
  const local = new Map();
  const session = new Map();
  const called = [];
  const location = {
    hash: options.hash || "",
    pathname: "/home", search: "",
    assign(url) { called.push(url); }
  };
  const store = map => ({
    getItem: key => map.get(key) || null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key)
  });
  const history = {
    replaceState(_state, _unused, path) {
      const next = new URL(path, "https://anidash-watch.vercel.app");
      location.pathname = next.pathname;
      location.search = next.search;
      location.hash = next.hash;
    }
  };
  const crypto = { getRandomValues(bytes) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1;
    return bytes;
  }};
  const fetch = async (url, settings) => {
    if (url === "/api/auth-config") {
      return { ok: true, json: async () => ({
        enabled: true, clientId: "12345"
      }) };
    }
    if (url === "https://graphql.anilist.co") {
      assert.ok(settings.headers.Authorization.startsWith("Bearer "));
      const query = JSON.parse(settings.body).query;
      if (query.includes("Viewer")) {
        return { ok: true, json: async () => ({
          data: { Viewer: { id: 42, name: "TestUser", avatar: { medium: "https://example.com/avatar.png" } } }
        }) };
      }
      if (query.includes("MediaListCollection")) {
        return { ok: true, json: async () => ({
          data: { MediaListCollection: { lists: [{ entries: [{
            id: 7, mediaId: 21, status: "CURRENT", progress: 5,
            media: { id: 21, title: { english: "Sample Anime" } }
          }] }] } }
        }) };
      }
      if (query.includes("SaveMediaListEntry")) {
        return { ok: true, json: async () => ({
          data: { SaveMediaListEntry: { id: 7, mediaId: 21, status: "CURRENT", progress: 6 } }
        }) };
      }
      throw new Error("Unexpected GraphQL request " + query);
    }
    throw new Error("Unexpected URL " + url);
  };
  const window = {};
  vm.runInNewContext(src, {
    window, location, history,
    localStorage: store(local), sessionStorage: store(session),
    URLSearchParams, crypto, fetch,
    console
  });
  return { api: window.AniDashAccount, location, local, session, called };
}

test("AniList login is an external official OAuth authorization redirect", async () => {
  const { api, session, called } = browser();
  await api.settings();
  await api.beginLogin();
  assert.equal(called.length, 1);
  const url = new URL(called[0]);
  assert.equal(url.origin, "https://anilist.co");
  assert.equal(url.pathname, "/api/v2/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "12345");
  assert.equal(url.searchParams.get("response_type"), "token");
  assert.ok(session.get("anidash.watch.anilist.oauth-state"));
});

test("OAuth callback checks state before saving a token, loads real AniList profile and list", async () => {
  const b = browser();
  await b.api.settings();
  await b.api.beginLogin();
  const state = b.session.get("anidash.watch.anilist.oauth-state");
  b.location.hash = "#access_token=valid-token&token_type=Bearer&state=" + state;
  assert.equal(b.api.captureRedirect(), "success");
  assert.equal(b.location.pathname, "/account");
  assert.equal(b.location.hash, "", "OAuth callback must remove the token fragment");
  assert.equal(b.local.get("anidash.watch.anilist.token"), "valid-token");
  const user = await b.api.init();
  assert.equal(user.name, "TestUser");
  assert.equal(b.api.authenticated(), true);
  const entries = await b.api.list();
  assert.equal(entries[0].mediaId, 21);
  assert.equal(b.api.getEntry(21).status, "CURRENT");
  const updated = await b.api.saveToList(21, "PLANNING", 6);
  assert.equal(updated.status, "CURRENT", "existing watching status must not be downgraded");
  b.api.logout();
  assert.equal(b.api.authenticated(), false);
  assert.equal(b.local.has("anidash.watch.anilist.token"), false);
});

test("unsolicited/mismatched OAuth callback cannot authenticate a browser", async () => {
  const b = browser({ hash: "#access_token=stolen-token&state=wrong" });
  assert.equal(b.api.captureRedirect(), "invalid");
  assert.equal(b.local.size, 0);
  assert.equal(b.location.pathname, "/account");
  assert.equal(b.location.hash, "", "OAuth callback must remove the token fragment");
});

test("AniList public config endpoint does not expose private credentials", async () => {
  const { default: handler } = await import("../api/auth-config.js");
  const old = process.env.ANILIST_WEB_CLIENT_ID;
  const oldSecret = process.env.ANILIST_CLIENT_SECRET;
  try {
    process.env.ANILIST_WEB_CLIENT_ID = "1234";
    process.env.ANILIST_CLIENT_SECRET = "should-never-be-exposed";
    const headers = {};
    const res = {
      setHeader(k, v) { headers[k] = v; },
      status(n) { this.statusCode = n; return this; },
      json(data) { this.data = data; return this; }
    };
    handler({ method: "GET" }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.enabled, true);
    assert.equal(res.data.clientId, "1234");
    assert.ok(!JSON.stringify(res.data).includes("should-never-be-exposed"));
  } finally {
    if (old === undefined) delete process.env.ANILIST_WEB_CLIENT_ID;
    else process.env.ANILIST_WEB_CLIENT_ID = old;
    if (oldSecret === undefined) delete process.env.ANILIST_CLIENT_SECRET;
    else process.env.ANILIST_CLIENT_SECRET = oldSecret;
  }
});
