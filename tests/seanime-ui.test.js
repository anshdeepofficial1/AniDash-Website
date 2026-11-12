import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../seanime-ui.js",import.meta.url),"utf8");
const window={};
vm.runInNewContext(source,{window});
const media={id:21,title:{english:"Anime & <Title>"},coverImage:{extraLarge:"https://example.com/cover.png"},bannerImage:"https://example.com/banner.png",description:"<b>Anime synopsis</b>",format:"TV"};
test("ported Seanime card retains existing route contract and escapes metadata",()=>{
 const html=window.AniDashSeaUI.card(media,{score:"8.7",progress:25,resume:"Episode 2",season:"S1"});
 assert.match(html,/data-media-entry-card-container/);
 assert.match(html,/data-anime="21"/);
 assert.match(html,/aspect|media-entry-card__body/);
 assert.match(html,/data-media-entry-card-title-section/);
 assert.match(html,/Anime &amp; &lt;Title&gt;/);
 assert.match(html,/width:25%/);
 assert.match(html,/Episode 2/);
 assert.doesNotMatch(html,/<Title>/);
});
test("ported banner has cover, backdrop, metadata and existing actions",()=>{
 const html=window.AniDashSeaUI.spotlight(media,{score:"8.7",season:"S1"});
 assert.match(html,/data-discover-page-header-banner-image/);
 assert.match(html,/sea-hero-poster/);
 assert.match(html,/Anime synopsis/);
 assert.match(html,/data-anime="21"/);
 assert.match(html,/data-watchlist="21"/);
 assert.doesNotMatch(html,/<b>Anime synopsis/);
});
test("Vercel shell loads the adapter before the app and caches it offline",()=>{
 const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 const sw=readFileSync(new URL("../sw.js",import.meta.url),"utf8");
 assert.ok(html.indexOf("/seanime-ui.js")<html.indexOf("/app.js"));
 assert.match(html,/seanime-ui.css/);
 assert.match(sw,/seanime-ui.js/);
 assert.match(sw,/seanime-ui.css/);
});

test("ported entry header preserves watchlist and episode action contracts",()=>{
 const html=window.AniDashSeaUI.entryHeader(media,{score:"8.7",year:2025,hasEpisodes:true});
 assert.match(html,/data-media-page-header-entry-details/);
 assert.match(html,/data-play-first="21"/);
 assert.match(html,/data-watchlist="21"/);
 assert.match(html,/Anime synopsis/);
 assert.doesNotMatch(html,/disabled/);
});
