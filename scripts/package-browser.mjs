import {cp} from "node:fs/promises";
for(const p of ["icons","library-storage.js","anilist-account.js","mal-account.js","manifest.webmanifest"]) await cp(p,"seanime-web/out/"+p,{recursive:true});
