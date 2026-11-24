import React from "react"
import {languages,normalizeLanguage,translate,type UiLanguage} from "./ui-language-catalog"
export {languages}
const key="anidash.ui-language.v1"
function read():UiLanguage {try{return normalizeLanguage(typeof window==="undefined"?null:window.localStorage.getItem(key))}catch{return "en"}}
let current=read()
const listeners=new Set<()=>void>()
function notify(){if(typeof document!=="undefined")document.documentElement.lang=current;listeners.forEach(f=>f())}
if(typeof window!=="undefined"){document.documentElement.lang=current;window.addEventListener("storage",e=>{if(e.key===key||e.key===null){current=read();notify()}})}
function subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener)}}
export function setUiLanguage(value:unknown){current=normalizeLanguage(value);try{window.localStorage.setItem(key,current)}catch{}notify()}
export function useUiLanguage(){const language=React.useSyncExternalStore(subscribe,()=>current,()=>"en" as UiLanguage);const t=React.useCallback((source:string)=>translate(language,source),[language]);return {language,t,setLanguage:setUiLanguage}}
