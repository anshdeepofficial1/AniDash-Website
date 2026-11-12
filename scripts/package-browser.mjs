import {cp,mkdir,readFile,writeFile} from "node:fs/promises";
const dest="seanime-web/out-browser";
for(const p of ["icons","styles.css","android-ui.css","preferences.css","app-parity.css","unslop.css","native-parity.css","catalog-polish.css","premium-desktop.css","library-storage.js","anilist-account.js","mal-account.js","cbz-reader.js","episode-arcs.js","app.js","manifest.webmanifest"])await cp(p,dest+"/"+p,{recursive:true});
const legacy=(await readFile("index.html","utf8")).replace("<title>","<title>").replace(/<script src="\/app\.js\?v=28" defer>/,'<script src="/app.js?v=28" defer>');
await writeFile(dest+"/legacy.html",legacy);
