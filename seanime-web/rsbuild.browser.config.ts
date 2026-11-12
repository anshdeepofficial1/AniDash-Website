import { defineConfig } from "@rsbuild/core"
import { pluginReact } from "@rsbuild/plugin-react"
import { pluginNodePolyfill } from "@rsbuild/plugin-node-polyfill"
import path from "node:path"
export default defineConfig({
 plugins:[pluginReact(),pluginNodePolyfill({include:["buffer","crypto"]})],
 source:{entry:{index:"./src/browser/main.tsx"},define:{"import.meta.env.SEA_PUBLIC_DESKTOP":JSON.stringify(""),"import.meta.env.SEA_PUBLIC_MOBILE":JSON.stringify("")}},
 resolve:{alias:{"@":path.resolve(__dirname,"src")}},
 output:{distPath:{root:"out-browser"}},
 html:{template:"./index.browser.html",title:"AniDash"},
})
