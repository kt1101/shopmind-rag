"""Page number of every heading in the report, as Microsoft Word lays it out (Windows + Word only).

usage: python docs/report/build/toc_pages.py [--check]
  1. python build_report.py      (no toc_pages.json yet: the TOC is an empty field)
  2. python toc_pages.py         Word refreshes the TOC on a temp copy, exports a PDF with heading
                                 bookmarks and writes toc_pages.json {heading: page}
  3. python build_report.py      the TOC field now carries the headings and page numbers
  4. python toc_pages.py --check compares the rebuilt document with toc_pages.json (no refresh)

Word is driven on a temp copy and never saves it, so the generated .docx is not re-saved by Office.
Needs pywin32 and pymupdf.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

import pymupdf
import win32com.client

HERE = Path(__file__).resolve().parent
DOCX = HERE.parent / "ShopMind_BaoCao_CuoiKy.docx"
PAGES = HERE / "toc_pages.json"


def heading_pages(refresh: bool) -> dict[str, int]:
    work = Path(tempfile.mkdtemp())
    copy, pdf = work / DOCX.name, work / "report.pdf"
    shutil.copy2(DOCX, copy)
    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    try:
        document = word.Documents.Open(str(copy), ReadOnly=True, AddToRecentFiles=False)
        if refresh:
            for index in range(1, document.TablesOfContents.Count + 1):
                document.TablesOfContents(index).Update()
        # 17 = PDF, 1 = wdExportCreateHeadingBookmarks
        document.ExportAsFixedFormat(str(pdf), 17, CreateBookmarks=1)
        document.Close(SaveChanges=0)
    finally:
        word.Quit()
    with pymupdf.open(pdf) as rendered:
        return {" ".join(title.split()): page for _, title, page in rendered.get_toc()}


def main() -> None:
    check = "--check" in sys.argv
    pages = heading_pages(refresh=not check)
    if not check:
        PAGES.write_text(json.dumps(pages, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{len(pages)} headings -> {PAGES}")
        return
    expected = json.loads(PAGES.read_text(encoding="utf-8"))
    moved = {title: (expected.get(title), page) for title, page in pages.items() if expected.get(title) != page}
    print("TOC page numbers match the layout" if not moved else f"moved headings: {moved}")
    sys.exit(1 if moved else 0)


if __name__ == "__main__":
    main()
