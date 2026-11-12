import React from "react"
import {useSetServerStatus} from "@/app/(main)/_hooks/use-server-status"
import {browserStatus} from "@/browser/transport"
export function ServerDataWrapper({children}:{host:string;children?:React.ReactNode}){const set=useSetServerStatus();React.useLayoutEffect(()=>{set(browserStatus() as any)},[set]);return <>{children}</>}
