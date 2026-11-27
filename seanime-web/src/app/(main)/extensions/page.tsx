import React from "react"
import { CustomLibraryBanner } from "@/app/(main)/_features/anime-library/_containers/custom-library-banner"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { Button } from "@/components/ui/button"
import * as Engine from "@/browser/engine"
import { repositories, refreshRepository, removeRepository, installRepositoryPackage, packageState } from "@/browser/repositories"
import { installedSources, parseSource, installSource, removeSource, setSourceEnabled } from "@/browser/sources"

const STORE = "anidash.watch.web.v1"
const BADGE: Record<Engine.SourceStatus, string> = {
  verified: "border-emerald-500/60 text-emerald-300 bg-emerald-500/10",
  available: "border-sky-500/50 text-sky-300 bg-sky-500/10",
  degraded: "border-amber-500/60 text-amber-300 bg-amber-500/10",
  unavailable: "border-red-500/60 text-red-300 bg-red-500/10",
  update: "border-violet-500/60 text-violet-300 bg-violet-500/10",
  incompatible: "border-zinc-500/60 text-zinc-300 bg-zinc-500/10",
  unverified: "border-zinc-500/50 text-zinc-300 bg-zinc-500/10",
}
const DELIVERY: Record<Engine.Delivery, string> = { native: "Native AniDash playback", embed: "Embedded provider player", external: "Opens provider site" }
const AUTH: Record<Engine.Authorization, string> = { official: "Official publisher", "third-party": "Third-party (no licence evidence)", user: "Your own licensed media" }

function readAudio(): "dub" | "sub" {
  try { return (JSON.parse(localStorage.getItem(STORE) || "{}") as any).preferences?.preferredAudio === "sub" ? "sub" : "dub" } catch { return "dub" }
}
function writeAudio(a: "dub" | "sub") {
  try { const s: any = JSON.parse(localStorage.getItem(STORE) || "{}"); s.preferences = { ...s.preferences, preferredAudio: a }; s.updatedAt = Date.now(); localStorage.setItem(STORE, JSON.stringify(s)) } catch { /* ignore */ }
}
function useEngineTick() {
  const [n, setN] = React.useState(0)
  React.useEffect(() => { const f = () => setN(x => x + 1); window.addEventListener("anidash-engine", f); window.addEventListener("anidash-sources", f); return () => { window.removeEventListener("anidash-engine", f); window.removeEventListener("anidash-sources", f) } }, [])
  return n
}

export default function Page() {
  useEngineTick()
  const [view, setView] = React.useState<"installed" | "available" | "all">("all")
  const [query, setQuery] = React.useState("")
  const [lang, setLang] = React.useState("")
  const [open, setOpen] = React.useState<string | null>(null)
  const [audio, setAudio] = React.useState<"dub" | "sub">(readAudio)
  const [sources, setSources] = React.useState(installedSources)
  const [message, setMessage] = React.useState("")
  const [consent, setConsent] = React.useState(false)
  const [url, setUrl] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [repoUrl,setRepoUrl]=React.useState("")
  const [repos,setRepos]=React.useState(repositories)
  const [repoConsent,setRepoConsent]=React.useState(false)
  const [repoBusy,setRepoBusy]=React.useState(false)
  const repoAction=async(action:()=>Promise<unknown>,success:string)=>{setRepoBusy(true);try{await action();setRepos(repositories());setSources(installedSources());setMessage(success)}catch(e){setMessage(e instanceof Error?e.message:"Repository request failed")}finally{setRepoBusy(false)}}
  const prefs = Engine.loadPrefs()

  const rows = Engine.animeExtensionCatalog().filter(p => {
    const runnable = Engine.isRunnable(p)
    if (view === "installed" && !(runnable && Engine.isEnabled(p.id))) return false
    if (view === "available" && runnable) return false
    if (query && !(p.name + " " + p.description).toLowerCase().includes(query.toLowerCase())) return false
    if (lang && !p.languages.includes(lang) && !(lang === "none" && !p.languages.length)) return false
    return true
  }).sort((a, b) => Engine.score(a.id) - Engine.score(b.id))
  const langs = Array.from(new Set(Engine.animeExtensionCatalog().flatMap(p => p.languages)))

  const refreshSources = () => setSources(installedSources())
  async function importText(text: string) {
    const source = parseSource(text); installSource(source); refreshSources(); setMessage(source.name + " installed")
  }
  async function importFile(file: File | undefined) {
    if (!file) return
    try { if (!consent) throw Error("Confirm that you have permission to use this media."); if (file.size > 2_000_000) throw Error("Manifest exceeds 2 MB"); await importText(await file.text()) } catch (e) { setMessage(e instanceof Error ? e.message : "Import failed") }
  }
  async function importUrl() {
    try {
      if (!consent) throw Error("Confirm you have permission first.")
      if (!Engine.isSafeHttpsUrl(url)) throw Error("Use a public HTTPS manifest URL without credentials.")
      setBusy(true)
      const r = await fetch(new URL(url).href, { credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: AbortSignal.timeout(15000) })
      if (!r.ok) throw Error("Manifest request failed: " + r.status)
      const blob = await r.blob(); if (blob.size > 2_000_000) throw Error("Manifest exceeds 2 MB")
      await importText(await blob.text()); setUrl("")
    } catch (e) { setMessage(e instanceof Error ? e.message : "Manifest could not be loaded. The host must allow browser CORS.") } finally { setBusy(false) }
  }

  const chip = (active: boolean) => "px-3 py-1 rounded-full border text-sm " + (active ? "bg-brand-500/20 border-brand-400 text-white" : "border-[--border] text-[--muted]")
  return <>
    <CustomLibraryBanner discrete />
    <PageWrapper className="p-4 sm:p-8 space-y-6 max-w-5xl mx-auto w-full overflow-x-hidden">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Extensions</h1>
        <p className="text-sm text-[--muted]">Manage anime sources for AniDash playback. Android-only extensions remain incompatible until a web adapter exists. Imported manifests never execute remote code. Playback status reflects actual use on this device.</p>
      </header>

      <div className="flex flex-wrap gap-2 items-center" role="tablist">
        <span className="text-sm font-medium">Anime sources</span>
        {(["all", "installed", "available"] as const).map(v => <button key={v} className={chip(view === v)} onClick={() => setView(v)}>{v === "all" ? "All" : v === "installed" ? "Installed" : "Available / not runnable"}</button>)}
      </div>

      <div className="flex flex-wrap gap-2">
        <input className="border border-[--border] rounded-lg p-2 flex-1 min-w-[12rem] bg-[--paper]" placeholder="Search sources" aria-label="Search sources" value={query} onChange={e => setQuery(e.target.value)} />
        <select className="border border-[--border] rounded-lg p-2 bg-[--paper]" aria-label="Language filter" value={lang} onChange={e => setLang(e.target.value)}>
          <option value="">All languages</option>
          {langs.map(l => <option key={l} value={l}>{Engine.LANGUAGE_LABELS[l] || l}</option>)}
          <option value="none">No playable language</option>
        </select>
        <Button intent="gray-outline" onClick={() => { Engine.restoreDefaults(); setMessage("Recommended defaults restored.") }}>Restore defaults</Button>
        <Button intent="gray-outline" onClick={() => { Engine.resetHealth(); setMessage("Local health history cleared.") }}>Reset health</Button>
      </div>
      {message && <p role="status" className="border rounded-lg p-3 text-sm">{message}</p>}

      <section className="space-y-3" aria-label="Sources">
        {!rows.length && <p className="text-[--muted]">No sources match.</p>}
        {rows.map(p => {
          const st = Engine.statusOf(p.id)
          const runnable = Engine.isRunnable(p)
          const enabled = Engine.isEnabled(p.id)
          const h = Engine.loadHealth()[p.id]
          return <article key={p.id} className="border border-[--border] rounded-xl p-4 bg-[--paper] space-y-2 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-base font-semibold truncate">{p.name} {p.recommended && <span className="text-xs font-normal text-brand-300">Recommended</span>}</h2>
                <p className="text-sm text-[--muted]">{p.description}</p>
              </div>
              <span className={"text-xs border rounded-full px-2 py-0.5 whitespace-nowrap " + BADGE[enabled || !runnable ? st.status : "unverified"]}>{runnable && !enabled ? "Disabled" : st.label}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs text-[--muted]">
              <span className="border rounded px-1.5">{DELIVERY[p.delivery]}</span>
              <span className="border rounded px-1.5">{AUTH[p.authorization]}</span>
              {p.languages.map(l => <span key={l} className="border rounded px-1.5">{Engine.LANGUAGE_LABELS[l] || l}</span>)}
              {p.version > 0 && <span className="border rounded px-1.5">v{p.version}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {runnable && <Button size="sm" intent={enabled ? "gray-outline" : "primary"} onClick={() => Engine.setEnabled(p.id, !enabled)}>{enabled ? "Disable" : "Enable"}</Button>}
              {runnable && <label className="text-sm flex items-center gap-1.5">Priority
                <input type="number" min={0} max={999} className="w-16 border border-[--border] rounded p-1 bg-transparent" value={prefs.order[p.id] ?? p.priority} onChange={e => Engine.setPriority(p.id, e.target.value === "" ? null : Number(e.target.value))} /></label>}
              <button className="text-sm underline text-[--muted]" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? "Hide details" : "Details"}</button>
            </div>
            {open === p.id && <dl className="text-sm grid sm:grid-cols-2 gap-x-6 gap-y-1 pt-2 border-t border-[--border]">
              <dt className="text-[--muted]">Status detail</dt><dd>{st.detail}</dd>
              <dt className="text-[--muted]">Last verified (≥60 s playback)</dt><dd>{h?.lastVerified ? new Date(h.lastVerified).toLocaleString() : "Never on this device"}</dd>
              <dt className="text-[--muted]">Successes / failures</dt><dd>{h?.ok || 0} / {h?.fail || 0}</dd>
              <dt className="text-[--muted]">Avg. resolve / first frame</dt><dd>{h?.resolveMs ? (h.resolveMs / 1000).toFixed(1) + " s" : "–"} / {h?.startMs ? (h.startMs / 1000).toFixed(1) + " s" : "–"}</dd>
              <dt className="text-[--muted]">Buffering events</dt><dd>{h?.stalls || 0}</dd>
              <dt className="text-[--muted]">Last error</dt><dd className="break-words">{h?.lastError || "–"}</dd>
              {p.incompatibleReason && <><dt className="text-[--muted]">Why incompatible</dt><dd>{p.incompatibleReason}</dd></>}
              <dt className="text-[--muted]">Privacy</dt><dd>Using a source may share network information and the requested title with AniDash’s relay and the provider. Your AniList token is never sent.</dd>
            </dl>}
          </article>
        })}
      </section>

      <section className="border border-[--border] rounded-xl p-4 space-y-3" aria-label="Playback preferences">
        <h2 className="text-base font-semibold">Playback preferences</h2>
        <p className="text-sm text-[--muted]">Default audio when you open an episode. English DUB is the default. AniDash never switches audio language silently; if your choice is unavailable it tells you and lets you pick. Interface language is separate and unaffected.</p>
        <div className="flex gap-2">
          <button className={chip(audio === "dub")} onClick={() => { writeAudio("dub"); setAudio("dub") }}>English DUB</button>
          <button className={chip(audio === "sub")} onClick={() => { writeAudio("sub"); setAudio("sub") }}>Japanese SUB</button>
        </div>
        <p className="text-xs text-[--muted]">Subtitles are chosen in the player per episode (English tracks are listed first). Hindi DUB is offered only when a release is found for that episode.</p>
      </section>

      <section className="border border-[--border] rounded-xl p-4 space-y-3" aria-label="Anime extension repositories">
        <h2 className="text-base font-semibold">Anime extension repositories</h2>
        <p className="text-sm text-[--muted]">Add a trusted catalog of authorized anime manifests. Repositories are read only on request; no executable Android or JavaScript packages are installed. An installed package is not evidence of playable content.</p>
        <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={repoConsent} onChange={e=>setRepoConsent(e.target.checked)}/> I trust this repository and have permission to use its media.</label>
        <div className="flex flex-wrap gap-2"><input type="url" aria-label="Repository URL" placeholder="HTTPS repository index URL" value={repoUrl} onChange={e=>setRepoUrl(e.target.value)} className="border border-[--border] rounded-lg p-2 flex-1 min-w-[12rem] bg-[--paper]"/><Button disabled={!repoConsent||repoBusy||!repoUrl.trim()} onClick={()=>void repoAction(async()=>{await refreshRepository(repoUrl);setRepoUrl("")},"Repository added")}>Add repository</Button></div>
        {repos.map(repo=><div key={repo.url} className="border border-[--border] rounded-lg p-3 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><h3 className="font-semibold">{repo.name}</h3><p className="text-xs text-[--muted] break-all">{repo.url}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" intent="gray-outline" disabled={!repoConsent||repoBusy} onClick={()=>void repoAction(()=>refreshRepository(repo.url),"Repository refreshed")}>Check updates</Button><Button size="sm" intent="gray-outline" disabled={repoBusy} onClick={()=>{removeRepository(repo.url);setRepos(repositories());setMessage("Repository removed. Installed media sources remain until uninstalled.")}}>Remove</Button></div></div>
          {repo.packages.length===0&&<p className="text-xs text-[--muted]">No anime packages published.</p>}
          {repo.packages.filter(p=>!query||p.name.toLowerCase().includes(query.toLowerCase())).map(p=>{const state=packageState(repo,p);return <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[--border] pt-2"><span>{p.name} <span className="text-xs text-[--muted]">v{p.version} · {state==="update"?"Update available":state==="installed"?"Installed, playback unverified":state==="older"?"Older version":"Available to install"}</span></span><Button size="sm" disabled={!repoConsent||repoBusy||state==="installed"||state==="older"} onClick={()=>void repoAction(()=>installRepositoryPackage(repo.url,p.id),state==="update"?"Source updated":"Source installed")}>{state==="update"?"Update":state==="installed"?"Installed":state==="older"?"Unavailable":"Install"}</Button></div>})}
        </div>)}
      </section>

      <section className="border border-[--border] rounded-xl p-4 space-y-3" aria-label="Import manifest">
        <h2 className="text-base font-semibold">Import a source manifest ({sources.length} installed)</h2>
        <p className="text-sm text-[--muted]">A declarative JSON file of HTTPS MP4/HLS episodes or manga chapter images for media you are licensed to use. It is validated, stored only in this browser, and never executed.</p>
        <label className="flex gap-2 items-start text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={e => setConsent(e.target.checked)} /> I have permission to access this media and understand that playing it connects to the media host.</label>
        <input type="file" accept=".json,application/json" disabled={!consent} onChange={e => { void importFile(e.target.files?.[0]); e.target.value = "" }} />
        <div className="flex flex-wrap gap-2">
          <input type="url" className="border border-[--border] rounded-lg p-2 flex-1 min-w-[12rem] bg-[--paper]" value={url} onChange={e => setUrl(e.target.value)} placeholder="HTTPS manifest URL (host must allow CORS)" />
          <Button disabled={!consent || !url.trim() || busy} onClick={() => void importUrl()}>Install from URL</Button>
        </div>
        {sources.map(s => <div key={s.id} className="flex flex-wrap justify-between items-center gap-2 border border-[--border] rounded-lg p-3">
          <div className="min-w-0"><h3 className="text-base font-medium truncate">{s.name} <span className="text-xs border rounded-full px-2 py-0.5 ml-1 " >Unverified · your media</span></h3><p className="text-sm text-[--muted]">{s.episodes.length} episode records · {s.chapters?.length || 0} chapters</p></div>
          <div className="flex gap-2"><Button size="sm" intent="gray-outline" onClick={() => { setSourceEnabled(s.id, s.enabled === false); refreshSources() }}>{s.enabled === false ? "Enable" : "Disable"}</Button><Button size="sm" intent="gray-outline" onClick={() => { removeSource(s.id); refreshSources() }}>Uninstall</Button></div>
        </div>)}
        <details className="text-sm"><summary>Manifest format</summary><pre className="overflow-auto p-3 rounded bg-[--subtle]">{JSON.stringify({ version: 2, id: "my-licensed-source", name: "My licensed media", episodes: [{ mediaId: 1, episode: 1, audio: "dub", url: "https://your-authorized-host.example/episode.mp4", format: "mp4" }], chapters: [{ mediaId: 2, chapter: 1, pages: ["https://your-authorized-host.example/page-1.jpg"] }] }, null, 2)}</pre></details>
      </section>
    </PageWrapper>
  </>
}
