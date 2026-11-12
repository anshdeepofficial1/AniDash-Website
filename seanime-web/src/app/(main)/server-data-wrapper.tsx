import React from "react"
import {useSetServerStatus} from "@/app/(main)/_hooks/use-server-status"
import {browserStatus} from "@/browser/transport"
import {useQueryClient} from "@tanstack/react-query"
export function ServerDataWrapper({children}:{host:string;children?:React.ReactNode}){const set=useSetServerStatus();const query=useQueryClient();React.useLayoutEffect(()=>{set(browserStatus() as any);let alive=true;const timer=window.setTimeout(async()=>{const account=(window as any).AniDashAccount;if(!account||location.pathname.startsWith("/auth/callback"))return;try{await account.init();if(alive){set(browserStatus() as any);window.dispatchEvent(new Event("anidash-account-ready"));void query.invalidateQueries({predicate:q=>String(q.queryKey[0]).toLowerCase().includes("collection")||String(q.queryKey[0]).includes("anidash-schedule")})}}catch{}},100);return()=>{alive=false;clearTimeout(timer)}},[set,query]);return <>{children}</>}
