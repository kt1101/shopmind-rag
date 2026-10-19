# Báo cáo cuối kỳ

| Tệp | Nội dung |
|---|---|
| `ShopMind_BaoCao_CuoiKy.docx` | Báo cáo đồ án (Word, 31 trang): 7 chương, tài liệu tham khảo, 2 phụ lục |
| `ShopMind_Slides_CuoiKy.pptx` | Slide thuyết trình (18 slide, có ghi chú cho người nói) |

Mọi con số trong báo cáo và slide được chép từ `api/reports/a1/RESULTS.md`.

## Dựng lại

Cần Python với `python-docx`, `python-pptx`, `matplotlib`, `pillow`. Bước mục lục cần Windows có Word,
`pywin32` và `pymupdf`.

```bash
cd docs/report/build
python charts.py          # biểu đồ  -> assets/*.png
python diagrams.py        # sơ đồ    -> assets/*.png
python build_report.py    # -> ../ShopMind_BaoCao_CuoiKy.docx
python build_slides.py    # -> ../ShopMind_Slides_CuoiKy.pptx
```

Ảnh chụp giao diện nằm trong `assets/screens/` (chụp từ app chạy local: 1440×900, giao diện sáng,
tiếng Việt).

**Mục lục.** `build_report.py` ghi số trang của từng đề mục từ `toc_pages.json`. Khi nội dung đổi làm
lệch trang, chạy lại theo thứ tự sau:

```bash
rm toc_pages.json && python build_report.py   # mục lục để trống
python toc_pages.py                           # Word dàn trang, ghi lại số trang
python build_report.py                        # mục lục có số trang
python toc_pages.py --check                   # kiểm tra số trang khớp
```

Nếu không có Word: mở tệp `.docx`, nhấn chuột phải vào mục lục và chọn **Update Field** (F9).
`toc_pages.py` chỉ thao tác trên một bản sao tạm và không bao giờ lưu, vì trên máy có nhãn bảo mật
Office, Word sẽ mã hoá tệp khi lưu.
