// Private on-device CBZ manga reader. Files are never uploaded or cached remotely.
(() => {
  "use strict";
  let pages = [];
  let zip = null;
  let currentPage = 0;
  let currentUrl = null;
  let storageKey = "";
  let title = "";
  const $ = q => document.querySelector(q);
  const natural = new Intl.Collator(undefined, { numeric:true, sensitivity:"base" });
  function cleanup() {
    if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
    const root = $("#cbz-reader");
    if (root) root.remove();
    pages = []; zip = null;
    document.body.classList.remove("cbz-active");
  }
  async function display(page) {
    if (!zip || !pages.length) return;
    const index = Math.min(Math.max(0,page),pages.length-1);
    currentPage = index;
    const image = $("#cbz-current-page");
    if (!image) return;
    image.removeAttribute("src");
    image.alt = "Loading page " + (index+1);
    const before = currentUrl;
    const file = zip.file(pages[index]);
    const binary = await file.async("blob");
    if (currentPage !== index) return;
    currentUrl = URL.createObjectURL(binary);
    image.src = currentUrl;
    image.alt = title + " — Page " + (index+1);
    if (before) URL.revokeObjectURL(before);
    const counter = $("#cbz-counter");
    if (counter) counter.textContent = (index+1) + " / " + pages.length;
    const prev = $("#cbz-prev"), next = $("#cbz-next");
    if (prev) prev.disabled = index <= 0;
    if (next) next.disabled = index >= pages.length-1;
    try { localStorage.setItem(storageKey, String(index)); } catch (_) {}
  }
  async function open(file) {
    if (!file) return;
    if (file.size > 500_000_000) throw new Error("File exceeds the 500 MB reader limit.");
    if (!window.JSZip) throw new Error("CBZ reader library could not load. Check your connection.");
    cleanup();
    title = file.name;
    zip = await window.JSZip.loadAsync(file);
    pages = Object.keys(zip.files).filter(name =>
      !zip.files[name].dir && /\.(?:jpg|jpeg|png|webp|gif|avif)$/i.test(name) &&
      !name.startsWith("__MACOSX/")
    ).sort(natural.compare);
    if (!pages.length) { cleanup(); throw new Error("No readable image pages in this CBZ file."); }
    if (pages.length > 2000) { cleanup(); throw new Error("Too many pages in one CBZ archive."); }
    storageKey = "anidash.cbz.resume." + file.name + "." + file.size;
    const root = document.createElement("section");
    root.id = "cbz-reader";
    root.className = "cbz-reader";
    root.setAttribute("role","dialog");
    root.setAttribute("aria-modal","true");
    root.setAttribute("aria-label","Manga reader");
    root.innerHTML = '<div class="cbz-toolbar"><button class="cbz-close" id="cbz-close" aria-label="Close reader">×</button>' +
      '<strong id="cbz-title"></strong><span id="cbz-counter"></span></div>' +
      '<div class="cbz-stage"><img id="cbz-current-page" alt="Manga page"></div>' +
      '<div class="cbz-controls"><button class="btn btn-secondary" id="cbz-prev">Previous</button>' +
      '<button class="btn btn-primary" id="cbz-next">Next page</button></div>';
    document.body.appendChild(root);
    document.body.classList.add("cbz-active");
    $("#cbz-title").textContent = title;
    $("#cbz-close").addEventListener("click", cleanup);
    $("#cbz-prev").addEventListener("click", () => display(currentPage-1));
    $("#cbz-next").addEventListener("click", () => display(currentPage+1));
    let saved = 0;
    try { saved = Number(localStorage.getItem(storageKey) || 0); } catch (_) {}
    await display(saved);
  }
  document.addEventListener("keydown", event => {
    if (!$("#cbz-reader")) return;
    if (event.key === "Escape") cleanup();
    else if (event.key === "ArrowRight") { event.preventDefault(); display(currentPage+1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); display(currentPage-1); }
  });
  window.AniDashCBZ = { open, close:cleanup };
})();