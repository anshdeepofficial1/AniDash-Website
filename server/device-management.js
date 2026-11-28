// Device records are separate from encrypted tracker credentials. All state transitions are atomic.
import { randomUUID, randomBytes, createHash, createHmac } from "node:crypto";
export const MANAGEMENT_TTL = 30 * 86400;
const RETENTION = 7 * 86400;
const hash = value => createHash("sha256").update(value).digest("hex");
const iso = value => new Date(value).toISOString();
export const validDeviceId = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export function deviceStore(redis, encryptionKey) {
  // Environment-specific namespace: preview and production may share Redis.
  const ns = "anidash:devices:v1:" + createHmac("sha256",encryptionKey).update("device-management").digest("hex").slice(0,32) + ":";
  const identity = accounts => {
    const id = accounts?.anilist?.profile?.id ?? accounts?.myanimelist?.profile?.id;
    if (!/^\d{1,20}$/.test(String(id))) throw Error("Invalid identity");
    return createHmac("sha256",encryptionKey).update((accounts?.anilist?.profile?.id != null ? "anilist:" : "mal:")+id).digest("hex");
  };
  const index = owner => ns+"index:"+owner;
  const record = id => ns+"record:"+id;
  const map = sessionKey => ns+"session:"+sessionKey.split(":").pop();
  const managementKey = token => ns+"management:"+hash(token);
  const management = owner => {
    const token=randomBytes(32).toString("hex"), expiresAt=Date.now()+MANAGEMENT_TTL*1000;
    return {token,expiresAt:iso(expiresAt),key:managementKey(token),value:JSON.stringify({owner,expiresAt})};
  };
  const readManagement = async token => {
    if(typeof token!=="string"||!/^[0-9a-f]{64}$/.test(token))return null;
    const raw=await redis("GET",managementKey(token));
    if(!raw)return null;
    const value=JSON.parse(raw);
    return value.expiresAt>Date.now()?value:null;
  };
  const rotateManagement = async (token,owner) => {
    const fresh=management(owner);
    const ok=await redis("EVAL","if not redis.call('GET',KEYS[1]) then return 0 end; redis.call('SET',KEYS[2],ARGV[1],'EX',ARGV[2]); redis.call('DEL',KEYS[1]); return 1",2,managementKey(token),fresh.key,fresh.value,MANAGEMENT_TTL);
    return ok===1?{token:fresh.token,expiresAt:fresh.expiresAt}:null;
  };
  const revokeManagement = token => redis("DEL",managementKey(token));
  const makeRecord = (owner,sessionKey,info,pairedAt,expiresAt) => ({
    id:randomUUID(),owner,sessionHash:sessionKey.split(":").pop(),
    name:info.name,browser:info.browser,os:info.os,pairedAt,lastActiveAt:Date.now(),
    sessionExpiresAt:expiresAt,revokedAt:null
  });
  const consume = async ({pairKey,sessionKey,binding,encrypted,owner,info,ttl}) => {
    const now=Date.now(), d=makeRecord(owner,sessionKey,info,now,now+ttl*1000);
    return redis("EVAL", CONSUME,5,pairKey,sessionKey,record(d.id),map(sessionKey),index(owner),binding,now,encrypted,ttl,JSON.stringify(d),ttl+RETENTION,d.id,d.sessionExpiresAt);
  };

  // Lazy migration of old sessions: use remaining TTL; never resurrect a deleted session.
  const active = async (sessionKey,owner,info,ttl) => {
    const now=Date.now(), d=makeRecord(owner,sessionKey,info,now+ttl-30*86400000,now+ttl);
    const raw=await redis("EVAL",ACTIVE,4,sessionKey,map(sessionKey),record(d.id),index(owner),ns+"record:",now,JSON.stringify(d),Math.ceil(ttl/1000)+RETENTION,d.id,d.sessionExpiresAt,owner);
    return raw?JSON.parse(raw):null;
  };
  const list = async (owner,currentId) => {
    const raw=await redis("EVAL",LIST,1,index(owner),ns+"record:",Date.now(),owner);
    return (raw||[]).map(JSON.parse).map(d=>({
      id:d.id,name:d.name,browser:d.browser,os:d.os,pairedAt:iso(d.pairedAt),lastActiveAt:iso(d.lastActiveAt),
      sessionExpiresAt:iso(d.sessionExpiresAt),current:d.id===currentId
    }));
  };
  const revoke = (owner,id) => redis("EVAL",REVOKE,2,record(id),index(owner),owner,Date.now(),"anidash:session:",ns+"session:",RETENTION);
  return {identity,management,readManagement,rotateManagement,revokeManagement,consume,active,list,revoke};
}
const CONSUME = [
  "local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end",
  "local s=cjson.decode(raw); if s.bind~=ARGV[1] then return -2 end",
  "if tonumber(s.expiresAt)<=tonumber(ARGV[2]) or s.state~='approved' then return -1 end",
  "redis.call('SET',KEYS[2],ARGV[3],'EX',ARGV[4]); redis.call('SET',KEYS[3],ARGV[5],'EX',ARGV[6])",
  "redis.call('SET',KEYS[4],ARGV[7],'EX',ARGV[6]); redis.call('ZADD',KEYS[5],ARGV[8],ARGV[7]); redis.call('EXPIRE',KEYS[5],ARGV[6])",
  "redis.call('DEL',KEYS[1]); return 1"
].join('\n');
const ACTIVE = [
  "if redis.call('EXISTS',KEYS[1])==0 then return false end",
  "local id=redis.call('GET',KEYS[2]); local d",
  "if id then local raw=redis.call('GET',ARGV[1]..id); if not raw then return false end; d=cjson.decode(raw)",
  "if d.owner~=ARGV[7] or d.revokedAt~=cjson.null or d.sessionExpiresAt<=tonumber(ARGV[2]) then return false end",
  "if tonumber(ARGV[2])-d.lastActiveAt>=300000 then d.lastActiveAt=tonumber(ARGV[2]); redis.call('SET',ARGV[1]..id,cjson.encode(d),'KEEPTTL') end",
  "else d=cjson.decode(ARGV[3]); redis.call('SET',KEYS[3],ARGV[3],'EX',ARGV[4]); redis.call('SET',KEYS[2],ARGV[5],'EX',ARGV[4]); redis.call('ZADD',KEYS[4],ARGV[6],ARGV[5]); local t=redis.call('TTL',KEYS[4]); if t<tonumber(ARGV[4]) then redis.call('EXPIRE',KEYS[4],ARGV[4]) end end",
  "return cjson.encode(d)"
].join('\n');
const LIST = [
  "redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[2]); local ids=redis.call('ZREVRANGE',KEYS[1],0,199); local out={}",
  "for _,id in ipairs(ids) do local raw=redis.call('GET',ARGV[1]..id); if raw then local d=cjson.decode(raw); if d.owner==ARGV[3] and d.revokedAt==cjson.null and d.sessionExpiresAt>tonumber(ARGV[2]) and redis.call('EXISTS','anidash:session:'..d.sessionHash)==1 then table.insert(out,raw) end else redis.call('ZREM',KEYS[1],id) end end; return out"
].join('\n');
const REVOKE = [
  "local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end; local d=cjson.decode(raw); if d.owner~=ARGV[1] then return 0 end",
  "if d.revokedAt==cjson.null then d.revokedAt=tonumber(ARGV[2]); redis.call('SET',KEYS[1],cjson.encode(d),'EX',ARGV[5]) end",
  "redis.call('DEL',ARGV[3]..d.sessionHash); redis.call('ZREM',KEYS[2],d.id); return 1"
].join('\n');
