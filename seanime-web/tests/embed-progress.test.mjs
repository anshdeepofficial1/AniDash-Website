import test from "node:test";import assert from "node:assert/strict";
import {embedProgressOrigin,readEmbedCheckpoint} from "../src/browser/embed-progress.ts";
test("existing embeds normalize actual timestamps",()=>{
 const expected={position:877,duration:1440,ended:false};
 assert.deepEqual(readEmbedCheckpoint("https://megaplay.buzz",{channel:"megacloud",event:"time",time:877,duration:1440}),expected);
 assert.deepEqual(readEmbedCheckpoint("https://megavid.buzz",JSON.stringify({type:"watching-log",currentTime:877,duration:1440})),expected);
 assert.deepEqual(readEmbedCheckpoint("https://anixo.buzz",{type:"aniembed:timeupdate",currentTime:877,duration:1440}),expected)
});
test("reject unknown origin, malformed event, invalid timestamps and premature completion",()=>{
 assert.equal(embedProgressOrigin("https://megaplay.buzz.evil.example"),null);
 assert.equal(readEmbedCheckpoint("https://evil.example",{type:"watching-log",currentTime:1,duration:10}),null);
 assert.equal(readEmbedCheckpoint("https://megaplay.buzz",{channel:"kisskh",event:"time",time:20,duration:60}),null);
 for(const time of [-1,NaN,Infinity,200,"20"])assert.equal(readEmbedCheckpoint("https://megaplay.buzz",{channel:"megacloud",event:"time",time,duration:60}),null);
 assert.equal(readEmbedCheckpoint("https://megavid.buzz",{channel:"kisskh",event:"complete"},{position:20,duration:1440,ended:false}),null);
 assert.equal(readEmbedCheckpoint("https://megavid.buzz",{channel:"kisskh",event:"complete"},{position:1430,duration:1440,ended:false}).ended,true)
});
