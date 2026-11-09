/* Search engine: BM25 over PDF pages, with prefix matching, abbreviation
   expansion, phrase/heading boosts, and a "paste a whole question" mode.
   Works in the browser (window.MelmanSearch) and in Node (for tests). */
(function (root) {
  "use strict";

  // Common Step 2 abbreviations. [abbr, full phrase]. Searching either finds both.
  const ABBR = [
    ["mi", "myocardial infarction"], ["stemi", "st elevation myocardial infarction"],
    ["nstemi", "non st elevation myocardial infarction"], ["acs", "acute coronary syndrome"],
    ["chf", "congestive heart failure"], ["hf", "heart failure"], ["afib", "atrial fibrillation"],
    ["af", "atrial fibrillation"], ["svt", "supraventricular tachycardia"], ["vtach", "ventricular tachycardia"],
    ["dvt", "deep vein thrombosis"], ["pe", "pulmonary embolism"], ["copd", "chronic obstructive pulmonary disease"],
    ["ards", "acute respiratory distress syndrome"], ["osa", "obstructive sleep apnea"],
    ["dka", "diabetic ketoacidosis"], ["hhs", "hyperosmolar hyperglycemic state"], ["dm", "diabetes mellitus"],
    ["t2dm", "type 2 diabetes mellitus"], ["t1dm", "type 1 diabetes mellitus"], ["siadh", "syndrome of inappropriate antidiuretic hormone"],
    ["di", "diabetes insipidus"], ["pcos", "polycystic ovary syndrome"], ["men", "multiple endocrine neoplasia"],
    ["gerd", "gastroesophageal reflux disease"], ["ibd", "inflammatory bowel disease"], ["ibs", "irritable bowel syndrome"],
    ["uc", "ulcerative colitis"], ["pud", "peptic ulcer disease"], ["gi", "gastrointestinal"], ["gib", "gastrointestinal bleeding"],
    ["sbp", "spontaneous bacterial peritonitis"], ["pbc", "primary biliary cholangitis"], ["psc", "primary sclerosing cholangitis"],
    ["hcc", "hepatocellular carcinoma"], ["aki", "acute kidney injury"], ["ckd", "chronic kidney disease"],
    ["atn", "acute tubular necrosis"], ["uti", "urinary tract infection"], ["bph", "benign prostatic hyperplasia"],
    ["rta", "renal tubular acidosis"], ["gn", "glomerulonephritis"], ["hus", "hemolytic uremic syndrome"],
    ["ttp", "thrombotic thrombocytopenic purpura"], ["itp", "immune thrombocytopenic purpura"],
    ["dic", "disseminated intravascular coagulation"], ["hit", "heparin induced thrombocytopenia"],
    ["cll", "chronic lymphocytic leukemia"], ["cml", "chronic myeloid leukemia"], ["aml", "acute myeloid leukemia"],
    ["all", "acute lymphoblastic leukemia"], ["sle", "systemic lupus erythematosus"], ["ra", "rheumatoid arthritis"],
    ["gca", "giant cell arteritis"], ["pmr", "polymyalgia rheumatica"], ["tia", "transient ischemic attack"],
    ["sah", "subarachnoid hemorrhage"], ["ms", "multiple sclerosis"], ["als", "amyotrophic lateral sclerosis"],
    ["gbs", "guillain barre syndrome"], ["nph", "normal pressure hydrocephalus"], ["icp", "intracranial pressure"],
    ["mdd", "major depressive disorder"], ["gad", "generalized anxiety disorder"], ["ocd", "obsessive compulsive disorder"],
    ["ptsd", "post traumatic stress disorder"], ["adhd", "attention deficit hyperactivity disorder"],
    ["nms", "neuroleptic malignant syndrome"], ["ssri", "selective serotonin reuptake inhibitor"],
    ["maoi", "monoamine oxidase inhibitor"], ["tca", "tricyclic antidepressant"], ["pph", "postpartum hemorrhage"],
    ["hellp", "hemolysis elevated liver enzymes low platelets"], ["gdm", "gestational diabetes mellitus"],
    ["pid", "pelvic inflammatory disease"], ["pprom", "preterm premature rupture of membranes"],
    ["prom", "premature rupture of membranes"], ["rds", "respiratory distress syndrome"],
    ["nec", "necrotizing enterocolitis"], ["vsd", "ventricular septal defect"], ["asd", "atrial septal defect"],
    ["pda", "patent ductus arteriosus"], ["tof", "tetralogy of fallot"], ["hsp", "henoch schonlein purpura"],
    ["jia", "juvenile idiopathic arthritis"], ["scfe", "slipped capital femoral epiphysis"], ["ddh", "developmental dysplasia of the hip"],
    ["hiv", "human immunodeficiency virus"], ["tb", "tuberculosis"], ["mrsa", "methicillin resistant staphylococcus aureus"],
    ["cap", "community acquired pneumonia"], ["hap", "hospital acquired pneumonia"], ["vap", "ventilator associated pneumonia"],
    ["csf", "cerebrospinal fluid"], ["ecg", "electrocardiogram"], ["ekg", "electrocardiogram"], ["ct", "computed tomography"],
    ["mri", "magnetic resonance imaging"], ["abg", "arterial blood gas"], ["cbc", "complete blood count"],
    ["nsaid", "nonsteroidal anti inflammatory drug"], ["ace", "angiotensin converting enzyme"], ["arb", "angiotensin receptor blocker"],
    ["ppi", "proton pump inhibitor"], ["ercp", "endoscopic retrograde cholangiopancreatography"],
    ["ppd", "purified protein derivative"], ["pft", "pulmonary function test"], ["ards", "acute respiratory distress syndrome"],
    ["lbbb", "left bundle branch block"], ["rbbb", "right bundle branch block"], ["wpw", "wolff parkinson white"],
    ["cad", "coronary artery disease"], ["pad", "peripheral arterial disease"], ["htn", "hypertension"],
    ["ntd", "neural tube defect"], ["ivig", "intravenous immunoglobulin"], ["ffp", "fresh frozen plasma"],
  ];

  const GAP_WORDS = ["of", "the", "and", "in", "to", "with", "for", "a", "an", "on", "or", "by", "at", "as", "vs"];
  const STOP_BASIC = new Set(("a an and are as at be but by for from in into is it its of on or that the to was were with").split(" "));
  // Extra filler that dominates pasted question stems.
  const STOP_Q = new Set(STOP_BASIC);
  ("have has had he she his her they them their this these those there then than which what when where while who whom why how will would should could can may might must do does did not no yes " +
   "following most likely best next step appropriate management patient patients year old man woman girl boy male female presents presenting history physical examination exam shows reveals " +
   "present reports complains comes brought emergency department physician doctor today days weeks months years ago past medical vital signs temperature pulse respirations blood pressure mm hg " +
   "per min minute minutes hours after before during following diagnosis underlying mechanism cause explains finding findings result results lab laboratory studies show true correct " +
   "unremarkable otherwise denies recent also been being very more some any other about over under between each").split(" ")
    .forEach((w) => STOP_Q.add(w));

  function stem(w) {
    if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function tokenize(text) {
    return (text.toLowerCase().match(/[a-z0-9]+/g) || []).map(stem);
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  // Stemmed "artery" must also highlight "arteries".
  function variants(terms) {
    const out = new Set();
    for (const t of terms) { out.add(t); if (t.length > 3 && t.endsWith("y")) out.add(t.slice(0, -1) + "ie"); }
    return [...out];
  }

  class Engine {
    constructor(data) {
      this.docs = data.docs;
      this.pages = data.pages.map(([d, n, text]) => ({ d, n, text }));
      // Section headings per page (from PDF bookmarks) + nearest section for any page.
      this.headingAt = new Map();      // `${d}:${n}` -> [titles starting on that page]
      this.sectionList = [];           // flat list of {d,title,page,level,norm}
      this.docs.forEach((doc, d) => {
        doc.toc.forEach(([level, title, page, pos], i) => {
          const k = d + ":" + page;
          if (!this.headingAt.has(k)) this.headingAt.set(k, []);
          this.headingAt.get(k).push(title);
          this.sectionList.push({ d, i, title, page, level, pos: pos || 0, norm: " " + tokenize(title).join(" ") + " " });
        });
      });
      this._build();
    }

    _build() {
      const inv = new Map();
      let total = 0;
      this.pages.forEach((p, id) => {
        const toks = tokenize(p.text);
        p.len = toks.length || 1;
        p.norm = " " + toks.join(" ") + " ";
        const hs = this.headingAt.get(p.d + ":" + p.n);
        p.head = hs ? " " + tokenize(hs.join(" ")).join(" ") + " " : "";
        total += p.len;
        const tf = new Map();
        for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
        for (const [t, c] of tf) {
          let list = inv.get(t);
          if (!list) inv.set(t, (list = []));
          list.push(id, c);
        }
      });
      this.inv = inv;
      this.avgLen = total / Math.max(1, this.pages.length);
      this.vocab = [...inv.keys()].sort();
    }

    /** Index (in docs[d].toc) of the nearest heading at/before `pos` on page p, or -1. */
    sectionIndexFor(p, pos = 1e9) {
      let best = -1;
      const toc = this.docs[p.d].toc;
      for (let i = 0; i < toc.length; i++) {
        const [, , page, off] = toc[i];
        if (page < p.n || (page === p.n && off <= pos)) best = i; else if (page > p.n) break;
      }
      return best;
    }

    pageId(d, n) { return this.pages.findIndex((p) => p.d === d && p.n === n); }

    /** Full text of one section: from its heading to the next heading (capped). */
    sectionBody(d, i, maxChars = 3500) {
      const toc = this.docs[d].toc;
      const [, title, page, off] = toc[i];
      const next = toc[i + 1];
      let out = "", pg = page;
      const endPage = next ? next[2] : page, endOff = next ? next[3] : 1e9;
      while (pg <= Math.min(endPage, this.docs[d].pages) && out.length < maxChars) {
        const pid = this.pageId(d, pg); if (pid < 0) break;
        const t = this.pages[pid].text;
        const from = pg === page ? off : 0, to = pg === endPage ? endOff : t.length;
        out += (out ? " " : "") + t.slice(from, to);
        if (pg === endPage) break;
        pg++;
      }
      out = out.trim();
      return { title, page, text: out.length > maxChars ? out.slice(0, maxChars) + "…" : out };
    }

    /**
     * Candidate sections for a concept, best first: headings that match, then the sections
     * that contain the best-matching pages. Identical copies across PDFs are merged ("alts").
     */
    findSections(query, max = 8) {
      const res = this.search(query, { limit: 40 });
      const cand = [];
      for (const s of res.sections) cand.push({ d: s.d, i: s.i });
      for (const h of res.hits) {
        const p = this.pages[h.id];
        const sn = this.snippet(h.id, res.re);
        const i = this.sectionIndexFor(p, sn.pos);
        if (i >= 0) cand.push({ d: p.d, i }); else cand.push({ d: p.d, i: -1, page: p.n });
      }
      const seen = new Map(), out = [];
      for (const c of cand) {
        let body, title, page;
        if (c.i >= 0) { const b = this.sectionBody(c.d, c.i); body = b.text; title = b.title; page = b.page; }
        else { page = c.page; title = "(page " + page + ")"; body = this.pages[this.pageId(c.d, page)].text.slice(0, 3500); }
        const key = body.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 100);
        const k = key.length > 40 ? key : c.d + ":" + c.i + ":" + page;
        if (seen.has(k)) { const o = seen.get(k); if (!o.alts.some((a) => a.d === c.d && a.page === page)) o.alts.push({ d: c.d, page }); continue; }
        const item = { d: c.d, i: c.i, title, page, text: body, alts: [] };
        seen.set(k, item); out.push(item);
        if (out.length >= max) break;
      }
      return { items: out, terms: res.terms };
    }

    /** Headings of the form "X vs Y", for one-click comparisons. */
    vsHeadings() {
      const seen = new Set(), out = [];
      for (const s of this.sectionList) {
        if (!/\bvs\.?\b/i.test(s.title)) continue;
        const k = s.norm; if (seen.has(k)) continue; seen.add(k);
        out.push(s);
      }
      return out;
    }

    /** Nearest heading at or before character position `pos` on page p. */
    sectionFor(p, pos = 1e9) {
      let best = null;
      for (const [, title, page, off] of this.docs[p.d].toc) {
        if (page < p.n || (page === p.n && off <= pos)) best = title; else if (page > p.n) break;
      }
      return best;
    }

    _headHas(norm, t) { return norm.includes(" " + t + " ") || (t.length >= 4 && norm.includes(" " + t)); }

    _prefixTerms(prefix, limit) {
      const v = this.vocab; let lo = 0, hi = v.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (v[mid] < prefix) lo = mid + 1; else hi = mid; }
      const out = [];
      while (lo < v.length && v[lo].startsWith(prefix) && out.length < limit) out.push(v[lo++]);
      return out;
    }

    /** Parse a query into weighted term groups. */
    parse(query) {
      let toks = tokenize(query);
      const questionMode = toks.length > 12;
      const stop = questionMode ? STOP_Q : STOP_BASIC;
      let core = toks.filter((t) => !stop.has(t) && !(questionMode && (t.length < 2 || /^\d+$/.test(t))));
      if (!core.length) core = toks;
      core = [...new Set(core)];

      const q = " " + toks.join(" ") + " ";
      const extra = new Map(); // optional expansion terms -> weight
      const aliases = new Set();   // whole-heading equivalents, e.g. "di" <-> "diabetes insipidus"
      for (const [ab, full] of ABBR) {
        const fullNorm = " " + tokenize(full).join(" ") + " ";
        if (core.includes(ab) && toks.length <= 6) { tokenize(full).forEach((t) => extra.set(t, 0.55)); if (core.length === 1) aliases.add(fullNorm); }
        if (q.includes(fullNorm)) { extra.set(ab, 0.8); if (q.trim() === fullNorm.trim()) aliases.add(" " + ab + " "); }
      }
      for (const t of core) extra.delete(t);
      return { core, extra, toks, questionMode, aliases };
    }

    search(query, { docFilter = null, limit = 80 } = {}) {
      const { core, extra, toks, questionMode, aliases } = this.parse(query);
      if (!core.length) return { hits: [], sections: [], terms: [], counts: {} };

      const N = this.pages.length, k1 = 1.2, b = 0.75;
      const scores = new Map();   // pageId -> score
      const matched = new Map();  // pageId -> Set(core idx matched)

      const addTerm = (term, weight, coreIdx) => {
        const list = this.inv.get(term);
        if (!list) return;
        const df = list.length / 2;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        for (let i = 0; i < list.length; i += 2) {
          const id = list[i], tf = list[i + 1], p = this.pages[id];
          const s = weight * idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * p.len) / this.avgLen)));
          scores.set(id, (scores.get(id) || 0) + s);
          if (coreIdx >= 0) {
            let m = matched.get(id); if (!m) matched.set(id, (m = new Set())); m.add(coreIdx);
          }
        }
      };

      core.forEach((t, i) => {
        addTerm(t, 1, i);
        const isLast = i === core.length - 1 && !questionMode;
        if (t.length >= 4 || (isLast && t.length >= 2)) {
          for (const pt of this._prefixTerms(t, 25)) if (pt !== t) addTerm(pt, isLast ? 0.7 : 0.45, i);
        }
      });
      for (const [t, w] of extra) addTerm(t, w, -1);

      // Multi-word queries ("atrial fibrillation") must match as a phrase, not as separate words.
      // One filler word may sit between them, and a known abbreviation (afib) counts as the phrase.
      let strictRe = null;
      if (core.length >= 2 && !questionMode) {
        const gap = "(?:(?:" + GAP_WORDS.join("|") + ") )?";
        let src = " " + core.map((t, i) => escapeRe(t) + (i === core.length - 1 ? "\\S*" : "")).join(" " + gap);
        for (const [t, w] of extra) if (w >= 0.8) src += "| " + escapeRe(t) + " ";
        strictRe = new RegExp(src);
      }
      const phrase = core.length > 1 && !questionMode ? " " + toks.join(" ") + " " : null;
      let ranked = [];
      for (const [id, raw] of scores) {
        const p = this.pages[id];
        if (docFilter != null && p.d !== docFilter) continue;
        const cov = (matched.get(id)?.size || 0) / core.length;
        let s = raw * Math.pow(Math.max(cov, 0.15), questionMode ? 1.2 : 1.8);
        if (phrase && p.norm.includes(phrase)) s *= 1.6;
        if (p.head && core.every((t) => this._headHas(p.head, t))) s *= 1.5;
        ranked.push([id, s, cov, !strictRe || strictRe.test(p.norm)]);
      }
      ranked.sort((a, c) => c[1] - a[1]);
      let phraseMode = false, phraseFallback = false;
      if (strictRe) {
        const strict = ranked.filter((r) => r[3]);
        if (strict.length) { ranked = strict; phraseMode = true; } else phraseFallback = true;   // nothing has the phrase: fall back to the words
      }

      const counts = {};
      if (docFilter != null) { /* counts computed unfiltered below */ }
      const all = docFilter == null ? ranked : null;
      if (all) all.slice(0, 300).forEach(([id]) => { const d = this.pages[id].d; counts[d] = (counts[d] || 0) + 1; });

      const hits = ranked.slice(0, limit).map(([id, s]) => {
        const p = this.pages[id];
        return { id, d: p.d, n: p.n, score: s };
      });

      // Matching section headings (bookmarks).
      const exact = " " + core.join(" ") + " ";
      const sections = this.sectionList
        .filter((s) => (docFilter == null || s.d === docFilter) && (aliases.has(s.norm) || (phraseMode ? strictRe.test(s.norm) : core.every((t) => this._headHas(s.norm, t)))))
        .sort((a, b) => ((b.norm === exact) || aliases.has(b.norm)) - ((a.norm === exact) || aliases.has(a.norm)) || a.norm.length - b.norm.length)
        .slice(0, 6);

      const terms = [...core, ...[...extra.keys()].filter((t) => extra.get(t) >= 0.8)];
      const re = phraseMode ? this.phraseRegex(query) : this.highlightRegex(terms);
      return { hits, sections, terms, counts, questionMode, phraseMode, phraseFallback, re };
    }

    /** The terms worth highlighting for a query (core words + abbreviation/full-name equivalents). */
    termsFor(query) {
      const { core, extra } = this.parse(query);
      return [...core, ...[...extra.keys()].filter((t) => extra.get(t) >= 0.8)];
    }

    /** Short text window containing the densest cluster of query terms. */
    snippet(pageId, termsOrRe, width = 260) {
      const text = this.pages[pageId].text;
      if (!text) return { text: "(no extractable text on this page)", pos: 0 };
      const re = termsOrRe instanceof RegExp ? new RegExp(termsOrRe.source, "gi") : new RegExp("\\b(" + variants(termsOrRe).map(escapeRe).join("|") + ")[a-z]*", "gi");
      const pos = []; let m;
      while ((m = re.exec(text)) && pos.length < 400) { if (!m[0]) { re.lastIndex++; continue; } pos.push(m.index); }
      if (!pos.length) return { text: text.slice(0, width) + (text.length > width ? "…" : ""), pos: 0 };
      let bestStart = pos[0], bestCount = 0;
      for (let i = 0; i < pos.length; i++) {
        let c = 0; for (let j = i; j < pos.length && pos[j] - pos[i] < width - 40; j++) c++;
        if (c > bestCount) { bestCount = c; bestStart = pos[i]; }
      }
      let start = Math.max(0, bestStart - 50);
      if (start > 0) { const sp = text.indexOf(" ", start); if (sp > -1 && sp < bestStart) start = sp + 1; }
      const end = Math.min(text.length, start + width);
      return { text: (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : ""), pos: bestStart };
    }

    /** Regex matching the whole phrase as typed (for multi-word queries), or null. Used for highlighting. */
    phraseRegex(query) {
      const { core, extra, questionMode } = this.parse(query);
      if (core.length < 2 || questionMode) return null;
      const word = (t) => "(?:" + variants([t]).map(escapeRe).join("|") + ")[a-z]*";
      const sep = "[\\s\\-/]+(?:(?:" + GAP_WORDS.join("|") + ")[\\s\\-/]+)?";
      let src = "\\b" + core.map(word).join(sep);
      const abbrs = [...extra.keys()].filter((t) => extra.get(t) >= 0.8);
      if (abbrs.length) src += "|\\b(?:" + abbrs.map(escapeRe).join("|") + ")\\b";
      return new RegExp(src, "gi");
    }
    /** Best highlight regex for a query: the phrase if it has several words, else the word(s). */
    highlightRegexQ(query) { return this.phraseRegex(query) || this.highlightRegex(this.termsFor(query)); }
    wordsRegexQ(query) { return this.highlightRegex(this.termsFor(query)); }

    /** Accepts a RegExp (phrase) or an array of terms. */
    toRegex(x) { return x instanceof RegExp ? new RegExp(x.source, "gi") : this.highlightRegex(x); }

    highlightRegex(terms) {
      if (!terms.length) return null;
      return new RegExp("\\b(" + variants(terms).map(escapeRe).join("|") + ")[a-z]*", "gi");
    }
  }

  const api = { Engine, tokenize, stem, ABBR };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MelmanSearch = api;
})(typeof window !== "undefined" ? window : globalThis);
