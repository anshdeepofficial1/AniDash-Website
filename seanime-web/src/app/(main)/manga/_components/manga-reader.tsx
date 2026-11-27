import React from "react"

export type ReaderChapter = { sourceId: string; sourceName: string; chapter: number; title?: string; pages: string[] }
type Progress = { mediaId: number; title: string; sourceId: string; chapter: number; page: number; at: number }
const KEY = "anidash.manga.progress.v1"

export function readProgress(): Progress[] {
  try { const v: any = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? (v.filter((x: any) => x && typeof x.mediaId === "number") as Progress[]) : [] } catch { return [] }
}
export function saveProgress(p: Progress) {
  try { localStorage.setItem(KEY, JSON.stringify([p, ...readProgress().filter(x => x.mediaId !== p.mediaId)].slice(0, 40))) } catch { /* ignore */ }
}
export function clearProgress() { try { localStorage.removeItem(KEY) } catch { /* ignore */ } }

/** Page image with bounded retry (cache-busting only after a failure) and a manual retry control. */
function Page({ src, index, eager }: { src: string; index: number; eager: boolean }) {
  const [tries, setTries] = React.useState(0)
  const [failed, setFailed] = React.useState(false)
  if (failed) return <div className="border rounded-lg p-6 text-center text-sm" role="alert">Page {index + 1} failed to load. <button className="underline" onClick={() => { setFailed(false); setTries(t => t + 1) }}>Retry</button></div>
  return <img src={tries ? src + (src.includes("?") ? "&" : "?") + "r=" + tries : src} referrerPolicy="no-referrer" loading={eager ? "eager" : "lazy"} alt={"Page " + (index + 1)} className="w-full h-auto object-contain mx-auto"
    onError={() => { if (tries < 2) setTimeout(() => setTries(t => t + 1), 700 * (tries + 1)); else setFailed(true) }} />
}

export function MangaReader({ mediaId, title, chapters, current, onSelect, onClose }: { mediaId: number; title: string; chapters: ReaderChapter[]; current: ReaderChapter; onSelect: (c: ReaderChapter) => void; onClose: () => void }) {
  const [mode, setMode] = React.useState<"vertical" | "rtl">(() => { try { return localStorage.getItem("anidash.manga.mode") === "rtl" ? "rtl" : "vertical" } catch { return "vertical" } })
  const [page, setPage] = React.useState(() => { const p = readProgress().find(x => x.mediaId === mediaId && x.sourceId === current.sourceId && x.chapter === current.chapter); return p ? Math.min(p.page, Math.max(0, current.pages.length - 1)) : 0 })
  const index = chapters.findIndex(c => c.sourceId === current.sourceId && c.chapter === current.chapter)
  const prev = chapters[index - 1], next = chapters[index + 1]
  const setReadMode = (m: "vertical" | "rtl") => { setMode(m); try { localStorage.setItem("anidash.manga.mode", m) } catch { /* ignore */ } }
  React.useEffect(() => { saveProgress({ mediaId, title, sourceId: current.sourceId, chapter: current.chapter, page, at: Date.now() }) }, [mediaId, title, current.sourceId, current.chapter, page])
  React.useEffect(() => {
    if (mode !== "rtl") return
    const f = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setPage(p => Math.min(p + 1, current.pages.length - 1))
      if (e.key === "ArrowRight") setPage(p => Math.max(p - 1, 0))
    }
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f)
  }, [mode, current.pages.length])
  const btn = "border rounded-lg px-3 py-2 text-sm disabled:opacity-40"
  const go = (c?: ReaderChapter) => { if (c) { setPage(0); onSelect(c); window.scrollTo({ top: 0 }) } }
  return <section className="rounded-xl border p-4 space-y-4" aria-label="Manga reader">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold min-w-0 truncate">{title} · {current.title || "Chapter " + current.chapter} · {current.sourceName}</h2>
      <div className="flex flex-wrap gap-2">
        <button className={btn} aria-pressed={mode === "vertical"} onClick={() => setReadMode("vertical")}>Vertical</button>
        <button className={btn} aria-pressed={mode === "rtl"} onClick={() => setReadMode("rtl")}>Right-to-left</button>
        <button className={btn} onClick={onClose}>Close reader</button>
      </div>
    </div>
    <div className="mx-auto max-w-3xl space-y-2">
      {mode === "vertical"
        ? current.pages.map((url, i) => <Page key={current.sourceId + current.chapter + i + url} src={url} index={i} eager={i === 0} />)
        : <>
          <Page key={current.sourceId + current.chapter + page} src={current.pages[page]} index={page} eager />
          <div className="flex justify-between gap-2" dir="rtl">
            <button className={btn} disabled={page >= current.pages.length - 1} onClick={() => setPage(p => p + 1)}>← Next page</button>
            <span className="text-sm self-center">{page + 1} / {current.pages.length}</span>
            <button className={btn} disabled={page <= 0} onClick={() => setPage(p => p - 1)}>Previous page →</button>
          </div>
        </>}
    </div>
    <div className="flex justify-between gap-2">
      <button className={btn} disabled={!prev} onClick={() => go(prev)}>← Previous chapter</button>
      <button className={btn} disabled={!next} onClick={() => go(next)}>Next chapter →</button>
    </div>
  </section>
}
