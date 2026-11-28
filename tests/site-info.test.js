import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,copyFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {execFileSync} from "node:child_process";
test("generated public site pages and release manifest share the current version",async()=>{
 const root=await mkdtemp(join(tmpdir(),"anidash-site-"));
 try{
  const fixture=join(root,"seanime-web/src/browser");
  await mkdir(fixture,{recursive:true});
  const release=resolve("seanime-web/src/browser/web-release.json");
  await copyFile(release,join(fixture,"web-release.json"));
  const expected=JSON.parse(await readFile(release,"utf8"));
  execFileSync(process.execPath,[resolve("scripts/package-site-info.mjs")],{cwd:root});
  const out=join(root,"seanime-web/out");
  const read=name=>readFile(join(out,name),"utf8");
  assert.match(expected.version,/^\d+\.\d+\.\d+$/);
  assert.equal(expected.releases[0].version,expected.version);
  assert.deepEqual(JSON.parse(await read("version.json")),expected);
  const sitemap=await read("sitemap.xml");
  for(const page of ["about","releases","support","privacy","terms"]){
   const html=await read(page+".html");
   assert.ok(html.includes('rel="canonical" href="https://anidashgo.vercel.app/'+page+'"'));
   assert.ok(html.includes("v"+expected.version));
   assert.ok(html.includes('href="/privacy"'));
   assert.ok(sitemap.includes("<loc>https://anidashgo.vercel.app/"+page+"</loc>"));
  }
  assert.ok(!(sitemap.includes("/connect")||sitemap.includes("/settings")));
  assert.match(await read("robots.txt"),/Disallow: \/api\//);
  assert.match(await read("robots.txt"),/Sitemap: https:\/\/anidashgo\.vercel\.app\/sitemap\.xml/);
 }finally{await rm(root,{recursive:true,force:true})}
});
