/* Study features: Missed-question tracker (weak spots + quiz), Compare, Stats.
   All data lives in this browser's localStorage. Use Stats → Export to back it up. */
(function () {
  "use strict";
  const A = window.MelmanApp;
  const { $, esc, store, log } = A;

  const DAY = 864e5;
  const INTERVALS = [1, 3, 7, 14, 30];             // days until next review for box 0..4
  const REASONS = ["Didn't know it", "Mixed up similar concepts", "Misread the question", "Knew it, changed my answer", "Forgot a detail / number"];
  const short = (t) => t.replace(/^HY /, "");
  const keyOf = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const ago = (ts) => { const d = Math.floor((Date.now() - ts) / DAY); return d <= 0 ? "today" : d === 1 ? "yesterday" : d + "d ago"; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const getMissed = () => store.get("melman.missed", []);
  const setMissed = (v) => { store.set("melman.missed", v); updateCount(); };

  function dueItems() { const now = Date.now(); return getMissed().filter((m) => !m.mastered && m.due <= now); }
  function updateCount() { const n = dueItems().length; $("missedCount").textContent = n ? "(" + n + ")" : ""; }

  function score(m) {
    let s = 0; const now = Date.now();
    for (const x of m.misses) s += Math.pow(0.5, (now - x.ts) / (21 * DAY));
    return Math.max(0.1, s + 0.4 * m.wrong - 0.3 * m.right);
  }

  // ---------- helpers around the engine ----------
  const docIndex = (file) => A.engine.docs.findIndex((d) => d.file === file);

  /** The section of the PDF a page reference points at. */
  function sectionOf(ref) {
    const E = A.engine, di = docIndex(ref.d); if (di < 0) return null;
    const pid = E.pageId(di, ref.n); if (pid < 0) return null;
    const i = E.sectionIndexFor(E.pages[pid], ref.pos == null ? 1e9 : ref.pos);
    if (i >= 0) { const b = E.sectionBody(di, i); return { di, i, title: b.title, page: b.page, text: b.text }; }
    return { di, i: -1, title: "", page: ref.n, text: E.pages[pid].text.slice(0, 3000) };
  }

  /** Render flattened Melman text as bullets, with the given terms highlighted. */
  function bullets(text, terms) {
    const hl = terms && terms.length ? A.engine.highlightRegex(terms) : null;
    const parts = text.split(/\s-\s/).map((s) => s.trim()).filter(Boolean);
    const f = (s) => (hl ? esc(s).replace(hl, "<mark>$&</mark>") : esc(s));
    if (parts.length < 2) return `<p>${f(text)}</p>`;
    // The first chunk is usually the heading line.
    return `<p class="lead">${f(parts[0])}</p><ul>${parts.slice(1).map((p) => `<li>${f(p)}</li>`).join("")}</ul>`;
  }

  function toast(msg) {
    let t = $("toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200);
  }

  const pageLabel = (ref) => `${short(A.engine.docs[docIndex(ref.d)]?.title || ref.d)} p.${ref.n}`;
  const pageLinks = (pages) => pages.map((p, i) => `<a href="#" class="plink" data-i="${i}">${esc(pageLabel(p))}</a>`).join(" · ");
  function wireLinks(root, pages) {
    root.querySelectorAll(".plink").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation(); const p = pages[+a.dataset.i]; const di = docIndex(p.d);
      if (di >= 0) A.openPage(di, p.n, p.pos);
    }));
  }

  // ====================================================================
  // 1. LOG-A-MISS DIALOG
  // ====================================================================
  let dlg, ds;
  function buildDialog() {
    dlg = document.createElement("dialog"); dlg.id = "missDlg";
    dlg.innerHTML = `<form method="dialog" class="dform">
      <h3>Log a missed question</h3>
      <label>Topic / concept<input id="mTopic" autocomplete="off" placeholder="e.g. SIADH, or nephritic vs nephrotic"></label>
      <label>Why did you miss it?<select id="mReason">${REASONS.map((r) => `<option>${esc(r)}</option>`).join("")}</select></label>
      <label>Note to self <small>(optional)</small><textarea id="mNote" rows="2" placeholder="What was the trap? What should you have noticed?"></textarea></label>
      <div class="mpt">Melman pages that explain it</div>
      <div id="mPages" class="mpages"></div>
      <div class="dbtns"><button value="cancel" class="plain">Cancel</button><button id="mSave" class="primary" value="save">Save</button></div>
    </form>`;
    document.body.appendChild(dlg);
    let t; $("mTopic").addEventListener("input", () => { clearTimeout(t); t = setTimeout(suggest, 250); });
    $("mSave").addEventListener("click", (e) => { e.preventDefault(); saveMiss(); });
  }
  const refKey = (r) => r.d + "#" + r.n;

  function suggest() {
    const topic = $("mTopic").value.trim();
    ds.sugg = [];
    if (topic.length >= 2) {
      const E = A.engine;
      ds.sugg = E.findSections(topic, 5).items.map((it) => ({ d: E.docs[it.d].file, n: it.page, pos: it.i >= 0 ? E.docs[it.d].toc[it.i][3] : 0 }));
      if (!ds.chosen.size && !ds.autoDone) { ds.sugg.slice(0, 2).forEach((r) => { ds.chosen.set(refKey(r), r); ds.checked.add(refKey(r)); }); ds.autoDone = true; }
    }
    renderPages();
  }
  function renderPages() {
    const box = $("mPages"); const seen = new Set(); const rows = [];
    for (const r of [...ds.chosen.values(), ...ds.sugg]) { if (seen.has(refKey(r))) continue; seen.add(refKey(r)); rows.push(r); }
    box.innerHTML = rows.length ? "" : '<div class="hint">Type the topic above and the best-matching pages appear here.</div>';
    rows.forEach((r) => {
      const s = sectionOf(r); const k = refKey(r);
      const row = document.createElement("label"); row.className = "mrow";
      row.innerHTML = `<input type="checkbox" ${ds.checked.has(k) ? "checked" : ""}><span><b>${esc(pageLabel(r))}</b>${s && s.title ? " · " + esc(s.title) : ""}</span>`;
      row.querySelector("input").addEventListener("change", (e) => { if (e.target.checked) { ds.checked.add(k); ds.chosen.set(k, r); } else ds.checked.delete(k); });
      box.appendChild(row);
    });
  }

  function openDialog(opts = {}) {
    if (!A.engine) return;
    if (!dlg) buildDialog();
    ds = { chosen: new Map(), checked: new Set(), sugg: [], autoDone: false };
    (opts.pages || []).forEach((p) => { ds.chosen.set(refKey(p), p); ds.checked.add(refKey(p)); });
    $("mTopic").value = opts.topic || ""; $("mNote").value = ""; $("mReason").selectedIndex = 0;
    suggest(); dlg.showModal(); $("mTopic").focus();
  }

  function saveMiss() {
    const topic = $("mTopic").value.trim();
    if (!topic) { $("mTopic").focus(); $("mTopic").classList.add("bad"); return; }
    $("mTopic").classList.remove("bad");
    const pages = [...ds.chosen.values()].filter((r) => ds.checked.has(refKey(r)));
    const miss = { ts: Date.now(), reason: $("mReason").value, note: $("mNote").value.trim() };
    const all = getMissed(), k = keyOf(topic);
    let item = all.find((m) => m.key === k && !m.mastered);
    if (item) {
      item.misses.push(miss); item.box = 0; item.due = Date.now();
      for (const p of pages) if (!item.pages.some((x) => refKey(x) === refKey(p))) item.pages.push(p);
    } else {
      item = { id: uid(), topic, key: k, misses: [miss], pages, box: 0, due: Date.now(), right: 0, wrong: 0, mastered: false };
      all.unshift(item);
    }
    setMissed(all);
    log("miss", { topic: k, reason: miss.reason, d: pages[0] ? pages[0].d : null });
    dlg.close(); toast(item.misses.length > 1 ? `Logged again · missed ${item.misses.length}× now` : "Logged ✓");
    if (document.body.dataset.tab === "missed") renderMissed();
  }
  A.logMiss = openDialog;

  // ====================================================================
  // 2. MISSED TAB: weak spots, quiz, mastered
  // ====================================================================
  let mView = "weak", quiz = null;
  const box = () => $("tab-missed");

  function renderMissed() {
    const all = getMissed(), active = all.filter((m) => !m.mastered), mastered = all.filter((m) => m.mastered);
    const due = dueItems();
    const nav = `<div class="subnav">
      <button data-v="weak" class="${mView === "weak" ? "on" : ""}">Weak spots</button>
      <button data-v="quiz" class="${mView === "quiz" ? "on" : ""}">Quiz${due.length ? ` (${due.length} due)` : ""}</button>
      <button data-v="done" class="${mView === "done" ? "on" : ""}">Mastered (${mastered.length})</button>
      <button id="mNew" class="primary">+ Log a miss</button></div>`;
    box().innerHTML = nav + '<div id="mBody"></div>';
    box().querySelectorAll(".subnav [data-v]").forEach((b) => b.addEventListener("click", () => { mView = b.dataset.v; if (mView === "quiz") quiz = null; renderMissed(); }));
    $("mNew").onclick = () => openDialog({});
    if (mView === "weak") weakView(active); else if (mView === "quiz") quizView(active); else doneView(mastered);
  }

  function weakView(active) {
    const body = $("mBody");
    if (!active.length) { body.innerHTML = '<p class="hint">No misses logged yet. When you get a QBank question wrong, hit <b>✗ Missed</b> on a search result (or the viewer) and note why. After a few, this page ranks your weakest topics and shows what keeps going wrong.</p>'; return; }
    const ranked = [...active].sort((a, b) => score(b) - score(a));
    const top = score(ranked[0]);
    // pattern summary
    const rc = {}, dc = {};
    active.forEach((m) => m.misses.forEach((x) => { rc[x.reason] = (rc[x.reason] || 0) + 1; }));
    active.forEach((m) => { const p = m.pages[0]; if (p) { const t = short(A.engine.docs[docIndex(p.d)]?.title || ""); if (t) dc[t] = (dc[t] || 0) + m.misses.length; } });
    const topR = Object.entries(rc).sort((a, b) => b[1] - a[1])[0], topD = Object.entries(dc).sort((a, b) => b[1] - a[1])[0];
    let html = `<div class="pattern">${active.reduce((n, m) => n + m.misses.length, 0)} misses across ${active.length} topics` +
      (topR ? ` · most common reason: <b>${esc(topR[0])}</b> (${topR[1]})` : "") + (topD ? ` · most from <b>${esc(topD[0])}</b>` : "") + "</div>";
    body.innerHTML = html;
    ranked.forEach((m, idx) => {
      const last = m.misses[m.misses.length - 1];
      const rs = {}; m.misses.forEach((x) => { rs[x.reason] = (rs[x.reason] || 0) + 1; });
      const el = document.createElement("div"); el.className = "card weak";
      el.innerHTML = `<div class="meta"><span><b>${idx + 1}. ${esc(m.topic)}</b></span><span>missed ${m.misses.length}× · last ${ago(last.ts)}</span></div>
        <div class="wbar"><i style="width:${Math.round((score(m) / top) * 100)}%"></i></div>
        <div class="reasons">${Object.entries(rs).map(([r, c]) => `<span class="chip">${esc(r)}${c > 1 ? " ×" + c : ""}</span>`).join("")}</div>
        ${last.note ? `<div class="hint">“${esc(last.note)}”</div>` : ""}
        <div class="alts">${m.pages.length ? pageLinks(m.pages) : "No page attached"}</div>
        <div class="acts"><button data-a="review">Review now</button><button data-a="search">Search it</button><button data-a="master">Mastered ✓</button><button data-a="del" class="plain">Delete</button></div>`;
      wireLinks(el, m.pages);
      el.querySelector('[data-a="review"]').onclick = () => { mView = "quiz"; quiz = { queue: [m.id], i: 0, revealed: false, right: 0, shaky: 0 }; renderMissed(); };
      el.querySelector('[data-a="search"]').onclick = () => { A.showTab("search"); A.search(m.topic); };
      el.querySelector('[data-a="master"]').onclick = () => { update(m.id, (x) => { x.mastered = true; }); renderMissed(); };
      el.querySelector('[data-a="del"]').onclick = () => { if (confirm("Delete “" + m.topic + "” and its history?")) { setMissed(getMissed().filter((x) => x.id !== m.id)); renderMissed(); } };
      body.appendChild(el);
    });
  }

  function update(id, fn) { const all = getMissed(); const m = all.find((x) => x.id === id); if (m) { fn(m); setMissed(all); } }

  function doneView(list) {
    const body = $("mBody");
    if (!list.length) { body.innerHTML = '<p class="hint">Topics you mark as mastered land here. If you miss one again, logging it brings it back into your weak spots.</p>'; return; }
    body.innerHTML = "";
    list.forEach((m) => {
      const el = document.createElement("div"); el.className = "card";
      el.innerHTML = `<div class="meta"><span><b>${esc(m.topic)}</b></span><span>missed ${m.misses.length}× · quiz ${m.right}✓ ${m.wrong}✗</span></div><div class="acts"><button data-a="re">Move back to weak spots</button></div>`;
      el.querySelector("button").onclick = () => { update(m.id, (x) => { x.mastered = false; x.box = 0; x.due = Date.now(); }); renderMissed(); };
      body.appendChild(el);
    });
  }

  // ---- quiz (Leitner boxes: 1, 3, 7, 14, 30 days) ----
  function quizView(active) {
    const body = $("mBody");
    if (!quiz) {
      let ids = dueItems().sort((a, b) => score(b) - score(a)).map((m) => m.id);
      if (!ids.length) {
        const next = active.map((m) => m.due).sort((a, b) => a - b)[0];
        body.innerHTML = active.length
          ? `<p class="hint">Nothing due right now.${next ? ` Next review ${next - Date.now() < DAY ? "later today" : "in " + Math.ceil((next - Date.now()) / DAY) + " days"}.` : ""}</p><button id="qAll" class="primary">Review all ${active.length} active topics anyway</button>`
          : '<p class="hint">Log a miss first and it will show up here for review.</p>';
        const b = $("qAll"); if (b) b.onclick = () => { quiz = { queue: [...active].sort((a, c) => score(c) - score(a)).map((m) => m.id), i: 0, revealed: false, right: 0, shaky: 0 }; renderMissed(); };
        return;
      }
      quiz = { queue: ids, i: 0, revealed: false, right: 0, shaky: 0 };
    }
    if (quiz.i >= quiz.queue.length) {
      body.innerHTML = `<div class="card qdone"><h3>Done for now</h3><p>${quiz.right} got it · ${quiz.shaky} still shaky.</p><p class="hint">Shaky topics come back tomorrow; solid ones get spaced further out.</p><button id="qBack" class="primary">Back to weak spots</button></div>`;
      $("qBack").onclick = () => { mView = "weak"; quiz = null; renderMissed(); };
      return;
    }
    const m = getMissed().find((x) => x.id === quiz.queue[quiz.i]);
    if (!m) { quiz.i++; return quizView(active); }
    const last = m.misses[m.misses.length - 1];
    let reveal = "";
    if (quiz.revealed) {
      let sec = m.pages.length ? sectionOf(m.pages[0]) : null;
      if (!sec) { const r = A.engine.findSections(m.topic, 1).items[0]; if (r) sec = { title: r.title, page: r.page, text: r.text, di: r.d }; }
      const terms = A.engine.parse(m.topic).core;
      reveal = sec ? `<div class="reveal"><div class="rhead">${esc(short(A.engine.docs[sec.di].title))} p.${sec.page}${sec.title ? " · " + esc(sec.title) : ""}</div>${bullets(sec.text, terms)}</div>` : '<p class="hint">No page found; search the topic.</p>';
    }
    body.innerHTML = `<div class="qprog">${quiz.i + 1} of ${quiz.queue.length}</div>
      <div class="card qcard"><div class="qtopic">${esc(m.topic)}</div>
        <div class="hint">You missed this ${m.misses.length}× · last time: ${esc(last.reason.toLowerCase())}${last.note ? " — “" + esc(last.note) + "”" : ""}</div>
        ${quiz.revealed ? reveal + `<div class="alts">${m.pages.length ? "Open: " + pageLinks(m.pages) : ""}</div>
          <div class="acts"><button data-r="no">Still shaky</button><button data-r="yes" class="primary">Got it</button>${m.box >= 3 ? '<button data-r="retire">Got it, retire it</button>' : ""}</div>`
        : `<p>Before you look: say out loud what the answer and the key discriminating feature are.</p><div class="acts"><button id="qShow" class="primary">Show Melman’s explanation</button></div>`}
      </div>`;
    if (!quiz.revealed) { $("qShow").onclick = () => { quiz.revealed = true; renderMissed(); }; return; }
    wireLinks(body, m.pages);
    body.querySelectorAll("[data-r]").forEach((b) => b.addEventListener("click", () => {
      const r = b.dataset.r;
      update(m.id, (x) => {
        if (r === "no") { x.box = 0; x.wrong++; x.due = Date.now() + DAY; }
        else { x.box = Math.min(x.box + 1, 4); x.right++; x.due = Date.now() + INTERVALS[x.box] * DAY; if (r === "retire") x.mastered = true; }
      });
      log("quiz", { ok: r !== "no", topic: m.key });
      if (r === "no") quiz.shaky++; else quiz.right++;
      quiz.i++; quiz.revealed = false; renderMissed();
    }));
  }

  // ====================================================================
  // 3. COMPARE
  // ====================================================================
  let cmp = { a: "", b: "", ra: null, rb: null, ia: 0, ib: 0 };

  function renderCompare() {
    const E = A.engine; if (!E) return;
    const vs = E.vsHeadings().filter((s) => s.title.length <= 48);
    $("tab-compare").innerHTML = `<div class="cmpbar">
        <input id="cA" placeholder="Concept A  (e.g. SIADH)" value="${esc(cmp.a)}"><span>vs</span>
        <input id="cB" placeholder="Concept B  (e.g. diabetes insipidus)" value="${esc(cmp.b)}">
        <button id="cGo" class="primary">Compare</button></div>
      <div class="cmpquick"><select id="cQuick"><option value="">Melman’s own “X vs Y” sections…</option>${vs.map((s, i) => `<option value="${i}">${esc(s.title)} (${esc(short(E.docs[s.d].title))} p.${s.page})</option>`).join("")}</select></div>
      <div id="cOut"></div>`;
    const go = () => { cmp.a = $("cA").value.trim(); cmp.b = $("cB").value.trim(); if (!cmp.a || !cmp.b) return; cmp.ra = E.findSections(cmp.a, 6); cmp.rb = E.findSections(cmp.b, 6); cmp.ia = cmp.ib = 0; log("compare", { a: cmp.a.toLowerCase(), b: cmp.b.toLowerCase() }); drawCompare(); };
    $("cGo").onclick = go;
    ["cA", "cB"].forEach((id) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }));
    $("cQuick").onchange = (e) => {
      if (e.target.value === "") return;
      const s = vs[+e.target.value]; const parts = s.title.split(/\s+vs\.?\s+/i).map((x) => x.trim());
      $("cA").value = parts[0].replace(/-$/, ""); $("cB").value = parts[1] || ""; go();
    };
    if (cmp.ra) drawCompare();
    else $("cOut").innerHTML = '<p class="hint">Pick two concepts you keep mixing up (nephritic vs nephrotic, DKA vs HHS, UC vs Crohn…). Melman’s explanation of each appears side by side, with the best-matching section chosen for you. Use the dropdown on each side if it picked the wrong one.</p>';
  }

  function drawCompare() {
    const E = A.engine, out = $("cOut"); out.innerHTML = '<div class="cmpgrid"></div>';
    const grid = out.firstChild;
    [["a", "ra", "ia"], ["b", "rb", "ib"]].forEach(([k, rk, ik]) => {
      const res = cmp[rk], it = res.items[cmp[ik]], col = document.createElement("div"); col.className = "cmpcol";
      if (!it) { col.innerHTML = `<h4>${esc(cmp[k])}</h4><p class="hint">No match found.</p>`; grid.appendChild(col); return; }
      col.innerHTML = `<h4>${esc(cmp[k])}</h4>
        <select class="csel">${res.items.map((x, i) => `<option value="${i}" ${i === cmp[ik] ? "selected" : ""}>${esc((x.title || "page " + x.page).slice(0, 50))} — ${esc(short(E.docs[x.d].title))} p.${x.page}</option>`).join("")}</select>
        <div class="cmeta"><a href="${encodeURI(E.docs[it.d].file)}#page=${it.page}" target="_blank" rel="noopener">Open PDF p.${it.page} ↗</a>${it.alts.length ? ` · also in ${it.alts.map((a) => esc(short(E.docs[a.d].title)) + " p." + a.page).join(", ")}` : ""}
          · <a href="#" class="cmiss">✗ Missed</a></div>
        <div class="cbody">${bullets(it.text, res.terms)}</div>`;
      col.querySelector(".csel").onchange = (e) => { cmp[ik] = +e.target.value; drawCompare(); };
      col.querySelector(".cmiss").onclick = (e) => { e.preventDefault(); openDialog({ topic: cmp.a + " vs " + cmp.b, pages: [{ d: E.docs[it.d].file, n: it.page, pos: it.i >= 0 ? E.docs[it.d].toc[it.i][3] : 0 }] }); };
      grid.appendChild(col);
    });
  }

  // ====================================================================
  // 4. STATS
  // ====================================================================
  function tally(arr) { const m = {}; arr.forEach((x) => { if (x) m[x] = (m[x] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); }
  function bars(rows, empty) {
    if (!rows.length) return `<p class="hint">${empty}</p>`;
    const max = Math.max(...rows.map((r) => r[1]));
    return `<div class="hbars">${rows.map(([l, v, extra]) => `<div class="hrow" title="${esc(l)}: ${v}"><span class="hl">${esc(l)}</span><span class="ht"><i style="width:${Math.max(3, (v / max) * 100)}%"></i></span><span class="hv">${v}</span></div>`).join("")}</div>`;
  }
  const fileTitle = (f) => short((A.engine.docs.find((d) => d.file === f) || {}).title || f);

  function renderStats() {
    const E = A.engine; if (!E) return;
    const ev = store.get("melman.events", []), now = Date.now(), wk = ev.filter((e) => now - e.t < 7 * DAY);
    const missed = getMissed(), quizEv = ev.filter((e) => e.type === "quiz" && now - e.t < 30 * DAY);
    const acc = quizEv.length ? Math.round((quizEv.filter((e) => e.ok).length / quizEv.length) * 100) + "%" : "–";
    // activity per day (14d)
    const days = []; const start = new Date(); start.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) { const t0 = start.getTime() - i * DAY; days.push({ t0, n: ev.filter((e) => e.t >= t0 && e.t < t0 + DAY && e.type !== "compare").length }); }
    const dmax = Math.max(1, ...days.map((d) => d.n));
    const opens = ev.filter((e) => e.type === "open");
    const searches = tally(ev.filter((e) => e.type === "search").map((e) => e.q)).slice(0, 8);
    const secs = tally(opens.map((e) => e.sec)).slice(0, 8);
    const shelves = tally(opens.map((e) => fileTitle(e.d))).slice(0, 8);
    const reasons = tally(missed.flatMap((m) => m.misses.map((x) => x.reason)));
    const mShelf = tally(missed.flatMap((m) => m.pages[0] ? Array(m.misses.length).fill(fileTitle(m.pages[0].d)) : [])).slice(0, 8);
    const weak = missed.filter((m) => !m.mastered).sort((a, b) => score(b) - score(a)).slice(0, 5).map((m) => [m.topic, m.misses.length]);

    $("tab-stats").innerHTML = `
      <div class="tiles">
        <div class="tile"><b>${wk.filter((e) => e.type === "search").length}</b><span>searches (7 days)</span></div>
        <div class="tile"><b>${wk.filter((e) => e.type === "open").length}</b><span>pages opened (7 days)</span></div>
        <div class="tile"><b>${missed.reduce((n, m) => n + m.misses.length, 0)}</b><span>misses logged</span></div>
        <div class="tile"><b>${acc}</b><span>quiz “got it” rate (30 days)</span></div>
      </div>
      <h4>Activity, last 14 days</h4>
      <div class="vbars">${days.map((d) => `<div class="vcol" title="${new Date(d.t0).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${d.n} actions"><i style="height:${Math.max(d.n ? 4 : 0, (d.n / dmax) * 100)}%"></i><small>${new Date(d.t0).getDate()}</small></div>`).join("")}</div>
      <div class="two"><div><h4>Most searched</h4>${bars(searches, "Search a few topics and they’ll show up here.")}</div>
      <div><h4>Sections you reopen most</h4>${bars(secs, "Open some pages first.")}</div></div>
      <div class="two"><div><h4>Pages opened by PDF</h4>${bars(shelves, "Nothing yet.")}</div>
      <div><h4>Misses by PDF</h4>${bars(mShelf, "Log a miss to see which shelf trips you up.")}</div></div>
      <div class="two"><div><h4>Why you miss</h4>${bars(reasons, "No misses logged yet.")}</div>
      <div><h4>Weakest topics</h4>${bars(weak, "No misses logged yet.")}</div></div>
      <h4>Your data</h4>
      <p class="hint">Everything here is stored in this browser only. Export a backup now and then, and use it to move to another device.</p>
      <div class="acts"><button id="sExp">Export backup</button><button id="sImp">Import backup</button><input type="file" id="sFile" accept="application/json" hidden><button id="sClr" class="plain">Clear activity history</button></div>`;
    $("sExp").onclick = () => {
      const data = {}; ["melman.saved", "melman.missed", "melman.events", "melman.recent"].forEach((k) => { data[k] = store.get(k, []); });
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
      a.download = "melman-search-backup-" + new Date().toISOString().slice(0, 10) + ".json"; a.click();
    };
    $("sImp").onclick = () => $("sFile").click();
    $("sFile").onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      f.text().then((t) => { const d = JSON.parse(t); if (!confirm("Replace the data in this browser with the backup?")) return;
        Object.keys(d).filter((k) => k.startsWith("melman.")).forEach((k) => store.set(k, d[k])); updateCount(); toast("Imported ✓"); renderStats(); })
        .catch(() => toast("That file isn't a valid backup"));
    };
    $("sClr").onclick = () => { if (confirm("Clear search/open history? (Your misses and saved pages are kept.)")) { store.set("melman.events", []); renderStats(); } };
  }

  // ---------- wire up ----------
  document.addEventListener("melman:tab", (e) => {
    if (!A.engine) return;
    if (e.detail === "missed") renderMissed();
    else if (e.detail === "compare") renderCompare();
    else if (e.detail === "stats") renderStats();
  });
  A.onReady(updateCount);
})();
