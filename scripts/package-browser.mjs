import {cp} from "node:fs/promises";
for(const p of ["icons","library-storage.js","anilist-account.js","mal-account.js","manifest.webmanifest"]) await cp(p,"seanime-web/out/"+p,{recursive:true});

/* Produce a cropped transparent PNG from the actual white-on-black AniDash logo.
   Node built-ins only; leave original app icons unchanged. */
import {readFile,writeFile} from "node:fs/promises";
import {inflateSync,deflateSync} from "node:zlib";
const png=await readFile("seanime-web/public/anidash-logo.png");
const w=png.readUInt32BE(16),h=png.readUInt32BE(20);
if(png[24]!==8||png[25]!==6||png[28]!==0)throw Error("Expected noninterlaced RGBA brand PNG");
const parts=[];
for(let p=8;p<png.length;){const n=png.readUInt32BE(p),name=png.toString("ascii",p+4,p+8);if(name==="IDAT")parts.push(png.subarray(p+8,p+8+n));p+=12+n}
const raw=inflateSync(Buffer.concat(parts)),stride=w*4,px=Buffer.alloc(stride*h);
function paeth(a,b,c){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c}
for(let y=0;y<h;y++){const type=raw[y*(stride+1)];if(type>4)throw Error("Unsupported PNG filter");for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=4?px[i-4]:0,b=y?px[i-stride]:0,c=y&&x>=4?px[i-stride-4]:0;px[i]=(raw[y*(stride+1)+1+x]+(type===1?a:type===2?b:type===3?Math.floor((a+b)/2):type===4?paeth(a,b,c):0))&255}}
let minX=w,minY=h,maxX=-1,maxY=-1;
function alpha(i){return Math.round(Math.max(px[i],px[i+1],px[i+2])*px[i+3]/255)}
for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(alpha((y*w+x)*4)>18){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}}
if(maxX<minX)throw Error("Brand artwork is empty");
const pad=4;minX=Math.max(0,minX-pad);minY=Math.max(0,minY-pad);maxX=Math.min(w-1,maxX+pad);maxY=Math.min(h-1,maxY+pad);
const dw=maxX-minX+1,dh=maxY-minY+1,scan=Buffer.alloc((dw*4+1)*dh);
for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){const src=((y+minY)*w+x+minX)*4,dst=y*(dw*4+1)+1+x*4;scan[dst]=scan[dst+1]=scan[dst+2]=255;scan[dst+3]=alpha(src)}
function crc32(buf){let c=0xffffffff;for(const v of buf){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function chunk(name,data){const tag=Buffer.from(name),out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length,0);tag.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([tag,data])),8+data.length);return out}
const hdr=Buffer.alloc(13);hdr.writeUInt32BE(dw,0);hdr.writeUInt32BE(dh,4);hdr[8]=8;hdr[9]=6;
await writeFile("seanime-web/out/anidash-watermark.png",Buffer.concat([png.subarray(0,8),chunk("IHDR",hdr),chunk("IDAT",deflateSync(scan)),chunk("IEND",Buffer.alloc(0))]));
console.log("Transparent AniDash watermark generated:",dw+"x"+dh);
