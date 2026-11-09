/* ---------- splash / loading screen ---------- */
(function splash() {
  const el = document.getElementById("splash"); if (!el) return;
  const brand = document.querySelector("#brandLogo .logoimg");
  let seen = null; try { seen = sessionStorage.getItem("melman.splash"); } catch (e) { /* private mode */ }
  const force = /[?&]splash\b/.test(location.search);
  if ((seen && !force) || matchMedia("(prefers-reduced-motion: reduce)").matches) { el.remove(); return; }   // once per browser session
  document.body.classList.add("splashing"); brand.classList.add("is-hidden");
  const t0 = performance.now(), MIN = 2600; let left = false;

  function fly() {
    el.classList.add("sp-leave");
    const L = document.getElementById("spLogo"), sr = L.getBoundingClientRect(), hr = brand.getBoundingClientRect();
    const s = hr.width / sr.width, dx = hr.left + hr.width / 2 - (sr.left + sr.width / 2), dy = hr.top + hr.height / 2 - (sr.top + sr.height / 2);
    L.style.transition = "transform .95s cubic-bezier(.65,0,.2,1)";
    L.style.transform = `translate(${dx}px,${dy}px) scale(${s})`;
    let ended = false;
    const end = () => { if (ended) return; ended = true; brand.classList.remove("is-hidden"); el.remove(); document.body.classList.remove("splashing"); };
    L.addEventListener("transitionend", (e) => { if (e.target === L && e.propertyName === "transform") end(); });
    setTimeout(end, 1400);
  }
  function leave(msg, delay) {
    if (left) return; left = true;
    try { sessionStorage.setItem("melman.splash", "1"); } catch (e) { /* ignore */ }
    setTimeout(() => {                       // let the bar be seen filling, then finish it
      if (msg) document.getElementById("spMsg").textContent = msg;
      const bar = document.getElementById("spBar");
      const w = getComputedStyle(bar).width; bar.style.animation = "none"; bar.style.width = w; bar.offsetWidth;
      bar.style.transition = "width .35s ease"; bar.style.width = "100%";
      setTimeout(fly, 650);
    }, delay);
  }
  document.addEventListener("melman:ready", () => {
    const E = window.MelmanApp && window.MelmanApp.engine;
    leave(E ? `${E.docs.length} PDFs · ${E.pages.length.toLocaleString()} pages ready` : "Ready", Math.max(0, MIN - (performance.now() - t0)));
  }, { once: true });
  document.addEventListener("melman:error", () => leave("Couldn't load the library", 300), { once: true });
  setTimeout(() => leave("", 0), 9000);   // safety net
})();

(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  let engine = null;
  let docFilter = null;      // doc index or null
  let lastTerms = [];
  let current = null;        // {d, n}
  let showText = false;
  let viewPos = 1e9;      // text position of the match that opened the viewer
  let viewTerms = null;     // words to highlight on the page being viewed

  // ---------- load ----------
  fetch("data/index.json")
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      if (!data.pages.length) { $("status").textContent = "No PDFs indexed yet. Add files to /pdfs and run build_index.py."; document.dispatchEvent(new CustomEvent("melman:error")); return; }
      engine = new MelmanSearch.Engine(data);
      engine.docs.forEach((d, i) => {
        const o = document.createElement("option"); o.value = i; o.textContent = d.title; $("docFilter").appendChild(o);
      });
      renderBrowse(); renderSaved();
      document.dispatchEvent(new CustomEvent("melman:ready"));
      const q = decodeURIComponent((location.hash.match(/[#&]q=([^&]*)/) || [])[1] || "");
      if (q) { $("q").value = q; runSearch(); } else showHome();
    })
    .catch(() => { document.dispatchEvent(new CustomEvent("melman:error")); $("status").textContent = "Couldn't load data/index.json. Run build_index.py, and open the site through a web server (not file://)."; });

  // ---------- search ----------
  let timer;
  $("q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(runSearch, 120); });
  $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") { remember($("q").value); } });
  $("docFilter").addEventListener("change", () => { docFilter = $("docFilter").value === "" ? null : +$("docFilter").value; runSearch(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== $("q") && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); $("q").focus(); $("q").select(); }
    if (e.key === "Escape" && document.activeElement === $("q")) { $("q").value = ""; runSearch(); }
  });

  function showHome() {
    $("status").textContent = "";
    $("chips").innerHTML = ""; $("sections").innerHTML = "";
    const recent = store.get("melman.recent", []);
    $("results").innerHTML =
      '<p class="hint">Type a topic (<i>"hyponatremia"</i>, <i>"DKA"</i>), or paste an entire QBank question stem and the best-matching pages come up. ' +
      'Abbreviations work both ways.</p>' +
      (recent.length ? '<div class="recent-title">Recent searches</div><div class="chips">' +
        recent.map((r, i) => `<button class="chip" data-r="${i}">${esc(r.length > 50 ? r.slice(0, 50) + "…" : r)}</button>`).join("") + "</div>" : "");
    $("results").querySelectorAll("[data-r]").forEach((b) => b.addEventListener("click", () => {
      $("q").value = recent[+b.dataset.r]; runSearch();
    }));
  }

  function log(type, data) {
    const ev = store.get("melman.events", []);
    ev.push({ t: Date.now(), type, ...data });
    store.set("melman.events", ev.slice(-5000));
  }

  function remember(q) {
    q = q.trim(); if (q.length < 2) return;
    if (q.split(/\s+/).length <= 6) log("search", { q: q.toLowerCase() });
    const r = [q, ...store.get("melman.recent", []).filter((x) => x !== q)].slice(0, 12);
    store.set("melman.recent", r);
  }

  function runSearch() {
    if (!engine) return;
    showTab("search");
    const q = $("q").value.trim();
    history.replaceState(null, "", q ? "#q=" + encodeURIComponent(q) : location.pathname);
    if (!q) { showHome(); return; }
    const t0 = performance.now();
    const res = engine.search(q, { docFilter });
    lastTerms = res.re || res.terms;
    const ms = Math.round(performance.now() - t0);
    // per-PDF chips
    const chips = $("chips"); chips.innerHTML = "";
    if (docFilter == null) {
      Object.entries(res.counts).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([d, c]) => {
        const b = document.createElement("button"); b.className = "chip";
        b.innerHTML = esc(engine.docs[d].title) + `<small>${c}</small>`;
        b.onclick = () => { docFilter = +d; $("docFilter").value = d; runSearch(); };
        chips.appendChild(b);
      });
    } else {
      const b = document.createElement("button"); b.className = "chip on"; b.textContent = engine.docs[docFilter].title + "  ✕";
      b.onclick = () => { docFilter = null; $("docFilter").value = ""; runSearch(); };
      chips.appendChild(b);
    }

    // matching section headings
    $("sections").innerHTML = res.sections.length ? "<h4>Matching sections</h4>" : "";
    res.sections.forEach((s) => {
      const b = document.createElement("button"); b.className = "sec";
      b.innerHTML = `${esc(s.title)} <small>· ${esc(engine.docs[s.d].title)} p.${s.page}</small>`;
      b.onclick = () => openPage(s.d, s.page, s.pos + 1, res.re || res.terms);
      $("sections").appendChild(b);
    });

    // results
    const hl = engine.toRegex(res.re || res.terms);
    const saved = store.get("melman.saved", []);
    const frag = document.createDocumentFragment();
    // Melman repeats a lot of text across the Medicine / FM / Surgery / Peds PDFs.
    // Collapse identical passages into one card with "also in" links.
    const cards = [], seen = new Map();
    res.hits.forEach((h) => {
      const snip = engine.snippet(h.id, res.re || res.terms);
      const key = snip.text.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 90);
      const section = engine.sectionFor(engine.pages[h.id], snip.pos);
      if (key.length > 40 && seen.has(key)) { seen.get(key).alts.push({ h, snip }); return; }
      const c = { h, snip, section, alts: [] };
      cards.push(c); if (key.length > 40) seen.set(key, c);
    });
    $("status").textContent = cards.length
      ? `${cards.length} results${res.hits.length > cards.length ? ` (${res.hits.length - cards.length} duplicates merged)` : ""} · ${ms} ms` + (res.questionMode ? " · question mode (filler words ignored)" : "") + (res.phraseMode ? " · exact phrase" : "") + (res.phraseFallback ? " · phrase not found together, showing pages with the separate words" : "")
      : "No matches. Try fewer or simpler words, or the abbreviation.";
    cards.forEach(({ h, snip, section, alts }) => {
      const sn = snip.text;
      const el = document.createElement("div"); el.className = "card";
      el.addEventListener("mouseenter", () => warm(h.d), { once: true });
      const isSaved = saved.some((s) => s.d === engine.docs[h.d].file && s.n === h.n);
      el.innerHTML =
        `<div class="meta"><span><b>${esc(engine.docs[h.d].title)}</b> · p.${h.n}</span>` +
        `<span><button class="missbtn" title="Log a missed question about this">✗ Missed</button><button class="star ${isSaved ? "on" : ""}" title="Save">${isSaved ? "★" : "☆"}</button></span></div>` +
        (section ? `<div class="sec-name">${esc(section)}</div>` : "") +
        `<div class="snip">${hl ? esc(sn).replace(hl, "<mark>$&</mark>") : esc(sn)}</div>` +
        (alts.length ? `<div class="alts">Also in: ${alts.map((a, i) => `<a href="#" data-i="${i}">${esc(engine.docs[a.h.d].title.replace(/^HY /, ""))} p.${a.h.n}</a>`).join(" · ")}</div>` : "");
      el.addEventListener("click", (e) => {
        if (e.target.classList.contains("star")) { toggleSave(h.d, h.n, q); runSearch(); return; }
        if (e.target.classList.contains("missbtn")) { window.MelmanApp.logMiss({ topic: q.length > 60 ? "" : q, pages: [{ d: engine.docs[h.d].file, n: h.n, pos: snip.pos }] }); return; }
        remember(q);
        if (e.target.tagName === "A") { e.preventDefault(); const a = alts[+e.target.dataset.i]; openPage(a.h.d, a.h.n, a.snip.pos, res.re || res.terms); return; }
        openPage(h.d, h.n, snip.pos, res.re || res.terms);
      });
      frag.appendChild(el);
    });
    $("results").innerHTML = ""; $("results").appendChild(frag);
  }

  // ---------- viewer ----------
  function openPage(d, n, pos, terms) {
    viewPos = pos == null ? 1e9 : pos;
    viewTerms = terms || ($("q").value.trim() ? engine.highlightRegexQ($("q").value) : null);
    const token = ++renderTok;
    n = Math.max(1, Math.min(n, engine.docs[d].pages));
    const changed = !current || current.d !== d || current.n !== n || $("viewer").hidden;
    current = { d, n };
    const doc = engine.docs[d];
    $("viewer").hidden = false;
    $("vDoc").textContent = doc.title;
    const pid = engine.pages.findIndex((p) => p.d === d && p.n === n);
    $("vSec").textContent = pid > -1 ? (engine.sectionFor(engine.pages[pid], viewPos) || "") : "";
    $("vPage").value = n; $("vPage").max = doc.pages;
    const url = encodeURI(doc.file);
    $("vOpen").href = url + "#page=" + n;
    const body = $("vBody"); body.innerHTML = "";
    if (showText && pid > -1) {
      const div = document.createElement("div"); div.className = "vtext";
      const hl = engine.toRegex(viewTerms);
      const t = esc(engine.pages[pid].text || "(no extractable text on this page)");
      div.innerHTML = hl ? t.replace(hl, "<mark>$&</mark>") : t;
      body.appendChild(div);
      setBar2(false);
    } else {
      setBar2(true);
      renderPdf(d, n, token).catch((err) => {
        if (token !== renderTok) return;
        console.warn("pdf.js unavailable, using the browser viewer:", err);
        setBar2(false);
        const f = document.createElement("iframe");   // fallback: browser's own viewer (no highlighting)
        f.src = url + "#page=" + n + "&zoom=page-width"; f.title = doc.title;
        body.innerHTML = ""; body.appendChild(f);
      });
    }
    if (changed) log("open", { d: doc.file, n, sec: $("vSec").textContent });
    $("vText").style.background = showText ? "var(--accent-soft)" : "";
    const isSaved = store.get("melman.saved", []).some((s) => s.d === doc.file && s.n === n);
    $("vSave").textContent = isSaved ? "★ Saved" : "☆ Save";
    document.querySelectorAll(".card").forEach((c) => c.classList.remove("active"));
  }

  // ---------- in-page highlighting viewer (pdf.js) ----------
  const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/";
  let pdfjsP = null, renderTok = 0, zoom = 1, marks = [], markIdx = -1;
  const docCache = new Map();
  const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2, 3];

  function loadPdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsP) pdfjsP = new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = PDFJS + "pdf.min.js";
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; res(window.pdfjsLib); };
      s.onerror = () => { pdfjsP = null; rej(new Error("could not load pdf.js")); };
      document.head.appendChild(s);
    });
    return pdfjsP;
  }
  function getPdf(file) {
    if (!docCache.has(file)) {
      docCache.set(file, loadPdfjs().then((lib) => lib.getDocument({ url: encodeURI(file), disableAutoFetch: true, rangeChunkSize: 262144 }).promise).catch((e) => { docCache.delete(file); throw e; }));
      if (docCache.size > 3) { const k = docCache.keys().next().value; docCache.get(k).then((p) => p.destroy()).catch(() => {}); docCache.delete(k); }
    }
    return docCache.get(file);
  }
  // warm-up: fetch the viewer library when the browser is idle, and open the top result's PDF in the background
  (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => loadPdfjs().catch(() => {}));
  function warm(d) { try { if (d != null) getPdf(engine.docs[d].file).catch(() => {}); } catch (e) {} }
  function setBar2(on) { $("vBar2").hidden = !on; }

  async function renderPdf(d, n, token) {
    const doc = engine.docs[d], body = $("vBody");
    const pid0 = engine.pages.findIndex((p) => p.d === d && p.n === n);
    if (pid0 > -1) {   // show the extracted text immediately; the real page replaces it when ready
      const hl0 = engine.toRegex(viewTerms), t0 = esc(engine.pages[pid0].text || "");
      body.innerHTML = '<div class="vload">Loading PDF page…</div><div class="vtext vtmp">' + (hl0 ? t0.replace(hl0, "<mark>$&</mark>") : t0) + "</div>";
    } else body.innerHTML = '<div class="vload">Loading page…</div>';
    const lib = await loadPdfjs(), pdf = await getPdf(doc.file);
    if (token !== renderTok) return;
    const page = await pdf.getPage(n);
    if (token !== renderTok) return;
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: (Math.max(260, body.clientWidth - 24) / base.width) * zoom });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scroller = document.createElement("div"); scroller.className = "pdfscroll";
    const wrap = document.createElement("div"); wrap.className = "pdfpage"; wrap.style.width = vp.width + "px"; wrap.style.height = vp.height + "px";
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = vp.width + "px"; canvas.style.height = vp.height + "px";
    const tl = document.createElement("div"); tl.className = "textLayer";
    wrap.append(canvas, tl); scroller.appendChild(wrap);
    body.innerHTML = ""; body.appendChild(scroller);
    const textDivs = [];
    await Promise.all([
      page.render({ canvasContext: canvas.getContext("2d"), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise,
      lib.renderTextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp, textDivs }).promise,
    ]);
    if (token !== renderTok) return;
    highlightPage(textDivs, tl, scroller, d, n);
  }

  function highlightPage(textDivs, tl, scroller, d, n) {
    marks = []; markIdx = -1;
    const re = viewTerms ? engine.toRegex(viewTerms) : null;
    let total = 0; const starts = textDivs.map((el) => { const s = total; total += el.textContent.length; return s; });
    if (re) {
      // Match on the whole page text (divs joined by a space) so phrases that wrap across lines are found too.
      const texts = textDivs.map((el) => el.textContent);
      const offs = []; let full = "";
      texts.forEach((t) => { offs.push(full.length); full += t + " "; });
      const ranges = texts.map(() => []);
      let m; re.lastIndex = 0;
      while ((m = re.exec(full))) {
        if (!m[0]) { re.lastIndex++; continue; }
        const a0 = m.index, a1 = m.index + m[0].length;
        texts.forEach((t, k) => {
          const s = Math.max(a0, offs[k]), e = Math.min(a1, offs[k] + t.length);
          if (e > s) ranges[k].push([s - offs[k], e - offs[k]]);
        });
      }
      textDivs.forEach((el, k) => {
        if (!ranges[k].length) return;
        const t = texts[k]; let out = "", last = 0;
        ranges[k].forEach(([s, e]) => { out += esc(t.slice(last, s)) + '<mark class="hl">' + esc(t.slice(s, e)) + "</mark>"; last = e; });
        el.innerHTML = out + esc(t.slice(last));
      });
    }
    marks = [...tl.querySelectorAll("mark.hl")];
    marks.forEach((m) => { const div = m.closest("span"); m._rel = (starts[textDivs.indexOf(div)] || 0) / Math.max(1, total); });
    const hits = $("vHits");
    if (!viewTerms) hits.textContent = "";
    else if (!total) hits.textContent = "No searchable text on this page";
    else hits.textContent = marks.length ? `${marks.length} match${marks.length === 1 ? "" : "es"} on this page` : "No matches on this page";
    $("vHPrev").disabled = $("vHNext").disabled = marks.length < 2;
    $("vZoom").textContent = zoom === 1 ? "Fit" : Math.round(zoom * 100) + "%";
    if (marks.length) {   // start at the match closest to the snippet you clicked
      let best = 0;
      if (viewPos < 1e9) {
        const pid = engine.pageId(d, n), len = pid > -1 ? engine.pages[pid].text.length : 0;
        const target = len ? viewPos / len : 0; let bd = 9;
        marks.forEach((m, i) => { const dd = Math.abs(m._rel - target); if (dd < bd) { bd = dd; best = i; } });
      }
      gotoMark(best);
    }
  }
  function gotoMark(i) {
    if (!marks.length) return;
    markIdx = (i + marks.length) % marks.length;
    marks.forEach((m, k) => m.classList.toggle("cur", k === markIdx));
    marks[markIdx].scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    const h = $("vHits"); h.textContent = `${markIdx + 1} of ${marks.length} on this page`;
  }
  $("vHPrev").onclick = () => gotoMark(markIdx - 1);
  $("vHNext").onclick = () => gotoMark(markIdx + 1);
  function setZoom(dir) {
    let i = ZOOMS.indexOf(zoom); if (i < 0) i = 2;
    const nz = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + dir))];
    if (nz !== zoom && current) { zoom = nz; openPage(current.d, current.n, viewPos, viewTerms); }
  }
  $("vZoomIn").onclick = () => setZoom(1); $("vZoomOut").onclick = () => setZoom(-1);
  let rsz; window.addEventListener("resize", () => { clearTimeout(rsz); rsz = setTimeout(() => { if (current && !$("viewer").hidden && !showText && $("vBody").querySelector(".pdfpage")) openPage(current.d, current.n, viewPos, viewTerms); }, 250); });

  $("vPrev").onclick = () => current && openPage(current.d, current.n - 1, null, viewTerms);
  $("vNext").onclick = () => current && openPage(current.d, current.n + 1, null, viewTerms);
  $("vPage").onchange = () => current && openPage(current.d, +$("vPage").value || 1, null, viewTerms);
  $("vText").onclick = () => { showText = !showText; current && openPage(current.d, current.n, viewPos, viewTerms); };
  $("vMiss").onclick = () => current && window.MelmanApp.logMiss({ topic: $("q").value.trim().length > 60 ? "" : $("q").value.trim(), pages: [{ d: engine.docs[current.d].file, n: current.n, pos: viewPos < 1e9 ? viewPos : 0 }] });
  $("vClose").onclick = () => { $("viewer").hidden = true; };
  $("vSave").onclick = () => { if (current) { toggleSave(current.d, current.n, $("q").value); openPage(current.d, current.n, viewPos, viewTerms); runSearch(); } };

  // ---------- saved ----------
  function toggleSave(d, n, q) {
    const file = engine.docs[d].file;
    let s = store.get("melman.saved", []);
    if (s.some((x) => x.d === file && x.n === n)) s = s.filter((x) => !(x.d === file && x.n === n));
    else s.unshift({ d: file, n, q: (q || "").slice(0, 120), note: "", ts: Date.now() });
    store.set("melman.saved", s); renderSaved();
  }
  function renderSaved() {
    const s = store.get("melman.saved", []);
    $("savedCount").textContent = s.length ? "(" + s.length + ")" : "";
    const box = $("tab-saved");
    if (!s.length) { box.innerHTML = '<p class="hint">Star a page to keep it here. Good for the concepts you keep missing: add a note to yourself and come back before your exam.</p>'; return; }
    box.innerHTML = "";
    s.forEach((item) => {
      const di = engine.docs.findIndex((d) => d.file === item.d);
      if (di < 0) return;
      const el = document.createElement("div"); el.className = "card";
      el.innerHTML = `<div class="meta"><span><b>${esc(engine.docs[di].title)}</b> · p.${item.n}</span><button class="star on" title="Remove">★</button></div>` +
        (item.q ? `<div class="hint">from search: ${esc(item.q)}</div>` : "") +
        `<textarea class="saved-note" rows="2" placeholder="Note to self…">${esc(item.note || "")}</textarea>`;
      el.addEventListener("click", (e) => {
        if (e.target.classList.contains("star")) { toggleSave(di, item.n); return; }
        if (e.target.tagName === "TEXTAREA") return;
        openPage(di, item.n);
      });
      el.querySelector("textarea").addEventListener("input", (e) => {
        const all = store.get("melman.saved", []); const t = all.find((x) => x.d === item.d && x.n === item.n);
        if (t) { t.note = e.target.value; store.set("melman.saved", all); }
      });
      box.appendChild(el);
    });
  }

  // ---------- browse ----------
  function renderBrowse() {
    const box = $("tab-browse"); box.innerHTML = "";
    engine.docs.forEach((doc, d) => {
      const det = document.createElement("details"); det.className = "doc";
      det.innerHTML = `<summary><b>${esc(doc.title)}</b><small>${doc.pages} pages</small></summary><div class="toc"></div>`;
      const toc = det.querySelector(".toc");
      const open = document.createElement("button"); open.innerHTML = "<span>Open from page 1</span><span>→</span>"; open.onclick = () => openPage(d, 1);
      toc.appendChild(open);
      doc.toc.forEach(([lvl, title, page, off]) => {
        const b = document.createElement("button"); b.style.paddingLeft = 6 + (lvl - 1) * 14 + "px";
        b.innerHTML = `<span>${esc(title)}</span><span>${page}</span>`; b.onclick = () => openPage(d, page, off + 1); toc.appendChild(b);
      });
      box.appendChild(det);
    });
  }

  // ---------- API for study.js ----------
  window.MelmanApp = {
    get engine() { return engine; },
    $, esc, store, log, showTab,
    openPage: (d, n, pos) => openPage(d, n, pos),
    search: (q) => { $("q").value = q; runSearch(); },
    logMiss: () => {},          // replaced by study.js
    onReady: (fn) => (engine ? fn() : document.addEventListener("melman:ready", fn, { once: true })),
  };

  // ---------- tabs ----------
  function showTab(name) {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    ["search", "browse", "saved", "missed", "compare", "stats"].forEach((t) => ($("tab-" + t).hidden = t !== name));
    document.body.dataset.tab = name;
    document.dispatchEvent(new CustomEvent("melman:tab", { detail: name }));
  }
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
})();
