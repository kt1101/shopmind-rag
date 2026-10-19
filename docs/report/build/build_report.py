"""Final course report (Word) for ShopMind.

usage: python docs/report/build/build_report.py  ->  docs/report/ShopMind_BaoCao_CuoiKy.docx
Needs python-docx. Figures come from build/assets (charts.py, diagrams.py) and build/assets/screens
(UI screenshots). Every number is copied from api/reports/a1/RESULTS.md (metrics.json of each run).
"""
from __future__ import annotations

import json
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from docx.text.paragraph import Paragraph

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"
SCREENS = ASSETS / "screens"
OUT = HERE.parent / "ShopMind_BaoCao_CuoiKy.docx"
PAGES = HERE / "toc_pages.json"  # heading -> page, written by toc_pages.py (Word on Windows)
NAVY = RGBColor(0x15, 0x2C, 0x3C)
TEAL = RGBColor(0x08, 0x6F, 0x69)
MUTED = RGBColor(0x53, 0x67, 0x74)
FONT = "Times New Roman"

TEAM = [("Trần Văn Quang", "250104022"), ("Nguyễn Minh Thái", "250201090"), ("Trần Khoa", "250104010"), ("Đinh Ngọc Phúc", "26848170")]

doc = Document()
_counters = {"fig": 0, "tab": 0, "chapter": 0}
_toc = {}


# --- low-level helpers ------------------------------------------------------------------------

def set_cell_shading(cell, hex_fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shading = OxmlElement("w:shd")
    shading.set(qn("w:val"), "clear")
    shading.set(qn("w:color"), "auto")
    shading.set(qn("w:fill"), hex_fill)
    tc_pr.append(shading)


def field(paragraph, instruction, placeholder=""):
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = instruction
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = placeholder
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    for element in (begin, instr, separate, text, end):
        run._r.append(element)
    return run


def styles():
    normal = doc.styles["Normal"]
    normal.font.name = FONT
    normal.font.size = Pt(13)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    pf = normal.paragraph_format
    pf.space_after = Pt(6)
    pf.line_spacing = 1.3
    for level, size, color in ((1, 16, NAVY), (2, 14, NAVY), (3, 13, TEAL)):
        style = doc.styles[f"Heading {level}"]
        style.font.name = FONT
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = color
        fonts = style.element.rPr.rFonts
        for attr in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
            fonts.attrib.pop(qn(attr), None)  # theme fonts would override Times New Roman
        fonts.set(qn("w:eastAsia"), FONT)
        style.paragraph_format.space_before = Pt(18 if level == 1 else 12)
        style.paragraph_format.space_after = Pt(6)
        style.paragraph_format.keep_with_next = True
    caption = doc.styles["Caption"]
    caption.font.name = FONT
    caption.font.size = Pt(11)
    caption.font.italic = True
    caption.font.color.rgb = MUTED
    for name in ("List Bullet", "List Number"):
        doc.styles[name].font.name = FONT
        doc.styles[name].font.size = Pt(13)
    section = doc.sections[0]
    section.page_height, section.page_width = Cm(29.7), Cm(21.0)
    section.top_margin, section.bottom_margin = Cm(2.0), Cm(2.0)
    section.left_margin, section.right_margin = Cm(3.0), Cm(2.0)


def p(text="", *, bold=False, italic=False, align=None, size=None, color=None, after=None, style=None):
    paragraph = doc.add_paragraph(style=style)
    if text:
        add_rich(paragraph, text, bold=bold, italic=italic, size=size, color=color)
    if align is not None:
        paragraph.alignment = align
    elif style is None:
        paragraph.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    if after is not None:
        paragraph.paragraph_format.space_after = Pt(after)
    return paragraph


def add_rich(paragraph, text, *, bold=False, italic=False, size=None, color=None):
    """``**bold**`` and ```code``` inline markup."""
    import re

    for token in re.split(r"(\*\*[^*]+\*\*|`[^`]+`)", text):
        if not token:
            continue
        run = paragraph.add_run(token.strip("*") if token.startswith("**") else token.strip("`") if token.startswith("`") else token)
        run.bold = bold or token.startswith("**")
        run.italic = italic
        if token.startswith("`"):
            run.font.name = "Consolas"
            run.font.size = Pt(11)
        elif size:
            run.font.size = Pt(size)
        if color is not None:
            run.font.color.rgb = color


def bullets(items, style="List Bullet"):
    for item in items:
        paragraph = doc.add_paragraph(style=style)
        add_rich(paragraph, item)
        paragraph.paragraph_format.space_after = Pt(2)


def heading(text, level=1):
    if level == 1:
        _counters["chapter"] += 1
        _counters["fig"] = _counters["tab"] = 0
        doc.add_page_break()
        return doc.add_heading(f"CHƯƠNG {_counters['chapter']}. {text.upper()}", level=1)
    return doc.add_heading(text, level=level)


def caption(kind, text):
    _counters[kind] += 1
    label = "Hình" if kind == "fig" else "Bảng"
    paragraph = doc.add_paragraph(style="Caption")
    paragraph.add_run(f"{label} {_counters['chapter']}.{_counters[kind]}. {text}")
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    return paragraph


def figure(path, text, width_cm=15.5):
    path = Path(path)
    if path.exists():
        paragraph = doc.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.keep_with_next = True
        paragraph.add_run().add_picture(str(path), width=Cm(width_cm))
    else:
        p(f"[Thiếu hình: {path.name}]", italic=True, align=WD_ALIGN_PARAGRAPH.CENTER, color=MUTED)
    caption("fig", text)


def table(header, rows, widths_cm, text=None, highlight_rows=(), font_size=11):
    if text:
        cap = caption("tab", text)
        cap.paragraph_format.keep_with_next = True
    tbl = doc.add_table(rows=1, cols=len(header))
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.style = "Table Grid"
    for index, title in enumerate(header):
        cell = tbl.rows[0].cells[index]
        cell.text = ""
        run = cell.paragraphs[0].add_run(title)
        run.bold = True
        run.font.size = Pt(font_size)
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        set_cell_shading(cell, "152C3C")
    for row_index, row in enumerate(rows):
        cells = tbl.add_row().cells
        for index, value in enumerate(row):
            cells[index].text = ""
            paragraph = cells[index].paragraphs[0]
            add_rich(paragraph, str(value), size=font_size, bold=row_index in highlight_rows)
            paragraph.paragraph_format.space_after = Pt(0)
            paragraph.paragraph_format.line_spacing = 1.1
            if index and isinstance(value, (int, float)) or (isinstance(value, str) and value.replace(".", "").replace(",", "").replace(" ", "").replace("→", "").replace("ms", "").isdigit()):
                paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            if row_index in highlight_rows:
                set_cell_shading(cells[index], "E6EDE8")
    for row in tbl.rows:
        for index, width in enumerate(widths_cm):
            row.cells[index].width = Cm(width)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return tbl


def code(lines):
    for line in lines:
        paragraph = doc.add_paragraph()
        run = paragraph.add_run(line)
        run.font.name = "Consolas"
        run.font.size = Pt(10)
        paragraph.paragraph_format.space_after = Pt(0)
        paragraph.paragraph_format.line_spacing = 1.0
        paragraph.paragraph_format.left_indent = Cm(0.6)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


# --- front matter ---------------------------------------------------------------------------------

def cover():
    for text, size, bold in (("ĐẠI HỌC QUỐC GIA THÀNH PHỐ HỒ CHÍ MINH", 13, False), ("TRƯỜNG ĐẠI HỌC CÔNG NGHỆ THÔNG TIN", 14, True)):
        p(text, bold=bold, size=size, align=WD_ALIGN_PARAGRAPH.CENTER, after=0)
    p("———————————", align=WD_ALIGN_PARAGRAPH.CENTER, color=MUTED)
    for _ in range(3):
        p("")
    p("BÁO CÁO ĐỒ ÁN MÔN HỌC", bold=True, size=16, align=WD_ALIGN_PARAGRAPH.CENTER, color=TEAL, after=2)
    p("TÌM KIẾM THÔNG MINH", bold=True, size=14, align=WD_ALIGN_PARAGRAPH.CENTER, after=24)
    p("ĐỀ TÀI", size=13, align=WD_ALIGN_PARAGRAPH.CENTER, color=MUTED, after=4)
    p("SHOPMIND: HỆ THỐNG TÌM KIẾM SẢN PHẨM ĐA PHƯƠNG THỨC VÀ TRỢ LÝ MUA SẮM RAG MINH BẠCH", bold=True, size=20, align=WD_ALIGN_PARAGRAPH.CENTER, color=NAVY, after=36)
    p("Giảng viên hướng dẫn: TS. Phạm Đỗ Kim Chi", size=13, align=WD_ALIGN_PARAGRAPH.CENTER, after=12)
    p("Nhóm thực hiện: Nhóm 4", bold=True, size=13, align=WD_ALIGN_PARAGRAPH.CENTER, after=4)
    tbl = doc.add_table(rows=0, cols=2)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    for name, student_id in TEAM:
        cells = tbl.add_row().cells
        cells[0].text, cells[1].text = name, student_id
        cells[0].width, cells[1].width = Cm(6), Cm(4)
    for _ in range(5):
        p("")
    p("Thành phố Hồ Chí Minh, tháng 10 năm 2026", italic=True, align=WD_ALIGN_PARAGRAPH.CENTER)


def front_matter():
    doc.add_page_break()
    p("LỜI CẢM ƠN", bold=True, size=15, align=WD_ALIGN_PARAGRAPH.CENTER, color=NAVY)
    p("Nhóm xin chân thành cảm ơn TS. Phạm Đỗ Kim Chi đã hướng dẫn môn Tìm kiếm thông minh, đặc biệt là các góp ý về cách đánh giá hệ thống truy hồi một cách trung thực: tách tập chọn cấu hình và tập báo cáo, ghi rõ giới hạn của nhãn và không trình bày dữ liệu thử nghiệm như kết quả đã đo. Những góp ý đó định hướng toàn bộ cách nhóm xây dựng và đánh giá ShopMind.")
    p("Nhóm cũng cảm ơn nhóm tác giả bộ dữ liệu Amazon Berkeley Objects và cộng đồng mã nguồn mở (Elasticsearch, Hugging Face, FastAPI, React) đã tạo điều kiện để một hệ thống tìm kiếm hoàn chỉnh có thể được xây dựng trong phạm vi một đồ án môn học.")
    doc.add_page_break()
    p("TÓM TẮT", bold=True, size=15, align=WD_ALIGN_PARAGRAPH.CENTER, color=NAVY)
    p("ShopMind là một “cửa hàng thu nhỏ” gồm 1.500 sản phẩm của bộ dữ liệu Amazon Berkeley Objects, được xây dựng để nghiên cứu và trình diễn truy hồi thông tin (IR) đa phương thức và sinh câu trả lời tăng cường bằng truy hồi (RAG). Người mua có thể tìm bằng chữ, bằng ảnh hoặc kết hợp ảnh với chữ (“giống ảnh này nhưng màu đen”), hỏi trợ lý mua sắm, so sánh sản phẩm có trích dẫn và nhờ hệ thống lên kế hoạch mua sắm theo tình huống và ngân sách. Quản trị viên chọn thuật toán tìm kiếm, xem từng bước xử lý của mọi yêu cầu (glass-box), quản lý chính sách, chạy đánh giá và gán nhãn.")
    p("Về kỹ thuật, hệ thống dùng Elasticsearch cho BM25 và kNN, một bộ embedding chữ đa ngôn ngữ riêng (multilingual-E5) bên cạnh SigLIP2 cho ảnh, và một pipeline engine khai báo bằng YAML ghi lại trace của từng bước. Thay đổi quan trọng nhất là tách embedding chữ khỏi SigLIP2: Recall@10 của truy hồi dense tăng từ **0,0375 lên 0,55** trên benchmark A1 (BM25: 0,4875), và cấu hình hybrid được chọn trên tập DEV đạt nDCG@10 **0,7381** trên tập holdout của benchmark accuracy_v2, so với 0,6075 của cấu hình trước. Tìm kiếm kết hợp ảnh + chữ đạt nDCG@10 **0,536** so với 0,107 khi chỉ dùng ảnh. Các tối ưu khi phục vụ giảm độ trễ tìm kiếm lặp lại từ 136 ms xuống 64 ms và tính năng lên kế hoạch từ 614 ms xuống 213 ms.")
    p("Báo cáo trình bày cơ sở lý thuyết, dữ liệu, thiết kế, cài đặt, kết quả thực nghiệm và các giới hạn còn lại, trong đó nhãn đánh giá vẫn là nhãn tự sinh chưa được người duyệt và chất lượng câu trả lời của LLM chưa được đo vì thiếu khoá API trong môi trường thực nghiệm.")
    doc.add_page_break()
    p("MỤC LỤC", bold=True, size=15, align=WD_ALIGN_PARAGRAPH.CENTER, color=NAVY)
    _toc["anchor"] = doc.add_paragraph()  # filled by table_of_contents() once every heading exists


TOC_FIELD = 'TOC \\o "1-3" \\h \\z \\u'


def table_of_contents():
    """A TOC field whose cached result already lists the headings with page numbers.

    Page numbers come from toc_pages.json, written by toc_pages.py (Word lays the document out and
    reports where each heading landed); without it the field shows a hint to press F9 in Word.
    The field stays live, so Word can still refresh it.
    """
    anchor = _toc["anchor"]
    headings = [(int(par.style.name[-1]), par.text) for par in doc.paragraphs if par.style.name.startswith("Heading ")]
    pages = json.loads(PAGES.read_text(encoding="utf-8")) if PAGES.exists() else {}
    if not pages:
        field(anchor, TOC_FIELD, "Nhấn chuột phải → Update Field (F9) để tạo mục lục.")
        return
    width = doc.sections[0].page_width - doc.sections[0].left_margin - doc.sections[0].right_margin
    paragraphs = []
    for level, title in headings:
        element = OxmlElement("w:p")
        anchor._p.addprevious(element)
        paragraphs.append((Paragraph(element, anchor._parent), level, title))
    for index, (paragraph, level, title) in enumerate(paragraphs):
        fmt = paragraph.paragraph_format
        fmt.left_indent = Cm(0.6 * (level - 1))
        fmt.space_after = Pt(3)
        fmt.line_spacing = 1.15
        fmt.tab_stops.add_tab_stop(width, WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
        if index == 0:
            for kind in ("begin", "instr", "separate"):
                if kind == "instr":
                    element = OxmlElement("w:instrText")
                    element.set(qn("xml:space"), "preserve")
                    element.text = TOC_FIELD
                else:
                    element = OxmlElement("w:fldChar")
                    element.set(qn("w:fldCharType"), kind)
                paragraph.add_run()._r.append(element)
        run = paragraph.add_run(f"{title}\t{pages.get(title, '')}")
        run.bold = level == 1
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    paragraphs[-1][0].add_run()._r.append(end)
    anchor._p.getparent().remove(anchor._p)


def footer_page_numbers():
    for section in doc.sections:
        paragraph = section.footer.paragraphs[0]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        field(paragraph, "PAGE", "1")


# --- chapters ---------------------------------------------------------------------------------------

def chapter_intro():
    heading("Giới thiệu")
    heading("1.1. Bối cảnh và vấn đề", 2)
    p("Tìm kiếm là cửa ngõ của mọi cửa hàng trực tuyến: người mua không tìm được thì không mua. Tìm theo từ khoá (BM25) cho kết quả chính xác khi người dùng gõ đúng tên hoặc mã sản phẩm, nhưng kém khi họ mô tả bằng lời tự nhiên, dùng tiếng Việt cho danh mục tiếng Anh, hoặc chỉ có một tấm ảnh. Các mô hình embedding đa phương thức như SigLIP2 giải quyết được tìm bằng ảnh, còn các mô hình ngôn ngữ lớn (LLM) có thể trả lời câu hỏi về sản phẩm và chính sách — với điều kiện câu trả lời bám vào dữ liệu thật thay vì “bịa”.")
    p("Ở giai đoạn đầu (bài tập A1, A3), ShopMind đã có tìm kiếm BM25, kNN bằng SigLIP2, hợp nhất RRF và một lớp RAG trả lời từ sản phẩm, review và chính sách. Tuy nhiên đánh giá cho thấy truy hồi dense bằng chữ gần như không hoạt động (Recall@10 = 0,0125) và việc hợp nhất còn làm kết quả tệ hơn BM25. Hệ thống cũng chưa có các thành phần của một sản phẩm thực sự: cơ sở dữ liệu, trang quản trị, cơ chế giải thích kết quả.")
    heading("1.2. Mục tiêu đồ án", 2)
    bullets([
        "**Sửa lõi truy hồi:** thêm embedding chữ đa ngôn ngữ riêng để truy hồi ngữ nghĩa thực sự đóng góp, sao cho hybrid tốt hơn hoặc bằng BM25 trên benchmark.",
        "**Minh bạch (glass-box):** mọi yêu cầu tìm kiếm và RAG tạo một trace từng bước (đầu vào, đầu ra, điểm, thời gian, lý do) xem được trên giao diện.",
        "**Cấu hình thay vì sửa mã:** mô hình, thuật toán, prompt, từ điển và các bước pipeline khai báo trong YAML; quản trị viên đổi thuật toán khi hệ thống đang chạy.",
        "**Tính năng RAG có giá trị thực tế:** tìm kết hợp ảnh + chữ (F1), trợ lý hiểu ý định (F2), so sánh có trích dẫn (F3), phản hồi người dùng (F4) và lên kế hoạch mua sắm theo ngân sách (F6).",
        "**Đánh giá trung thực:** mọi con số lấy từ tệp `metrics.json` của từng lần chạy; tách tập chọn cấu hình (DEV) và tập báo cáo (holdout); ghi rõ giới hạn.",
    ])
    heading("1.3. Phạm vi", 2)
    p("Đồ án tập trung vào truy hồi và RAG trên một tập dữ liệu nhỏ, chạy được trên máy cá nhân không có GPU. Không làm thanh toán, đơn hàng thật, khuyến nghị bằng học máy, tinh chỉnh mô hình hay hệ thống đa tác tử. Giá, tồn kho và chính sách cửa hàng là **dữ liệu tổng hợp**, được gắn nhãn rõ trên giao diện và trong báo cáo.")
    heading("1.4. Đóng góp chính", 2)
    bullets([
        "Kiến trúc Clean Architecture với pipeline engine khai báo bằng YAML và trace glass-box cho mọi bước.",
        "Embedding chữ E5 tách khỏi SigLIP2: Recall@10 dense từ 0,0375 lên 0,55; hybrid linear được chọn trên DEV, holdout nDCG@10 0,7381.",
        "Tìm kết hợp ảnh + chữ có thanh trượt α; nDCG@10 0,536 so với 0,107 (chỉ ảnh) và 0,148 (chỉ chữ).",
        "Tính năng lên kế hoạch mua sắm: tách nhu cầu, truy hồi theo từng nhu cầu, tối ưu ngân sách bằng quy hoạch động (đúng tối ưu), giải thích có trích dẫn; chạy được cả khi không có LLM.",
        "Trang quản trị đầy đủ và tách vai: khách hàng không thấy thuật toán; quản trị viên chọn thuật toán, so sánh pipeline, xem trace và bản đồ embedding.",
    ])
    heading("1.5. Cấu trúc báo cáo", 2)
    p("Chương 2 trình bày cơ sở lý thuyết. Chương 3 mô tả dữ liệu và bộ đánh giá. Chương 4 phân tích và thiết kế hệ thống. Chương 5 trình bày cài đặt các chức năng. Chương 6 báo cáo thực nghiệm. Chương 7 kết luận và nêu hướng phát triển. Phụ lục hướng dẫn cài đặt và liệt kê API.")


def chapter_theory():
    heading("Cơ sở lý thuyết")
    heading("2.1. Truy hồi từ vựng BM25", 2)
    p("BM25 [2] chấm điểm tài liệu d cho truy vấn q bằng tổng đóng góp của từng từ khớp, có tính tần suất từ trong tài liệu (bão hoà theo tham số k₁), độ hiếm của từ (IDF) và chuẩn hoá theo độ dài tài liệu (tham số b). BM25 rất mạnh với tên riêng, mã sản phẩm và từ khoá chính xác, nhưng không hiểu từ đồng nghĩa hay câu mô tả và không vượt được rào cản ngôn ngữ (truy vấn tiếng Việt, tiêu đề tiếng Anh/Đức/Ý).")
    heading("2.2. Truy hồi dense bằng embedding", 2)
    p("Truy hồi dense ánh xạ truy vấn và tài liệu vào cùng một không gian vector bằng mạng hai tháp (bi-encoder) [3] và lấy các tài liệu có độ tương tự cosine cao nhất bằng tìm láng giềng gần đúng (kNN, HNSW). ShopMind dùng hai họ mô hình:")
    bullets([
        "**SigLIP2** [4][5] — mô hình ảnh–chữ huấn luyện bằng hàm mất mát sigmoid trên cặp ảnh–chú thích. Mạnh cho tìm bằng ảnh và tìm ảnh bằng chữ (cross-modal), nhưng cắt chữ ở 64 token và được tối ưu cho chú thích ảnh, không phải so khớp chữ–chữ.",
        "**multilingual-E5** [10] — mô hình embedding chữ đa ngôn ngữ, dùng tiền tố bất đối xứng `query:` / `passage:`. Phù hợp so khớp câu mô tả tiếng Việt với tiêu đề sản phẩm nhiều ngôn ngữ.",
    ])
    heading("2.3. Hợp nhất kết quả", 2)
    p("Reciprocal Rank Fusion (RRF) [6] cộng điểm 1/(k + hạngᵢ) của tài liệu trong từng danh sách (k = 60), chỉ dùng thứ hạng nên không cần chuẩn hoá điểm. ShopMind mở rộng thành RRF có trọng số Σ wᵢ/(k + hạngᵢ) và thêm **hợp nhất tuyến tính min-max**: điểm của mỗi danh sách được đưa về [0, 1] rồi cộng có trọng số. Cách thứ hai giữ được thông tin về khoảng cách điểm mà RRF bỏ qua.")
    heading("2.4. Xếp hạng lại bằng cross-encoder", 2)
    p("Cross-encoder đọc đồng thời truy vấn và tài liệu nên chính xác hơn bi-encoder, nhưng phải chạy một lần cho mỗi cặp. Vì vậy nó chỉ được dùng để sắp lại vài chục ứng viên đầu. ShopMind hỗ trợ bge-reranker-v2-m3 [11] như một bước tuỳ chọn của pipeline.")
    heading("2.5. Sinh câu trả lời tăng cường bằng truy hồi (RAG)", 2)
    p("RAG [9] truy hồi bằng chứng liên quan rồi đưa vào ngữ cảnh của LLM để sinh câu trả lời. Rủi ro chính là LLM trích dẫn sai hoặc bịa thông tin. ShopMind giảm rủi ro bằng: (1) đầu ra có cấu trúc (JSON schema) tách câu trả lời và danh sách ID trích dẫn; (2) kiểm tra mọi ID trích dẫn phải nằm trong đúng ngữ cảnh đã gửi, sai thì yêu cầu sinh lại một lần kèm phản hồi; (3) không có bằng chứng thì từ chối trả lời (`insufficient_evidence`); (4) chỉ dẫn coi bằng chứng là dữ liệu, không phải mệnh lệnh, để chống prompt injection.")
    heading("2.6. Tìm kiếm kết hợp ảnh + chữ", 2)
    p("Bài toán composed image retrieval [12] tìm sản phẩm “giống ảnh này nhưng có thuộc tính khác”. Vì SigLIP2 đặt ảnh và chữ trong cùng không gian, ShopMind dùng cách kết hợp đơn giản q = normalize(α·e_ảnh + (1−α)·e_chữ), sau đó tăng nhẹ điểm cho sản phẩm có thuộc tính màu khớp với chữ.")
    heading("2.7. Độ đo đánh giá", 2)
    bullets([
        "**Recall@10:** tỉ lệ tài liệu liên quan nằm trong 10 kết quả đầu.",
        "**nDCG@10** [7]: lợi ích tích luỹ có chiết khấu theo hạng, chuẩn hoá về [0, 1]; dùng nhãn nhiều mức (0/1/2).",
        "**MRR@10:** nghịch đảo hạng của kết quả liên quan đầu tiên.",
    ])


def chapter_data():
    heading("Dữ liệu và bộ đánh giá")
    heading("3.1. Tập sản phẩm", 2)
    p("Tập dữ liệu là một tập con xác định (seed 42) gồm **1.500 sản phẩm** của Amazon Berkeley Objects [1], trải trên **215 danh mục**, tối đa 150 sản phẩm mỗi danh mục, mỗi sản phẩm có một ảnh chính (cạnh dài 256 px). Mỗi bản ghi theo một lược đồ chuẩn: mã sản phẩm, tiêu đề, mô tả, thương hiệu, danh mục, thuộc tính (màu, chất liệu…), đường dẫn ảnh và trường `search_text`. Tiêu đề có nhiều ngôn ngữ (Anh, Đức, Ý, Tây Ban Nha, Hà Lan, Nhật…), tạo thách thức thật cho truy hồi.")
    p("Dữ liệu được tải và sinh cục bộ bởi script, không phân phối lại trong repo. Nhóm áp dụng cách hiểu thận trọng giấy phép CC BY-NC 4.0, chỉ dùng cho mục đích học thuật. Tệp sản phẩm được ghi với ký tự xuống dòng LF và đường dẫn dạng POSIX để mã băm sha256 trùng khớp trên mọi hệ điều hành (mã băm này được benchmark ghim lại).")
    table(["Thành phần", "Mô tả", "Quy mô"], [
        ["Sản phẩm ABO", "Tiêu đề, mô tả, thương hiệu, danh mục, thuộc tính, ảnh", "1.500 sản phẩm, 215 danh mục"],
        ["Chính sách cửa hàng", "Đổi trả, hoàn tiền, giao hàng, bảo hành, thanh toán, quyền riêng tư (thử nghiệm)", "6 mục"],
        ["Giá và tồn kho", "Sinh xác định theo mã sản phẩm, dải giá theo loại hàng, gắn cờ `synthetic`", "1.500 bản ghi"],
        ["Review Amazon", "Hỗ trợ trong pipeline, người dùng tự cung cấp dữ liệu", "không dùng trong thực nghiệm"],
    ], [4.0, 8.0, 4.0], "Các nguồn dữ liệu của ShopMind")
    heading("3.2. Embedding và chỉ mục", 2)
    p("Mỗi sản phẩm được mã hoá một lần, ngoại tuyến, thành ba vector 768 chiều: `text_vector` (E5, từ văn bản sinh theo mẫu tiêu đề + thương hiệu + danh mục + màu + chất liệu + thuộc tính + mô tả rút gọn), `image_vector` (SigLIP2 ảnh) và `siglip_text_vector` (SigLIP2 chữ, giữ lại để so sánh). Chỉ mục Elasticsearch được đánh phiên bản (`products_a1_1500_vN`); ứng dụng chỉ đọc alias `products`. Trước khi chuyển alias, script kiểm tra số tài liệu, số chiều từng trường vector, một truy vấn BM25 và một truy vấn kNN mẫu. Mapping lưu “danh tính” embedding (mô hình, phiên bản, tiền xử lý) của từng trường; khi chạy, hệ thống từ chối truy vấn một chỉ mục được mã hoá bằng mô hình khác.")
    heading("3.3. Bộ đánh giá", 2)
    table(["Benchmark", "Nội dung", "Nhãn", "Dùng để"], [
        ["A1 (seed 42)", "100 truy vấn: 80 chữ (exact, semantic, hard negative; Anh/Việt) + 20 ảnh biến đổi", "Nhãn seed 0/1/2, chưa người duyệt", "Ablation các phương pháp truy hồi"],
        ["accuracy_v2", "160 truy vấn từ vị từ metadata (danh mục, thương hiệu, màu, mã); 130 DEV, 30 holdout với danh mục tách biệt", "Vị từ metadata đầy đủ positive", "Chọn cấu hình trên DEV, báo cáo holdout"],
        ["F1 compose", "40 truy vấn: ảnh sản phẩm A + màu của sản phẩm B cùng danh mục", "Tổng hợp từ metadata", "So sánh chỉ ảnh / chỉ chữ / kết hợp"],
    ], [2.6, 6.4, 3.6, 3.4], "Các benchmark được sử dụng")
    p("Một giới hạn quan trọng: tất cả nhãn đều tự sinh từ metadata, chưa qua người duyệt độc lập. Hệ thống đã có trang gán nhãn và tính hệ số đồng thuận Cohen’s kappa để hoàn thiện việc này; các con số trong báo cáo vì vậy chỉ mang tính so sánh tương đối giữa các cấu hình.")


def chapter_design():
    heading("Phân tích và thiết kế hệ thống")
    heading("4.1. Yêu cầu", 2)
    table(["Nhóm", "Yêu cầu chính"], [
        ["Khách hàng", "Tìm bằng chữ, ảnh, ảnh + chữ; gợi ý khi gõ; bộ lọc có đếm; trang sản phẩm; hỏi trợ lý; so sánh; lên kế hoạch mua sắm; yêu thích, giỏ hàng; đánh giá 👍/👎"],
        ["Quản trị viên", "Đăng nhập; chọn thuật toán tìm kiếm cho cửa hàng; sửa cấu hình nóng + quay lại; xem trace; so sánh pipeline; bản đồ embedding; quản lý chỉ mục, job, chính sách; chạy đánh giá; gán nhãn"],
        ["Phi chức năng", "Không lộ vector/ảnh trong log và trace; giới hạn tần suất cho RAG/chat; chạy khi không có LLM; mọi lỗi trả JSON thống nhất; độ trễ tìm kiếm dưới 200 ms trên CPU"],
    ], [3.2, 12.8], "Tóm tắt yêu cầu")
    heading("4.2. Kiến trúc tổng thể", 2)
    p("Hệ thống là một monorepo gồm backend FastAPI (`api/`) và giao diện React + Vite (`ui/`). Backend theo Clean Architecture: tầng `domain` không phụ thuộc framework; tầng `application` chứa các use case (tìm kiếm, RAG, chat, so sánh, lên kế hoạch, quản trị); tầng `infrastructure` hiện thực các cổng (Elasticsearch, mô hình embedding, LLM, cơ sở dữ liệu); tầng `interfaces/http` là router, schema và SSE. `bootstrap/wiring` là nơi duy nhất lắp ráp các thành phần: mỗi phân hệ có một module wiring tự được phát hiện, lỗi ở phân hệ không thiết yếu không làm sập ứng dụng (`/health` vẫn sống, `/ready` báo từng thành phần).")
    figure(ASSETS / "architecture.png", "Kiến trúc tổng thể của ShopMind")
    heading("4.3. Pipeline engine và cấu hình", 2)
    p("Mỗi chế độ tìm kiếm là một pipeline khai báo trong `configs/pipelines/search.yaml`: danh sách bước, mỗi bước gồm loại bước, cài đặt (impl), tham số và điều kiện. Cài đặt được đăng ký vào registry bằng decorator; thêm một thuật toán mới chỉ cần một lớp, một dòng đăng ký và vài dòng YAML. Các bước `retrieve` liền nhau chạy song song và được hợp lại theo đúng thứ tự khai báo, nên kết quả và trace giống hệt khi chạy tuần tự.")
    code([
        "search.hybrid_linear:",
        "  steps:",
        "    - { step: query_understanding, impl: rules }",
        "    - { step: retrieve, id: lexical,  impl: bm25 }",
        "    - { step: retrieve, id: semantic, impl: dense, params: { field: text_vector } }",
        "    - { step: fuse, impl: linear, params: { weights: [0.5, 0.5] } }",
    ])
    p("Cấu hình được phân lớp: `configs/app.yaml` (và các tệp include theo phân hệ) → hồ sơ `dev/demo/eval` → biến môi trường → hồ sơ do quản trị viên lưu trong cơ sở dữ liệu. Mọi mô hình cấu hình dùng `extra=\"forbid\"`; chỉ các khoá được khai báo “hot-reloadable” mới sửa được khi chạy, và khi lưu, hệ thống kiểm tra thêm rằng mọi bước pipeline có cài đặt tồn tại và mọi giá trị mặc định trỏ tới một pipeline hợp lệ.")
    heading("4.4. Glass-box trace", 2)
    p("Mỗi bước pipeline chạy trong một ngữ cảnh `trace_step` ghi lại: tên bước, cài đặt, tham số, thời điểm bắt đầu, thời lượng, tóm tắt, ghi chú, các mục đầu ra (tối đa 20) và chi tiết riêng (truy vấn ES, từ khoá khớp, đóng góp RRF/linear kèm công thức, kích thước và chuẩn của vector truy vấn). Hàm `sanitize` loại mọi khoá chứa vector, ảnh hoặc bí mật, chỉ giữ tóm tắt `{dims, norm}`. Trace được lưu vào cơ sở dữ liệu với mã bằng mã yêu cầu, và trả kèm phản hồi khi yêu cầu có `explain: true`.")
    figure(ASSETS / "search_pipeline.png", "Pipeline tìm kiếm hybrid và các bước được ghi trace")
    heading("4.5. Cơ sở dữ liệu", 2)
    p("Elasticsearch là kho đọc cho tìm kiếm; PostgreSQL (SQLite khi phát triển) là hệ thống ghi nhận cho mọi thứ khác, quản lý bằng SQLAlchemy 2 và Alembic.")
    table(["Bảng", "Nội dung"], [
        ["users", "Tài khoản admin/annotator, mật khẩu bcrypt, vai trò, trạng thái hoạt động"],
        ["chat_sessions, chat_messages", "Lịch sử hội thoại theo phiên do máy chủ cấp mã"],
        ["search_events, click_events", "Truy vấn, pipeline, độ trễ, số kết quả, lượt nhấp (không lưu vector/ảnh)"],
        ["pipeline_traces", "Trace JSON theo mã yêu cầu, có thời hạn lưu"],
        ["feedback, relevance_judgments", "👍/👎 và nhãn relevance → xuất qrels, tính kappa"],
        ["config_profiles", "Các phiên bản cấu hình nóng, ai sửa, khi nào, kích hoạt/quay lại"],
        ["policies, products_overlay", "CMS chính sách (nháp/xuất bản); giá và tồn kho tổng hợp"],
        ["jobs, eval_runs", "Job nền (reindex, đánh giá, bản đồ embedding) và kết quả đánh giá"],
    ], [5.0, 11.0], "Các bảng chính trong cơ sở dữ liệu")
    heading("4.6. Giao diện và phân vai", 2)
    p("Giao diện được tách theo vai: cửa hàng chỉ có chức năng mua sắm, không có lựa chọn thuật toán; tìm kiếm của khách chạy pipeline mặc định do quản trị viên đặt (`defaults.search`). Các công cụ kỹ thuật (Search Inspector, RAG Inspector, trace) chỉ hiện khi đăng nhập quản trị, với nhãn “Chế độ quản trị” trên đầu trang. Trang quản trị chia hai nhóm: Vận hành (dashboard, cấu hình, chỉ mục và job, chính sách, phản hồi) và Glass-box & lab (trace, Search Playground, bản đồ embedding, đánh giá, gán nhãn).")


def chapter_impl():
    heading("Cài đặt các chức năng")
    heading("5.1. Tìm kiếm bằng chữ", 2)
    p("Bước `query_understanding` phát hiện ngôn ngữ, chuẩn hoá truy vấn bằng từ điển YAML (danh từ sản phẩm tiếng Việt → danh mục, màu sắc nhiều ngôn ngữ → màu chuẩn, chất liệu → từ khoá tiếng Anh) và giải bộ lọc theo danh mục thực tế: khớp chính xác trước, chỉ dùng khớp chuỗi con khi giá trị không tồn tại, và không bao giờ nới rộng một bộ lọc đã khớp chính xác. BM25 và kNN trên `text_vector` chạy song song; kết quả được hợp nhất tuyến tính (mặc định) hoặc RRF. Chế độ adaptive dùng một luật đơn giản: truy vấn giống mã sản phẩm → BM25, câu mô tả → dense, còn lại → hybrid.")
    figure(SCREENS / "search.png", "Trang kết quả tìm kiếm với bộ lọc có đếm và gợi ý “Hệ thống hiểu”")
    figure(SCREENS / "inspector_ranking.png", "Search Inspector (chế độ quản trị): thứ hạng của từng sản phẩm qua BM25, dense và bước hợp nhất")
    figure(SCREENS / "product.png", "Trang sản phẩm: giá và tồn kho tổng hợp có gắn nhãn, ô hỏi đáp có trích dẫn")
    heading("5.2. Tìm bằng ảnh và kết hợp ảnh + chữ (F1)", 2)
    p("Ảnh tải lên được kiểm tra kiểu, kích thước tệp và số điểm ảnh (từ chối ảnh quá 40 triệu điểm ảnh trước khi giải nén), thu nhỏ còn tối đa 1024 px rồi mã hoá bằng SigLIP2. Với tìm kết hợp, bước `compose_query` tính q = normalize(α·e_ảnh + (1−α)·e_chữ); bước `rerank.attribute_boost` tăng điểm cho sản phẩm có màu khớp với chữ (“màu đen”, “nero”, “black” đều quy về `black`). Thanh trượt α trên giao diện chạy lại truy vấn; nhờ bộ nhớ đệm embedding theo mã băm điểm ảnh, ảnh không phải mã hoá lại.")
    figure(SCREENS / "compose.png", "Tìm kết hợp ảnh + chữ với thanh trượt α")
    heading("5.3. Trợ lý mua sắm (F2) và RAG", 2)
    p("Mỗi tin nhắn đi qua bước định tuyến ý định: chào hỏi, tìm sản phẩm, hỏi về sản phẩm, hỏi chính sách, so sánh, hoặc lên kế hoạch mua sắm. Tìm sản phẩm được trả lời ngay bằng thẻ sản phẩm (không cần LLM), kèm phần “Mình đã hiểu” liệt kê bộ lọc trích ra. Câu hỏi đi qua viết lại câu hỏi độc lập (khi có lịch sử) rồi RAG đa nguồn: truy hồi sản phẩm, review và chính sách → hợp nhất RRF → (tuỳ chọn) cross-encoder → dựng ngữ cảnh theo ngân sách ký tự cho từng nguồn → sinh câu trả lời có cấu trúc → kiểm tra trích dẫn. Câu trả lời được stream qua SSE với các sự kiện `meta`, `step`, `products`, `delta`, `done`.")
    figure(ASSETS / "rag_flow.png", "Luồng RAG và kiểm tra trích dẫn", 12.5)
    figure(SCREENS / "chat.png", "Trợ lý mua sắm trả lời bằng thẻ sản phẩm")
    heading("5.4. So sánh sản phẩm có trích dẫn (F3)", 2)
    p("Bảng thuộc tính lấy thẳng từ dữ liệu, không qua LLM; ô thiếu dữ liệu ghi “Không có dữ liệu”. Phần nhận xét do RAG sinh trên ngữ cảnh gồm thông tin từng sản phẩm, review và chính sách; mỗi nhận định phải trích ít nhất một ID có trong ngữ cảnh, nếu không sẽ bị từ chối và sinh lại. Khi không có LLM, trang vẫn hiện bảng thuộc tính và giải thích rõ lý do.")
    figure(SCREENS / "compare.png", "Trang so sánh: bảng thuộc tính từ dữ liệu và phần nhận xét RAG")
    heading("5.5. Lên kế hoạch mua sắm theo nhu cầu (F6)", 2)
    p("Đây là tính năng RAG chính được bổ sung trong giai đoạn cuối. Người dùng mô tả tình huống và ngân sách, ví dụ “Mình mới chuyển vào căn hộ studio, ngân sách 800 đô”. Hệ thống:")
    bullets([
        "**Tách nhu cầu (decompose):** LLM trả về danh sách nhu cầu với nhãn, truy vấn ngắn, danh mục (chỉ được chọn từ danh mục có thật) và mức ưu tiên (cần thiết / nếu dư ngân sách). Khi không có LLM, hệ thống dùng thư viện tình huống trong `configs/vocab/occasions.yaml` (dọn nhà, du lịch, góc làm việc, quà tặng, thú cưng, đồ bếp, tập luyện) hoặc tách theo danh sách người dùng liệt kê.",
        "**Đọc ngân sách:** hiểu “800 đô”, “$1,234.50”, “2.500 đô”, “2 triệu” (quy đổi xấp xỉ), và không nhầm “khoảng 5 ngày” là ngân sách.",
        "**Truy hồi theo từng nhu cầu** qua pipeline tìm kiếm mặc định, có lọc danh mục (nới lỏng khi không có kết quả), ghép giá và tồn kho tổng hợp.",
        "**Tối ưu ngân sách:** chọn tối đa một sản phẩm còn hàng cho mỗi nhu cầu để cực đại tổng tiện ích = trọng số ưu tiên × (0,6 + 0,4 × độ liên quan chuẩn hoá) với tổng giá ≤ ngân sách. Bài toán là biến thể của bài toán cái túi nhiều lựa chọn, giải đúng tối ưu bằng quy hoạch động theo đơn vị đô la (độ phức tạp O(số nhu cầu × ngân sách × số ứng viên)); kết quả được kiểm chứng bằng vét cạn trong kiểm thử.",
        "**Giải thích:** LLM viết lý do cho từng món và mẹo về đổi trả, giao hàng, mỗi ý phải trích ID có trong ngữ cảnh; nếu không đạt, hệ thống dùng lý do trích xuất trực tiếp từ dữ liệu sản phẩm và chính sách.",
    ])
    figure(ASSETS / "planner_flow.png", "Luồng xử lý của tính năng lên kế hoạch mua sắm")
    figure(SCREENS / "planner.png", "Trang lên kế hoạch mua sắm: thanh ngân sách, món được chọn, lý do có trích dẫn")
    heading("5.6. Trang quản trị", 2)
    p("Quản trị viên đăng nhập bằng JWT (mật khẩu bcrypt, token được đối chiếu lại với tài khoản còn hoạt động, đăng nhập bị giới hạn tần suất). Thẻ “Thuật toán tìm kiếm của cửa hàng” cho phép chọn pipeline mặc định; thay đổi có hiệu lực ngay (hot reload) và có thể quay lại hồ sơ cũ. Search Playground chạy cùng truy vấn trên hai pipeline, hiện overlap@10 và mở Inspector cho từng bên. Trace Explorer tìm và mở lại mọi trace. Policy CMS cho phép sửa chính sách và xuất bản, kích hoạt job tạo chỉ mục phiên bản mới và chuyển alias; truy hồi đi theo alias nên chính sách mới được dùng ngay mà không cần khởi động lại.")
    figure(SCREENS / "admin_dashboard.png", "Dashboard quản trị: lượt tìm kiếm, chat, tỉ lệ không có kết quả, độ trễ theo pipeline")
    figure(SCREENS / "admin_config.png", "Trang cấu hình: chọn thuật toán tìm kiếm cho cửa hàng, có lịch sử và quay lại")
    figure(SCREENS / "playground.png", "Search Playground: so sánh hai pipeline trên cùng truy vấn")
    figure(SCREENS / "embedding_map.png", "Bản đồ embedding 2D (PCA) của 1.500 sản phẩm, tô màu theo danh mục")
    heading("5.7. Hiệu năng và độ bền", 2)
    bullets([
        "Bộ nhớ đệm LRU cho embedding truy vấn và ảnh (khoá theo mã băm điểm ảnh), cho kết quả phân giải bộ lọc và mapping chỉ mục.",
        "Các bước truy hồi độc lập chạy song song; tìm bằng ảnh chạy ngoài event loop nên không làm treo các yêu cầu khác.",
        "Mọi lỗi trả JSON `{error: {code, message}, request_id}`; giới hạn kích thước đầu vào (top_k, bộ lọc, ảnh); mã yêu cầu do khách gửi được kiểm tra định dạng.",
    ])


def chapter_experiments():
    heading("Thực nghiệm và đánh giá")
    heading("6.1. Thiết lập", 2)
    p("Mọi thực nghiệm chạy trên laptop CPU (không GPU), Elasticsearch 8.15 cục bộ, hồ sơ cấu hình `eval`. Mỗi lần chạy ghi một thư mục `runs/<thời điểm>_<tên>/` gồm cấu hình, `metrics.json`, kết quả từng truy vấn, lỗi và tóm tắt; mọi con số dưới đây được chép từ các tệp `metrics.json` đó (xem `api/reports/a1/RESULTS.md`).")
    heading("6.2. Ablation trên benchmark A1", 2)
    table(["Cấu hình", "Recall@10", "nDCG@10", "MRR@10", "p95 (ms)"], [
        ["BM25", "0,4875", "0,3632", "0,3265", "64"],
        ["Dense E5 (mới)", "0,5500", "0,4424", "0,4091", "115"],
        ["Dense SigLIP2 chữ (cũ)", "0,0375", "0,0375", "0,0375", "276"],
        ["Cross-modal chữ → ảnh", "0,2125", "0,1229", "0,0963", "309"],
        ["BM25 + dense, không hợp nhất", "0,5000", "0,3711", "0,3327", "254"],
        ["Hybrid RRF", "0,5000", "0,4051", "0,3739", "226"],
        ["Hybrid RRF trọng số 1/0,5", "0,5125", "0,4037", "0,3697", "231"],
        ["Hybrid linear (mặc định)", "0,5875", "0,4470", "0,4027", "294"],
        ["Lexical-preserving (production cũ)", "0,5000", "0,3711", "0,3327", "299"],
        ["Adaptive", "0,5625", "0,4517", "0,4171", "230"],
    ], [6.2, 2.4, 2.4, 2.4, 2.4], "Kết quả trên 80 truy vấn chữ của benchmark A1", highlight_rows=(1, 7))
    figure(ASSETS / "dense_before_after.png", "Recall@10: tác động của embedding chữ riêng", 13.5)
    p("Kết quả xác nhận chẩn đoán ban đầu: SigLIP2 không phù hợp để so khớp chữ–chữ (Recall@10 chỉ 0,0375), còn E5 với cùng pipeline đạt 0,55 và vượt BM25 (0,4875). Trên nhóm truy vấn ngữ nghĩa, dense đạt Recall@10 0,4857 so với 0,4571 của BM25, đạt tiêu chí của kế hoạch. Mọi cấu hình hybrid đều ≥ BM25; hợp nhất tuyến tính tốt nhất về Recall@10 (0,5875) nhờ giữ thông tin khoảng cách điểm.")
    heading("6.3. Chọn cấu hình trên DEV, báo cáo trên holdout", 2)
    p("Để tránh “chọn theo đề thi”, cấu hình mặc định của chế độ hybrid được chọn duy nhất dựa trên tập DEV (130 truy vấn) của benchmark accuracy_v2, sau đó đọc kết quả một lần trên holdout (30 truy vấn, danh mục tách biệt).")
    table(["Cấu hình", "DEV nDCG@10", "Holdout nDCG@10", "Holdout Recall@10"], [
        ["BM25", "0,6636", "0,6075", "0,6667"],
        ["Dense E5", "0,4298", "0,3151", "0,3500"],
        ["Hybrid RRF", "0,7312", "0,6720", "0,7667"],
        ["Hybrid linear (được chọn)", "0,7773", "0,6961", "0,8000"],
        ["Lexical-preserving (production cũ)", "0,6636", "0,6075", "0,6667"],
        ["Adaptive", "0,6481", "0,7151", "0,7500"],
    ], [6.4, 3.2, 3.2, 3.2], "Benchmark accuracy_v2", highlight_rows=(3,))
    figure(ASSETS / "accuracy_v2.png", "nDCG@10 trên DEV (dùng để chọn) và holdout (chỉ đọc)")
    p("Hybrid linear có nDCG@10 DEV cao nhất nên được chọn; trên holdout nó tăng +0,0886 so với cấu hình production trước đó. Adaptive cao hơn trên holdout nhưng thấp hơn trên DEV; chọn nó sẽ là dùng holdout để chọn cấu hình, nên nhóm không làm vậy.")
    heading("6.4. Mở rộng từ điển tiếng Việt", 2)
    p("Sau khi chọn cấu hình, nhóm bổ sung từ điển tổng quát (danh từ sản phẩm phổ biến, chất liệu, sáu màu còn thiếu như nâu, vàng, bạc), được viết dựa trên danh mục của catalog chứ không dựa trên truy vấn benchmark. Kết quả DEV của mọi cấu hình không đổi, nên lựa chọn ở mục 6.3 vẫn giữ nguyên. Holdout (đã được đọc một lần trước đó) tăng từ 0,6961 lên 0,7381 với cấu hình mặc định; truy vấn tiếng Việt tăng từ 0,6073 lên 0,6283.")
    figure(ASSETS / "vocab_holdout.png", "nDCG@10 holdout trước và sau khi mở rộng từ điển", 11.5)
    heading("6.5. Tìm bằng ảnh và tìm kết hợp (F1)", 2)
    p("Tìm bằng ảnh đạt Recall@10 = nDCG@10 = MRR@10 = 1,0 trên 20 ảnh truy vấn đã biến đổi (cắt, thu phóng, đổi tương phản, nén JPEG) — đây là bài toán dễ vì ảnh truy vấn bắt nguồn từ ảnh trong catalog. Với tìm kết hợp:")
    table(["Chế độ", "Recall@10", "nDCG@10", "MRR@10", "B trong top 10"], [
        ["Chỉ ảnh", "0,1996", "0,1065", "0,1089", "0,200"],
        ["Chỉ chữ (màu)", "0,2328", "0,1484", "0,2173", "0,175"],
        ["Chữ: màu + danh mục", "0,4869", "0,4039", "0,5508", "0,425"],
        ["Ảnh + chữ, α = 0,7", "0,5320", "0,3762", "0,3617", "0,575"],
        ["Ảnh + chữ, α = 0,5", "0,6077", "0,4390", "0,4582", "0,625"],
        ["Ảnh + chữ, α = 0,3", "0,7207", "0,5360", "0,6288", "0,700"],
    ], [5.2, 2.6, 2.6, 2.6, 3.0], "Benchmark F1 (40 truy vấn, nhãn tổng hợp)", highlight_rows=(5,))
    p("Mọi mức α đều vượt cả hai phương thức đơn lẻ và vượt cả truy vấn chữ có nêu danh mục. Vì α được so sánh trên chính tập tổng hợp này, giá trị mặc định được đặt ở 0,5 thay vì giá trị tốt nhất 0,3, và giao diện cho phép người dùng tự điều chỉnh.")
    heading("6.6. Độ trễ phục vụ", 2)
    figure(ASSETS / "latency.png", "Trung vị độ trễ trước và sau các tối ưu khi phục vụ")
    p("Truy vấn mới vẫn mất khoảng 179 ms vì phải mã hoá bằng E5 trên CPU; truy vấn lặp lại (phân trang, Inspector chạy lại) giảm còn 64 ms, tìm có bộ lọc còn 16 ms, kéo thanh α còn 68 ms và lên kế hoạch mua sắm còn 213 ms.")
    heading("6.7. Kiểm thử và đảm bảo chất lượng", 2)
    bullets([
        "523 kiểm thử backend (đơn vị, API, đánh giá, RAG, nền tảng, tích hợp với Elasticsearch thật) và 235 kiểm thử logic giao diện, đều đạt; ruff và kiểm tra “không hard-code tên chỉ mục/mô hình” chạy trong CI.",
        "Kiểm thử chống prompt injection: bằng chứng chứa chỉ dẫn độc hại vẫn chỉ nằm trong khối dữ liệu JSON; trích dẫn ID ngoài ngữ cảnh bị từ chối.",
        "Một lượt rà soát mã độc lập tìm được 14 lỗi (đọc sai ngân sách, ảnh “bom giải nén”, chỉ mục bị ghim sau khi đổi alias, gọi pipeline ẩn, lỗi 500 không đúng định dạng…); tất cả đã được sửa kèm kiểm thử hồi quy.",
        "Một lượt rà soát giao diện (desktop và điện thoại, sáng/tối, tiếng Việt/tiếng Anh): thông báo lỗi bằng lời dễ hiểu thay vì mã lỗi, trang quản trị chuyển sang tiếng Việt, tên danh mục được Việt hoá, sửa lỗi focus bàn phím và trình đọc màn hình.",
        "Smoke test đầu–cuối trên hệ thống thật: 45 kiểm tra API và 42 bước duyệt giao diện bằng Chrome headless, không có lỗi console.",
    ])
    heading("6.8. Thảo luận và giới hạn", 2)
    bullets([
        "**Nhãn chưa được người duyệt:** mọi benchmark dùng nhãn tự sinh; các chênh lệch nhỏ (vài phần trăm) chưa được kiểm định thống kê.",
        "**Chất lượng câu trả lời của LLM chưa đo:** môi trường thực nghiệm không có khoá API; các độ đo faithfulness, độ chính xác trích dẫn trên câu trả lời thật vẫn để trống thay vì ước lượng.",
        "**Cross-encoder chưa có số đo:** trên CPU, bge-reranker-v2-m3 mất hơn 100 giây cho mỗi truy vấn; lần chạy 80 truy vấn bị dừng sau 2 giờ 15 phút.",
        "**Tiếng Việt vẫn là điểm yếu:** Recall@10 cao nhất cho truy vấn tiếng Việt trên A1 chỉ 0,3143 do tiêu đề sản phẩm đa ngôn ngữ và từ điển còn nhỏ.",
        "**Dữ liệu thương mại là tổng hợp:** giá, tồn kho, chính sách chỉ phục vụ trình diễn.",
    ])


def chapter_conclusion():
    heading("Kết luận và hướng phát triển")
    heading("7.1. Kết luận", 2)
    p("Đồ án đã đưa ShopMind từ một bản demo truy hồi + RAG thành một sản phẩm thu nhỏ hoàn chỉnh: có cửa hàng cho khách, trang quản trị, cơ sở dữ liệu, cấu hình nóng, trace minh bạch cho mọi bước và bộ đánh giá tái lập được. Thay đổi kỹ thuật quan trọng nhất — tách embedding chữ khỏi SigLIP2 — biến truy hồi dense từ gần như vô dụng thành thành phần tốt nhất, giúp hybrid vượt BM25 cả trên A1 lẫn trên holdout của accuracy_v2. Các tính năng RAG (trợ lý, so sánh, lên kế hoạch mua sắm) đều giữ nguyên tắc chỉ khẳng định điều có bằng chứng, và vẫn hoạt động hữu ích khi không có LLM.")
    heading("7.2. Hướng phát triển", 2)
    bullets([
        "Hoàn tất gán nhãn có người duyệt bằng trang Annotation, báo cáo hệ số kappa và kiểm định thống kê.",
        "Đo chất lượng câu trả lời RAG bằng LLM-as-judge (mô hình chấm khác mô hình sinh) và đối chiếu 30 câu bằng người.",
        "Đo cross-encoder trên GPU hoặc dùng mô hình nhỏ hơn; thử học trọng số hợp nhất từ dữ liệu nhấp chuột.",
        "Mở rộng từ điển và thử mô hình embedding mạnh hơn cho tiếng Việt (ví dụ BGE-M3).",
        "Chuyển giao diện sang TypeScript và sinh client từ OpenAPI; kiểm thử thành phần giao diện.",
    ])


def references():
    doc.add_page_break()
    doc.add_heading("TÀI LIỆU THAM KHẢO", level=1)
    refs = [
        "J. Collins et al., “ABO: Dataset and Benchmarks for Real-World 3D Object Understanding,” CVPR, 2022.",
        "S. Robertson and H. Zaragoza, “The Probabilistic Relevance Framework: BM25 and Beyond,” Foundations and Trends in Information Retrieval, 2009.",
        "V. Karpukhin et al., “Dense Passage Retrieval for Open-Domain Question Answering,” EMNLP, 2020.",
        "X. Zhai, B. Mustafa, A. Kolesnikov, L. Beyer, “Sigmoid Loss for Language Image Pre-Training,” ICCV, 2023.",
        "M. Tschannen et al., “SigLIP 2: Multilingual Vision-Language Encoders with Improved Semantic Understanding, Localization, and Dense Features,” arXiv:2502.14786, 2025.",
        "G. V. Cormack, C. L. A. Clarke, S. Büttcher, “Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods,” SIGIR, 2009.",
        "K. Järvelin and J. Kekäläinen, “Cumulated Gain-Based Evaluation of IR Techniques,” ACM TOIS, 2002.",
        "N. Thakur et al., “BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models,” NeurIPS Datasets and Benchmarks, 2021.",
        "P. Lewis et al., “Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks,” NeurIPS, 2020.",
        "L. Wang et al., “Multilingual E5 Text Embeddings: A Technical Report,” arXiv:2402.05672, 2024.",
        "J. Chen et al., “BGE M3-Embedding: Multi-Lingual, Multi-Functionality, Multi-Granularity Text Embeddings Through Self-Knowledge Distillation,” arXiv:2402.03216, 2024.",
        "N. Vo et al., “Composing Text and Image for Image Retrieval – An Empirical Odyssey,” CVPR, 2019.",
    ]
    for index, ref in enumerate(refs, start=1):
        paragraph = p(f"[{index}] {ref}", after=4)
        paragraph.paragraph_format.left_indent = Cm(0.9)
        paragraph.paragraph_format.first_line_indent = Cm(-0.9)


def appendix():
    doc.add_page_break()
    doc.add_heading("PHỤ LỤC A. HƯỚNG DẪN CÀI ĐẶT VÀ CHẠY", level=1)
    p("Yêu cầu: Python 3.11+, Node 22+, Elasticsearch 8.15 (hoặc Docker), khoảng 10 GB đĩa. Không cần GPU. Khoá OpenAI là tuỳ chọn: thiếu khoá thì tìm kiếm, trợ lý tìm sản phẩm, bảng so sánh, lên kế hoạch và toàn bộ trang quản trị vẫn chạy.")
    code([
        "# Docker (đầy đủ):  cp .env.example .env && make setup && make up && make seed",
        "# Không Docker (Windows/Linux):",
        "cd api && python -m venv .venv && .venv/Scripts/python -m pip install -e \".[dev,text-embed,viz]\"",
        "python -m scripts.prepare_a1_abo_subset --output data/a1_abo_1500 --limit 1500 --seed 42 --force",
        "python -m scripts.generate_embeddings ... --device cpu            # SigLIP2",
        "python -m scripts.generate_embeddings ... --embedder text_e5      # E5",
        "make index embedding-map index-policies && python -m scripts.seed_demo",
        "make dev-api   # http://127.0.0.1:8000      make dev-ui   # http://localhost:5173",
    ])
    p("Tài khoản quản trị mặc định ở hồ sơ dev: admin / admin. Kịch bản demo chi tiết nằm trong `docs/DEMO_SCRIPT.md`.")
    doc.add_heading("PHỤ LỤC B. CÁC API CHÍNH", level=1)
    _counters.update(chapter="B", tab=0)  # appendix tables are numbered B.n
    table(["Nhóm", "Endpoint"], [
        ["Sức khoẻ", "GET /health, GET /ready (trạng thái từng thành phần)"],
        ["Tìm kiếm", "POST /search/text, /search/image, /search/compose, /search/facets, /search/understand; GET /search/suggest, /search/filter-options"],
        ["Sản phẩm", "GET /products, /products/{id}, /products/{id}/similar"],
        ["RAG", "POST /rag/ask, /rag/compare, /rag/plan"],
        ["Chat", "POST /chat, /chat/stream (SSE), /chat/image; GET /chat/sessions/{id}"],
        ["Phản hồi", "POST /feedback, /events/click"],
        ["Glass-box", "GET /traces/{id} (admin), /meta/pipelines, /meta/embedding-map; POST /meta/embedding-map/project"],
        ["Quản trị", "/admin/auth, /admin/stats, /admin/config (+ profiles), /admin/traces, /admin/indexes, /admin/jobs, /admin/policies, /admin/eval-runs, /admin/feedback, /admin/judgments"],
    ], [3.2, 12.8], "Các nhóm API (tiền tố /api/v1)")


def main():
    styles()
    cover()
    front_matter()
    chapter_intro()
    chapter_theory()
    chapter_data()
    chapter_design()
    chapter_impl()
    chapter_experiments()
    chapter_conclusion()
    references()
    appendix()
    table_of_contents()
    footer_page_numbers()
    doc.core_properties.title = "ShopMind – Báo cáo đồ án môn Tìm kiếm thông minh"
    doc.core_properties.author = "Nhóm 4"
    doc.save(OUT)
    print("report ->", OUT)


if __name__ == "__main__":
    main()
