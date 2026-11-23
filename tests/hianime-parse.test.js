import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// parseHtmlSearch is module-private; load its source and evaluate just the parser functions.
const src = readFileSync(new URL("../api/hianime.js", import.meta.url), "utf8");
const start = src.indexOf("// Layout-agnostic reader");
const end = src.indexOf("async function search(");
const parse = new Function(src.slice(start, end) + "\nreturn parseHtmlSearch;")();

test("hianime: new tile layout is parsed", () => {
  const html = `<div class="hk-tile"><a href="/watch/one-piece-100" title="One Piece"><img data-src="https://x/p.jpg" alt="One Piece"></a></div>
    <div class="hk-tile"><a href="/one-piece-film-red-18000?ref=search"><img src="https://x/r.jpg" alt="One Piece Film: Red"></a></div>`;
  const rows = parse(html);
  assert.deepEqual(rows.map(r => r.id), ["one-piece-100", "one-piece-film-red-18000"]);
  assert.equal(rows[1].title, "One Piece Film: Red");
});

test("hianime: old flw-item layout still works", () => {
  const html = `<div class="flw-item"><div class="film-poster"><img data-src="https://x/a.jpg"></div><div class="film-detail"><h3><a href="/naruto-677" class="film-name">Naruto</a></h3></div></div></div>`;
  assert.equal(parse(html)[0]?.id, "naruto-677");
});
