import test from "node:test";
import assert from "node:assert/strict";
import {youtubeEpisodeEmbed} from "../seanime-web/src/browser/official-embed.mjs";
test("official video URLs convert to privacy-enhanced inline embeds",()=>{
  assert.equal(youtubeEpisodeEmbed("https://www.youtube.com/watch?v=M7lc1UVf-VE"),"https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?playsinline=1&rel=0");
  assert.equal(youtubeEpisodeEmbed("https://youtu.be/M7lc1UVf-VE"),"https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?playsinline=1&rel=0");
});
test("reject arbitrary sites, malformed ids, playlist and credential URLs",()=>{
  for(const url of ["https://evil.example/watch?v=M7lc1UVf-VE","https://youtube.com.evil.example/watch?v=M7lc1UVf-VE","http://youtube.com/watch?v=M7lc1UVf-VE","https://youtube.com/watch?v=invalid","https://youtube.com/playlist?list=abc","https://user@youtube.com/watch?v=M7lc1UVf-VE"]) assert.equal(youtubeEpisodeEmbed(url),null);
});
