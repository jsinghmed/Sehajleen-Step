# Melman Search

Search every Melman PDF at once and jump straight to the page.

## Add your PDFs
Put all PDFs in the `pdfs/` folder (subfolders are fine), then either:

**Run locally (simplest)**
```bash
pip install pymupdf
python3 compress_pdfs.py      # only needed for big PDFs (see below)
python3 build_index.py        # reads pdfs/, writes data/index.json
python3 -m http.server 8000   # open http://localhost:8000
```

**Or host on GitHub Pages**
1. Push everything to a repo's `main` branch.
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. Every push rebuilds the index automatically, so adding a PDF = commit and push.

> Note: GitHub Pages sites are public even if the repo is private (unless you're on a paid plan with
> private Pages). Keep the repo private and run locally if you'd rather not have the PDFs public.

## Big PDFs
GitHub rejects files over 100 MB. `compress_pdfs.py` re-encodes only the images in PDFs over 20 MB
(text is untouched, so search is identical; originals are kept in `originals/`, which is git-ignored).
Your first batch went from 407 MB to 35 MB this way with no visible quality loss.

## Using it
- Type a concept, or paste a full QBank question: filler words are dropped and the best pages rank first.
- Abbreviations work both ways (DKA ↔ diabetic ketoacidosis). Add more in `ABBR` in `search.js`.
- Chips under the search bar show which PDF the hits are in; click one to narrow down.
- Melman repeats a lot of text across the Medicine / Family Med / Surgery / Peds PDFs, so identical passages are merged into one result with "Also in" links.
- Topic headings (e.g. "SIADH", "Kawasaki disease") are detected automatically. They label each result, appear as "Matching sections", and make up the **Browse** tab.
- ★ saves a page with a note, kept in your browser. **Text** shows the page's text with your terms highlighted.
- `/` focuses the search box, `Esc` clears it.

## Study features
- **Missed** tab: hit **✗ Missed** on a search result, in the viewer, or in Compare; pick why you missed it and attach the Melman pages.
  Logging the same topic again merges into one entry (missed 2×, 3×…).
  - *Weak spots* ranks topics by how often and how recently you missed them, and summarises your most common miss reason.
  - *Quiz* resurfaces topics on a 1/3/7/14/30-day schedule: recall first, reveal Melman's section, then "Got it" or "Still shaky".
- **Compare** tab: two concepts side by side (best-matching section for each, switchable), plus Melman's own "X vs Y" sections.
- **Stats** tab: searches, pages opened, activity by day, most-reopened sections, misses by reason and by PDF.

All of this is stored in the browser (localStorage), so it is per device. **Stats → Export backup** saves it to a file; Import restores it.

## Scanned PDFs
If `build_index.py` warns that a PDF has pages with no text, those pages are images. Run
`ocrmypdf in.pdf out.pdf` on them first, then rebuild.
