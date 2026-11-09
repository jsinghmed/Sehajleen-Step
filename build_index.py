#!/usr/bin/env python3
"""Extract text from every PDF in ./pdfs and write data/index.json.

Run:  python3 build_index.py
Needs: pip install pymupdf
"""
import json
import re
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF is missing. Run:  pip install pymupdf")

ROOT = Path(__file__).resolve().parent
PDF_DIR = ROOT / "pdfs"
OUT = ROOT / "data" / "index.json"


def clean(text: str) -> str:
    text = NOISE.sub(" ", text)
    text = re.sub(r"([a-z])-\n([a-z])", r"\1\2", text)  # re-join words hyphenated across lines
    text = re.sub(r"\s+", " ", text)
    return text.strip()


NOISE = re.compile(r"MEHLMANMEDICAL\.COM", re.I)


def find_headings(raw: str):
    """Melman's section headings are short standalone lines (no leading dash) above bullets.
    A long heading may wrap onto a second line ("Preeclampsia / \\neclampsia")."""
    lines = [l.strip() for l in NOISE.sub("", raw).splitlines() if l.strip()]
    bullet = ("-", "•", "·")

    def plain(l):  # could be (part of) a heading
        return (not l.startswith(bullet) and len(l) <= 45 and not re.search(r"[.,;:?!]$", l)
                and not re.fullmatch(r"[\d\s./]+", l) and re.search(r"[A-Za-z]{2}", l) and not l.endswith("-"))

    heads, i = [], 0
    while i < len(lines):
        l = lines[i]
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        nxt2 = lines[i + 2] if i + 2 < len(lines) else ""
        starts_ok = l[0].isupper() or l[0].isdigit() or l[0] in "“\"("
        if plain(l) and starts_ok:
            if nxt.startswith(bullet) or not nxt:
                heads.append(l); i += 1; continue
            wraps = nxt[:1].islower() or re.search(r"(/|&|\+|-|\bvs\.?|\band|\bor|\bof|\bin|\bwith|\bto)$", l, re.I)
            if wraps and plain(nxt) and nxt2.startswith(bullet) and len(l) + len(nxt) <= 70:
                heads.append(l + " " + nxt); i += 2; continue
        i += 1
    return heads


def pretty_title(path: Path) -> str:
    t = re.sub(r"[_]+", " ", path.stem)
    return re.sub(r"\s+", " ", t).strip()


def main() -> None:
    pdfs = sorted(PDF_DIR.rglob("*.pdf"), key=lambda p: p.as_posix().lower())
    if not pdfs:
        print(f"No PDFs found in {PDF_DIR}. Put your files there and run again.")

    docs, pages, scanned = [], [], []
    for di, pdf in enumerate(pdfs):
        try:
            doc = fitz.open(pdf)
        except Exception as e:  # noqa: BLE001
            print(f"  ! could not open {pdf.name}: {e}")
            continue
        toc = [[lvl, title.strip(), pg, 0] for lvl, title, pg in doc.get_toc() if pg > 0 and title.strip()]
        has_bookmarks = bool(toc)
        empty = 0
        idx = len(docs)
        for pno in range(len(doc)):
            raw = doc[pno].get_text("text")
            text = clean(raw)
            if len(text) < 30:
                empty += 1
            pages.append([idx, pno + 1, text])
            if not has_bookmarks:  # derive topic headings, with their position in the page text
                cursor = 0
                for h in find_headings(raw):
                    pos = text.find(h + " -", cursor)
                    if pos < 0:
                        pos = text.find(h, cursor)
                    if pos < 0:
                        continue
                    cursor = pos + len(h)
                    toc.append([1, h, pno + 1, pos])
        docs.append({
            "file": pdf.relative_to(ROOT).as_posix(),
            "title": pretty_title(pdf),
            "pages": len(doc),
            "toc": toc,
        })
        if empty:
            scanned.append((pdf.name, empty, len(doc)))
        print(f"  {pdf.name}: {len(doc)} pages, {len(toc)} bookmarks")
        doc.close()

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"docs": docs, "pages": pages}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    size = OUT.stat().st_size / 1e6
    print(f"\nWrote {OUT.relative_to(ROOT)}: {len(docs)} PDFs, {len(pages)} pages, {size:.1f} MB")
    for name, empty, total in scanned:
        print(f"  note: {name} has {empty}/{total} pages with little/no text (images or scans). "
              "Those pages can't be searched until OCR'd (ocrmypdf).")


if __name__ == "__main__":
    main()
