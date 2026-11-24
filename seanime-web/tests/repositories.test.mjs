import test from "node:test";import assert from "node:assert/strict";
import {parseRepository} from "../src/browser/repositories.ts";
const url="https://example.org/repo/index.json",pkg={id:"licensed",name:"Licensed anime",version:2,manifest:"episodes.json",sha256:"a".repeat(64)};
const input=(packages=[pkg])=>JSON.stringify({version:1,name:"My catalog",packages});
test("repository packages must stay on HTTPS repository origin",()=>{assert.equal(parseRepository(input(),url).packages[0].manifest,"https://example.org/repo/episodes.json");for(const manifest of ["http://example.org/a","https://evil.example/a","https://user:pass@example.org/a","https://example.org/a?token=x"])assert.throws(()=>parseRepository(input([{...pkg,manifest}]),url))});
test("repository schema rejects duplicates, invalid versions and checksums",()=>{assert.throws(()=>parseRepository(input([pkg,pkg]),url));assert.throws(()=>parseRepository(input([{...pkg,version:0}]),url));assert.throws(()=>parseRepository(input([{...pkg,sha256:"no"}]),url));assert.throws(()=>parseRepository(input(),"https://127.0.0.1/index"))});
