import React from "react"
import {installedSources} from "./sources"
export function useInstalledSources(){const [sources,setSources]=React.useState(installedSources);React.useEffect(()=>{const refresh=()=>setSources(installedSources());window.addEventListener("anidash-sources",refresh);window.addEventListener("storage",refresh);refresh();return()=>{window.removeEventListener("anidash-sources",refresh);window.removeEventListener("storage",refresh)}},[]);return sources}
