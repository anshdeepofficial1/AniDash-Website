import test from "node:test";
import assert from "node:assert/strict";
import worker, { parseTarget, hostAllowed } from "../worker/gateway.js";
import { gatewayFetch, gatewayConfigured } from "../server/gateway.js";

const env = { GATEWAY_KEY: "k".repeat(24) };
const req = (url, headers = {}, method = "GET") => new Request("https://gw.example.workers.dev/?url=" + encodeURIComponent(url), { method, headers });

test("worker rejects missing/wrong key and non-GET", async () => {
  assert.equal((await worker.fetch(req("https://justanime.to/x"), env)).status, 401);
  assert.equal((await worker.fetch(req("https://justanime.to/x", { "x-anidash-key": "nope" }), env)).status, 401);
  assert.equal((await worker.fetch(req("https://justanime.to/x", { "x-anidash-key": env.GATEWAY_KEY }, "POST"), env)).status, 405);
  assert.equal((await worker.fetch(req("https://justanime.to/x", { "x-anidash-key": "k" }), {})).status, 401);
});
test("worker refuses hosts outside the allowlist, http, credentials, ports, lookalikes", async () => {
  for (const u of ["https://evil.example/x", "http://justanime.to/x", "https://u:p@justanime.to/", "https://justanime.to:8443/", "https://justanime.to.evil.com/", "https://169.254.169.254/", "https://localhost/", "file:///etc/passwd"]) {
    assert.equal(parseTarget(u), null, u);
    assert.equal((await worker.fetch(req(u, { "x-anidash-key": env.GATEWAY_KEY }), env)).status, 400, u);
  }
  assert.ok(parseTarget("https://core.justanime.to/api/watch/1/episode/1") && hostAllowed("neko.justanime.to"));
});
test("worker forwards only x-fwd headers, caps redirects to allowed hosts, tags upstream status", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, h: Object.fromEntries(init.headers.entries()) });
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: "https://evil.example/x" } });
    return new Response("{}", { status: 200 });
  };
  const r = await worker.fetch(req("https://justanime.to/a", { "x-anidash-key": env.GATEWAY_KEY, "x-fwd-referer": "https://justanime.to/", cookie: "secret=1" }), env);
  assert.equal(r.status, 502);
  assert.equal(calls[0].h.referer, "https://justanime.to/");
  assert.equal(calls[0].h.cookie, undefined);
  assert.equal(calls[0].h["x-anidash-key"], undefined);
  globalThis.fetch = async () => new Response('{"a":1}', { status: 523, headers: { "content-type": "application/json" } });
  const ok = await worker.fetch(req("https://justanime.to/a", { "x-anidash-key": env.GATEWAY_KEY }), env);
  assert.equal(ok.status, 523); assert.equal(ok.headers.get("x-gw-upstream"), "523"); assert.equal(ok.headers.get("x-gw-error"), null);
});
test("gatewayFetch is a no-op without config and never needs the worker for non-configured env", async () => {
  assert.equal(gatewayConfigured({}), false);
  let seen; await gatewayFetch("https://justanime.to/x", { headers: { Referer: "r" } }, {}, async u => { seen = u; return new Response("") });
  assert.equal(seen, "https://justanime.to/x");
});
test("gatewayFetch routes via worker with key + forwarded headers; falls back direct only when the gateway itself fails", async () => {
  const e = { GATEWAY_URL: "https://gw.example.workers.dev", GATEWAY_KEY: "secret" };
  const urls = [];
  const ok = await gatewayFetch("https://justanime.to/x", { headers: { Referer: "https://justanime.to/", Cookie: "no" } }, e, async (u, i) => { urls.push(String(u)); assert.equal(i.headers["x-anidash-key"], "secret"); assert.equal(i.headers["x-fwd-referer"], "https://justanime.to/"); assert.equal(i.headers["x-fwd-cookie"], undefined); return new Response("up", { status: 403, headers: { "x-gw-upstream": "403" } }) });
  assert.equal(ok.status, 403); assert.match(urls[0], /^https:\/\/gw\.example\.workers\.dev\/\?url=https%3A%2F%2Fjustanime\.to%2Fx$/); assert.equal(urls.length, 1);
  const seq = []; const r = await gatewayFetch("https://justanime.to/x", {}, e, async u => { seq.push(String(u)); return seq.length === 1 ? new Response("{}", { status: 504, headers: { "x-gw-error": "1" } }) : new Response("direct", { status: 200 }) });
  assert.equal(await r.text(), "direct"); assert.equal(seq.length, 2);
  const t = []; await gatewayFetch("https://justanime.to/x", {}, e, async u => { t.push(u); if (t.length === 1) throw new Error("net"); return new Response("") }); assert.equal(t.length, 2);
  await gatewayFetch("https://justanime.to/x", {}, { GATEWAY_URL: "http://insecure.example", GATEWAY_KEY: "k" }, async u => { assert.equal(u, "https://justanime.to/x"); return new Response("") });
});
