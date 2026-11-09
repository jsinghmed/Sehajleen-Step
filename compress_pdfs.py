#!/usr/bin/env python3
"""Shrink big PDFs so they fit GitHub (100 MB/file limit) and load fast.
Only re-encodes the images (text stays text, so search is unaffected).
Originals are moved to ./originals/ (git-ignored) before being replaced.

Run:  python3 compress_pdfs.py            # compresses PDFs over 20 MB
      python3 compress_pdfs.py --all      # compresses every PDF
"""
import shutil
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent
LIMIT = 0 if "--all" in sys.argv else 20 * 1024 * 1024

for pdf in sorted((ROOT / "pdfs").rglob("*.pdf")):
    size = pdf.stat().st_size
    if size <= LIMIT:
        continue
    backup = ROOT / "originals" / pdf.relative_to(ROOT / "pdfs")
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(pdf, backup)
    doc = pymupdf.open(backup)
    doc.rewrite_images(dpi_threshold=130, dpi_target=100, quality=60)
    tmp = pdf.with_suffix(".tmp")
    doc.save(tmp, garbage=4, deflate=True, clean=True)
    doc.close()
    new = tmp.stat().st_size
    if new < size:
        pdf.chmod(0o644)
        tmp.replace(pdf)
        print(f"{pdf.name}: {size/1e6:.1f} MB -> {new/1e6:.1f} MB")
    else:
        tmp.unlink()
        print(f"{pdf.name}: no gain, left as is")
