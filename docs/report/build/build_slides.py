"""Final presentation (PowerPoint) for ShopMind, same visual language as the A1 deck.

usage: python docs/report/build/build_slides.py  ->  docs/report/ShopMind_Slides_CuoiKy.pptx
Needs python-pptx. Uses build/assets (charts.py, diagrams.py) and build/assets/screens.
Numbers are copied from api/reports/a1/RESULTS.md.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"
SCREENS = ASSETS / "screens"
OUT = HERE.parent / "ShopMind_Slides_CuoiKy.pptx"

PAPER = RGBColor(0xF5, 0xF3, 0xED)
NAVY = RGBColor(0x15, 0x2C, 0x3C)
INK = RGBColor(0x15, 0x2C, 0x3C)
MUTED = RGBColor(0x53, 0x67, 0x74)
TEAL = RGBColor(0x08, 0x6F, 0x69)
LIGHT = RGBColor(0xE6, 0xED, 0xE8)
CORAL = RGBColor(0xB4, 0x4B, 0x34)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
SERIF, SANS = "Georgia", "Segoe UI"
W, H = Inches(13.333), Inches(7.5)

prs = Presentation()
prs.slide_width, prs.slide_height = W, H
BLANK = prs.slide_layouts[6]
_page = {"n": 0}


# --- helpers -------------------------------------------------------------------------------------

def fill(shape, color):
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.fill.background()
    shape.shadow.inherit = False


def text(slide, x, y, w, h, content, *, size=16, color=INK, font=SANS, bold=False, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=1.1):
    """``content`` is a string or a list of strings (one paragraph each); ``**x**`` makes x bold."""
    import re

    box = slide.shapes.add_textbox(x, y, w, h)
    frame = box.text_frame
    frame.word_wrap = True
    frame.vertical_anchor = anchor
    frame.margin_left = frame.margin_right = Inches(0.05)
    frame.margin_top = frame.margin_bottom = Inches(0.03)
    for index, line in enumerate([content] if isinstance(content, str) else content):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.alignment = align
        paragraph.line_spacing = spacing
        for token in re.split(r"(\*\*[^*]+\*\*)", line):
            if not token:
                continue
            run = paragraph.add_run()
            run.text = token.strip("*") if token.startswith("**") else token
            run.font.size = Pt(size)
            run.font.name = font
            run.font.bold = bold or token.startswith("**")
            run.font.color.rgb = color
    return box


def bullets(slide, x, y, w, h, items, size=17, gap=8):
    box = slide.shapes.add_textbox(x, y, w, h)
    frame = box.text_frame
    frame.word_wrap = True
    import re

    for index, item in enumerate(items):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.space_after = Pt(gap)
        paragraph.line_spacing = 1.08
        marker = paragraph.add_run()
        marker.text = "▪  "
        marker.font.size = Pt(size - 3)
        marker.font.color.rgb = TEAL
        for token in re.split(r"(\*\*[^*]+\*\*)", item):
            if not token:
                continue
            run = paragraph.add_run()
            run.text = token.strip("*") if token.startswith("**") else token
            run.font.size = Pt(size)
            run.font.name = SANS
            run.font.bold = token.startswith("**")
            run.font.color.rgb = INK
    return box


def picture(slide, path, x, y, w, h, *, border=False):
    """Fit an image inside the box, keeping its aspect ratio; placeholder when missing."""
    path = Path(path)
    if not path.exists():
        shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
        fill(shape, LIGHT)
        text(slide, x, y, w, h, f"[ảnh chụp: {path.name}]", size=14, color=MUTED, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        return shape
    with Image.open(path) as image:
        ratio = image.width / image.height
    if w / h > ratio:
        new_w, new_h = int(h * ratio), h
    else:
        new_w, new_h = w, int(w / ratio)
    left, top = x + (w - new_w) // 2, y + (h - new_h) // 2
    pic = slide.shapes.add_picture(str(path), left, top, new_w, new_h)
    if border:
        pic.line.color.rgb = RGBColor(0xC9, 0xD3, 0xCE)
        pic.line.width = Pt(0.75)
    return pic


def base(kicker, title, notes=""):
    _page["n"] += 1
    slide = prs.slides.add_slide(BLANK)
    background = slide.background.fill
    background.solid()
    background.fore_color.rgb = PAPER
    bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.6), Inches(0.55), Inches(0.08), Inches(0.95))
    fill(bar, TEAL)
    text(slide, Inches(0.85), Inches(0.45), Inches(11), Inches(0.4), kicker.upper(), size=12, color=TEAL, bold=True)
    text(slide, Inches(0.85), Inches(0.78), Inches(11.8), Inches(0.8), title, size=30, font=SERIF, color=NAVY)
    text(slide, Inches(11.9), Inches(7.0), Inches(1.0), Inches(0.3), str(_page["n"] + 1), size=11, color=MUTED, align=PP_ALIGN.RIGHT)
    text(slide, Inches(0.6), Inches(7.0), Inches(8), Inches(0.3), "ShopMind · Nhóm 4 · Tìm kiếm thông minh", size=11, color=MUTED)
    if notes:
        slide.notes_slide.notes_text_frame.text = notes
    return slide


def stat(slide, x, y, value, label, color=TEAL, w=Inches(2.9)):
    card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, Inches(1.55))
    fill(card, WHITE)
    card.adjustments[0] = 0.08
    text(slide, x, y + Inches(0.12), w, Inches(0.8), value, size=34, font=SERIF, color=color, align=PP_ALIGN.CENTER)
    text(slide, x + Inches(0.15), y + Inches(0.9), w - Inches(0.3), Inches(0.6), label, size=13, color=MUTED, align=PP_ALIGN.CENTER)


def panel(slide, x, y, w, h, title, items, size=15):
    card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    fill(card, WHITE)
    card.adjustments[0] = 0.05
    text(slide, x + Inches(0.25), y + Inches(0.18), w - Inches(0.5), Inches(0.45), title, size=17, font=SERIF, color=TEAL)
    bullets(slide, x + Inches(0.2), y + Inches(0.7), w - Inches(0.4), h - Inches(0.8), items, size=size, gap=5)


# --- slides --------------------------------------------------------------------------------------

def cover():
    slide = prs.slides.add_slide(BLANK)
    background = slide.background.fill
    background.solid()
    background.fore_color.rgb = NAVY
    text(slide, Inches(0.9), Inches(0.7), Inches(11), Inches(0.4), "TRƯỜNG ĐẠI HỌC CÔNG NGHỆ THÔNG TIN – ĐHQG TP.HCM  ·  MÔN TÌM KIẾM THÔNG MINH", size=13, color=RGBColor(0x9F, 0xC9, 0xC4), bold=True)
    text(slide, Inches(0.9), Inches(1.9), Inches(11.5), Inches(1.2), "ShopMind", size=60, font=SERIF, color=WHITE)
    text(slide, Inches(0.9), Inches(3.05), Inches(11.5), Inches(1.2), "Tìm kiếm sản phẩm đa phương thức và trợ lý mua sắm RAG minh bạch", size=26, font=SERIF, color=RGBColor(0xDD, 0xE7, 0xE4))
    line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.9), Inches(4.35), Inches(1.4), Inches(0.06))
    fill(line, RGBColor(0x7F, 0xB3, 0xAE))
    text(slide, Inches(0.9), Inches(4.65), Inches(7), Inches(1.9), [
        "Báo cáo đồ án cuối kỳ — Nhóm 4",
        "Trần Văn Quang · Nguyễn Minh Thái · Trần Khoa · Đinh Ngọc Phúc",
        "GVHD: TS. Phạm Đỗ Kim Chi",
    ], size=16, color=WHITE, spacing=1.35)
    text(slide, Inches(9.4), Inches(6.6), Inches(3.3), Inches(0.4), "Tháng 10/2026", size=14, color=RGBColor(0x9F, 0xC9, 0xC4), align=PP_ALIGN.RIGHT)
    slide.notes_slide.notes_text_frame.text = "Giới thiệu nhóm và đề tài. ShopMind là một cửa hàng thu nhỏ 1.500 sản phẩm dùng để nghiên cứu truy hồi đa phương thức và RAG, nhấn mạnh tính minh bạch: mọi kết quả đều giải thích được."


def problem():
    slide = base("Bối cảnh", "Tìm kiếm là cửa ngõ của cửa hàng — và nó đang sai",
                 "Nêu ba vấn đề gặp phải sau bài tập A1/A3: dense bằng SigLIP2 gần như không hoạt động, hợp nhất còn kém hơn BM25, và hệ thống chưa phải sản phẩm. Từ đó dẫn tới năm mục tiêu.")
    panel(slide, Inches(0.6), Inches(1.9), Inches(5.9), Inches(4.8), "Hiện trạng sau A1/A3", [
        "BM25 tốt với tên, mã sản phẩm — kém với câu mô tả và tiếng Việt",
        "Dense bằng SigLIP2 chữ: **Recall@10 = 0,0125**",
        "Hybrid RRF còn **thấp hơn** BM25 (0,325 so với 0,4625)",
        "Chưa có CSDL, trang quản trị, chưa giải thích được vì sao ra kết quả",
    ])
    panel(slide, Inches(6.8), Inches(1.9), Inches(5.9), Inches(4.8), "Mục tiêu đồ án", [
        "**Sửa lõi truy hồi** — embedding chữ riêng, hybrid ≥ BM25",
        "**Glass-box** — mọi bước có trace xem được",
        "**Cấu hình thay vì sửa mã** — admin đổi thuật toán khi đang chạy",
        "**Tính năng RAG thực tế** — ảnh + chữ, trợ lý, so sánh, lên kế hoạch",
        "**Đánh giá trung thực** — chọn trên DEV, báo cáo holdout",
    ])


def data():
    slide = base("Dữ liệu", "Một cửa hàng thu nhỏ trên Amazon Berkeley Objects",
                 "Dữ liệu ABO là sản phẩm thật, tiêu đề đa ngôn ngữ. Giá, tồn kho và chính sách là dữ liệu tổng hợp, có gắn nhãn. Ba benchmark, tất cả nhãn tự sinh — đây là giới hạn chính sẽ nói lại ở cuối.")
    stat(slide, Inches(0.6), Inches(1.95), "1.500", "sản phẩm ABO, seed 42")
    stat(slide, Inches(3.75), Inches(1.95), "215", "danh mục, tối đa 150/danh mục")
    stat(slide, Inches(6.9), Inches(1.95), "3 × 768", "vector mỗi sản phẩm: E5, SigLIP2 ảnh, SigLIP2 chữ")
    stat(slide, Inches(10.05), Inches(1.95), "300", "truy vấn đánh giá trên 3 benchmark", w=Inches(2.7))
    panel(slide, Inches(0.6), Inches(3.85), Inches(6.0), Inches(2.9), "Benchmark", [
        "**A1** — 80 truy vấn chữ (Anh/Việt) + 20 ảnh biến đổi",
        "**accuracy_v2** — 160 truy vấn: 130 DEV, 30 holdout danh mục tách biệt",
        "**F1** — 40 truy vấn ảnh A + màu của sản phẩm B",
    ], size=15)
    panel(slide, Inches(6.9), Inches(3.85), Inches(5.85), Inches(2.9), "Lưu ý trung thực", [
        "Nhãn tự sinh từ metadata, **chưa người duyệt**",
        "Giá, tồn kho, chính sách là **dữ liệu tổng hợp**",
        "Giấy phép: áp dụng cách hiểu CC BY-NC 4.0",
    ], size=15)


def architecture():
    slide = base("Kiến trúc", "Cửa hàng và trang quản trị trên cùng một lõi",
                 "Đi từ trên xuống: giao diện tách vai, tầng HTTP, use case, domain không phụ thuộc framework, hạ tầng thay được. bootstrap/wiring là nơi duy nhất lắp ráp; phân hệ lỗi không làm sập ứng dụng.")
    picture(slide, ASSETS / "architecture.png", Inches(0.6), Inches(1.75), Inches(8.0), Inches(5.1))
    bullets(slide, Inches(8.9), Inches(1.9), Inches(3.9), Inches(5), [
        "**FastAPI** + **React/Vite**, một monorepo",
        "**Elasticsearch** cho BM25 + kNN; **Postgres/SQLite** cho phần còn lại",
        "Mô hình, thuật toán, prompt, từ điển: **YAML**",
        "Khách không thấy thuật toán; **admin chọn** pipeline mặc định",
    ], size=16)


def pipeline():
    slide = base("Pipeline engine", "Mỗi thuật toán là vài dòng YAML — mỗi bước để lại trace",
                 "Giải thích registry: thêm thuật toán = một lớp + một dòng đăng ký + YAML. Các bước retrieve chạy song song nhưng hợp lại theo thứ tự khai báo nên trace giống hệt. Trace lọc mọi vector, chỉ giữ số chiều và chuẩn.")
    picture(slide, ASSETS / "search_pipeline.png", Inches(0.6), Inches(1.8), Inches(12.1), Inches(3.1))
    code = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.6), Inches(5.1), Inches(6.4), Inches(1.7))
    fill(code, NAVY)
    text(slide, Inches(0.8), Inches(5.2), Inches(6.1), Inches(1.5), [
        "search.hybrid_linear:",
        "  - { step: query_understanding, impl: rules }",
        "  - { step: retrieve, impl: bm25 }",
        "  - { step: retrieve, impl: dense, field: text_vector }",
        "  - { step: fuse, impl: linear, weights: [0.5, 0.5] }",
    ], size=12, font="Consolas", color=WHITE, spacing=1.0)
    bullets(slide, Inches(7.3), Inches(5.15), Inches(5.4), Inches(1.7), [
        "Trace: đầu vào, đầu ra, điểm, thời gian, lý do",
        "Không lưu vector/ảnh — chỉ {dims, norm}",
        "Cấu hình nóng có kiểm tra và quay lại",
    ], size=15, gap=4)


def dense_result():
    slide = base("Kết quả chính", "Một bộ embedding chữ riêng đổi hẳn bức tranh",
                 "Đây là slide quan trọng nhất. Cùng pipeline, chỉ đổi vector: SigLIP2 chữ 0,0375, E5 0,55, vượt BM25. Lý do: SigLIP2 học khớp ảnh–chú thích, cắt ở 64 token; E5 học khớp chữ–chữ đa ngôn ngữ.")
    stat(slide, Inches(0.6), Inches(1.95), "0,0375", "Recall@10 dense SigLIP2 chữ (cũ)", color=CORAL)
    stat(slide, Inches(0.6), Inches(3.7), "0,55", "Recall@10 dense E5 (mới)")
    stat(slide, Inches(0.6), Inches(5.45), "0,5875", "Recall@10 hybrid linear (BM25: 0,4875)")
    picture(slide, ASSETS / "dense_before_after.png", Inches(3.9), Inches(1.95), Inches(8.8), Inches(3.4))
    bullets(slide, Inches(3.9), Inches(5.5), Inches(8.8), Inches(1.4), [
        "Truy vấn ngữ nghĩa: dense **0,4857** > BM25 0,4571 — đạt tiêu chí kế hoạch",
        "Mọi cấu hình hybrid đều **≥ BM25** (benchmark A1, 80 truy vấn chữ)",
    ], size=16, gap=4)


def ablation():
    slide = base("Ablation A1", "So sánh có kiểm soát 10 cấu hình truy hồi",
                 "Hợp nhất tuyến tính giữ thông tin khoảng cách điểm nên tốt nhất về Recall. Adaptive tốt nhất về nDCG và MRR. Cross-encoder đã cài nhưng không đo được trên CPU (hơn 100 giây mỗi truy vấn).")
    picture(slide, ASSETS / "a1_recall.png", Inches(0.6), Inches(1.75), Inches(7.6), Inches(5.1))
    panel(slide, Inches(8.5), Inches(1.9), Inches(4.25), Inches(4.85), "Đọc biểu đồ", [
        "**Linear min-max** tốt nhất Recall@10: 0,5875",
        "**Adaptive** tốt nhất nDCG@10: 0,4517",
        "Lexical-preserving (production cũ) = BM25",
        "Tiếng Việt vẫn yếu: tốt nhất 0,3143",
        "Rerank: cài rồi, **chưa đo** (CPU)",
    ], size=15)


def holdout():
    slide = base("Chọn cấu hình", "Chọn trên DEV, chỉ đọc holdout — không “chọn theo đề thi”",
                 "Nhấn mạnh quy trình: chọn duy nhất theo DEV. Adaptive tốt hơn trên holdout nhưng không được chọn vì như vậy là dùng holdout để chọn. Từ điển mở rộng sau đó không đổi DEV, holdout tăng lên 0,7381.")
    picture(slide, ASSETS / "accuracy_v2.png", Inches(0.6), Inches(1.75), Inches(8.0), Inches(4.2))
    stat(slide, Inches(9.0), Inches(1.95), "0,7773", "nDCG@10 DEV của hybrid linear — cao nhất → được chọn", w=Inches(3.75))
    stat(slide, Inches(9.0), Inches(3.7), "+0,0886", "holdout so với production cũ (0,6961 vs 0,6075)", w=Inches(3.75))
    stat(slide, Inches(9.0), Inches(5.45), "0,7381", "holdout sau khi mở rộng từ điển (DEV không đổi)", w=Inches(3.75))
    text(slide, Inches(0.6), Inches(6.1), Inches(8), Inches(0.7), "accuracy_v2: 130 truy vấn DEV, 30 holdout với danh mục tách biệt; nhãn là vị từ metadata.", size=14, color=MUTED)


def compose():
    slide = base("F1 · Ảnh + chữ", "“Giống ảnh này nhưng màu đen”",
                 "q = normalize(α·ảnh + (1−α)·chữ), sau đó tăng điểm cho màu khớp. Mọi α đều vượt cả hai phương thức đơn lẻ. Mặc định α = 0,5 chứ không phải 0,3 vì α được so trên chính tập tổng hợp này; giao diện có thanh trượt.")
    picture(slide, ASSETS / "f1_compose.png", Inches(0.6), Inches(1.75), Inches(6.4), Inches(3.6))
    picture(slide, SCREENS / "compose.png", Inches(7.3), Inches(1.8), Inches(5.45), Inches(5.0), border=True)
    bullets(slide, Inches(0.6), Inches(5.5), Inches(6.4), Inches(1.4), [
        "nDCG@10: **0,536** so với 0,107 (chỉ ảnh), 0,148 (chỉ chữ)",
        "Mặc định α = 0,5 (không chọn theo tập đánh giá)",
    ], size=16, gap=4)


def assistant():
    slide = base("F2 · Trợ lý mua sắm", "Hiểu ý định trước, chỉ gọi LLM khi thật cần",
                 "Tìm sản phẩm trả lời ngay bằng thẻ sản phẩm, không cần LLM. Câu hỏi đi qua RAG đa nguồn và kiểm tra trích dẫn. Phiên chat do máy chủ cấp mã. Stream qua SSE với các bước hiện cho người dùng.")
    picture(slide, SCREENS / "chat.png", Inches(0.6), Inches(1.8), Inches(6.0), Inches(5.0), border=True)
    panel(slide, Inches(6.9), Inches(1.9), Inches(5.85), Inches(2.4), "6 ý định", [
        "chào hỏi · tìm sản phẩm · hỏi sản phẩm",
        "hỏi chính sách · so sánh · lên kế hoạch",
    ], size=15)
    picture(slide, ASSETS / "rag_flow.png", Inches(6.9), Inches(4.45), Inches(5.85), Inches(2.4))


def compare():
    slide = base("F3 · So sánh có trích dẫn", "Bảng từ dữ liệu, nhận xét từ RAG — mỗi ý đều có nguồn",
                 "Bảng thuộc tính không qua LLM nên không thể bịa. Nhận xét phải trích ID có trong ngữ cảnh, sai thì sinh lại một lần. Không có LLM thì vẫn có bảng, kèm lý do rõ ràng.")
    picture(slide, SCREENS / "compare.png", Inches(0.6), Inches(1.8), Inches(7.6), Inches(5.0), border=True)
    panel(slide, Inches(8.5), Inches(1.9), Inches(4.25), Inches(4.85), "Chống “bịa”", [
        "Đầu ra JSON schema: câu trả lời + ID trích dẫn",
        "ID ngoài ngữ cảnh → **từ chối, sinh lại 1 lần**",
        "Thiếu bằng chứng → **insufficient_evidence**",
        "Bằng chứng là dữ liệu, không phải mệnh lệnh (chống prompt injection)",
    ], size=15)


def planner():
    slide = base("F6 · Lên kế hoạch mua sắm", "“Mình mới chuyển vào studio, ngân sách 800 đô”",
                 "Tính năng RAG bổ sung ở giai đoạn cuối. Tách nhu cầu (LLM chỉ được chọn danh mục có thật, hoặc template), truy hồi từng nhu cầu, tối ưu ngân sách bằng quy hoạch động — đúng tối ưu, kiểm chứng bằng vét cạn — rồi giải thích có trích dẫn. Chạy được cả khi không có LLM.")
    picture(slide, ASSETS / "planner_flow.png", Inches(0.6), Inches(1.7), Inches(12.1), Inches(2.0))
    picture(slide, SCREENS / "planner.png", Inches(0.6), Inches(3.85), Inches(6.6), Inches(3.0), border=True)
    bullets(slide, Inches(7.5), Inches(3.9), Inches(5.25), Inches(3.0), [
        "Đọc ngân sách: “800 đô”, “$1,234.50”, “2 triệu”; bỏ qua “khoảng 5 ngày”",
        "Cái túi nhiều lựa chọn: **quy hoạch động, đúng tối ưu**",
        "Lý do + mẹo đổi trả có **trích dẫn**",
        "Không có LLM: template tình huống + lý do trích xuất",
        "Độ trễ: 614 → **213 ms**",
    ], size=15, gap=4)


def admin():
    slide = base("Quản trị & glass-box", "Admin chọn thuật toán, xem từng bước, so sánh pipeline",
                 "Thẻ thuật toán tìm kiếm: đổi pipeline mặc định có hiệu lực ngay, có lịch sử và quay lại. Inspector cho thấy thứ hạng qua từng bước và công thức hợp nhất với số thật. Playground so hai pipeline trên cùng truy vấn.")
    picture(slide, SCREENS / "admin_config.png", Inches(0.6), Inches(1.8), Inches(6.0), Inches(5.0), border=True)
    picture(slide, SCREENS / "inspector_ranking.png", Inches(6.85), Inches(1.8), Inches(5.9), Inches(5.0), border=True)


def latency():
    slide = base("Hiệu năng", "Nhanh hơn mà kết quả không đổi",
                 "Cache embedding truy vấn và ảnh, cache phân giải bộ lọc và mapping, chạy song song các bước retrieve, trả _source nhẹ hơn. Truy vấn mới vẫn ~179 ms vì phải mã hoá E5 trên CPU.")
    picture(slide, ASSETS / "latency.png", Inches(0.6), Inches(1.75), Inches(8.0), Inches(4.4))
    panel(slide, Inches(8.9), Inches(1.9), Inches(3.85), Inches(4.85), "Đã làm", [
        "Cache LRU embedding chữ và ảnh",
        "Cache bộ lọc, mapping chỉ mục",
        "BM25 ‖ dense chạy song song",
        "Ảnh xử lý ngoài event loop",
    ], size=15)
    text(slide, Inches(0.6), Inches(6.25), Inches(8), Inches(0.5), "Trung vị trên laptop CPU, Elasticsearch cùng máy.", size=13, color=MUTED)


def quality():
    slide = base("Chất lượng", "Kiểm thử, rà soát và smoke test trên hệ thống thật",
                 "523 kiểm thử backend gồm tích hợp với Elasticsearch thật; 235 kiểm thử logic giao diện. Rà soát độc lập tìm 14 lỗi, tất cả đã sửa kèm kiểm thử hồi quy. Smoke đầu–cuối trên API và trình duyệt.")
    stat(slide, Inches(0.6), Inches(1.95), "523", "kiểm thử backend đạt")
    stat(slide, Inches(3.75), Inches(1.95), "235", "kiểm thử logic giao diện đạt")
    stat(slide, Inches(6.9), Inches(1.95), "14 / 14", "lỗi từ rà soát độc lập đã sửa")
    stat(slide, Inches(10.05), Inches(1.95), "45 + 42", "bước smoke API + giao diện", w=Inches(2.7))
    panel(slide, Inches(0.6), Inches(3.85), Inches(12.15), Inches(2.9), "Ví dụ lỗi tìm được và đã sửa", [
        "Đọc sai ngân sách “$1,234.50” và “khoảng 5 ngày” → bộ đọc ngân sách mới, kiểm thử tham số hoá",
        "Ảnh “bom giải nén” 48 MP → giới hạn số điểm ảnh, thu nhỏ trước khi mã hoá",
        "Chỉ mục bị ghim sau khi đổi alias → luôn đi theo alias, kiểm tra danh tính embedding",
        "Khách gọi được pipeline ẩn; lỗi 500 không đúng định dạng JSON → đã chặn và thống nhất",
    ], size=15)


def limits():
    slide = base("Giới hạn & hướng phát triển", "Những gì chưa đo được thì không báo cáo",
                 "Nói thẳng các giới hạn. Ba hướng tiếp: gán nhãn có người duyệt (đã có công cụ), đo RAG bằng LLM-as-judge, và đo rerank trên GPU.")
    panel(slide, Inches(0.6), Inches(1.9), Inches(5.9), Inches(4.85), "Giới hạn", [
        "Nhãn **chưa người duyệt**, chưa kiểm định thống kê",
        "Chất lượng câu trả lời LLM **chưa đo** (không có khoá API)",
        "Cross-encoder **chưa có số đo** (CPU)",
        "Tiếng Việt vẫn yếu; dữ liệu thương mại là tổng hợp",
    ], size=16)
    panel(slide, Inches(6.8), Inches(1.9), Inches(5.95), Inches(4.85), "Hướng phát triển", [
        "Gán nhãn bằng trang Annotation + Cohen’s kappa",
        "LLM-as-judge (mô hình chấm ≠ mô hình sinh) + 30 câu người chấm",
        "Rerank trên GPU / mô hình nhỏ hơn; học trọng số hợp nhất",
        "Embedding mạnh hơn cho tiếng Việt (BGE-M3)",
        "TypeScript + client sinh từ OpenAPI",
    ], size=16)


def demo():
    slide = base("Demo", "Kịch bản demo 7 phút",
                 "Chạy theo docs/DEMO_SCRIPT.md. Nếu không có mạng hoặc khoá LLM: tìm kiếm, trợ lý tìm sản phẩm, bảng so sánh và lên kế hoạch vẫn chạy.")
    steps = [
        ("1", "Tìm bằng chữ", "“giày bốt da màu nâu” → bộ lọc, gợi ý “Hệ thống hiểu”"),
        ("2", "Ảnh + chữ", "Tải ảnh, gõ “màu đen”, kéo thanh α"),
        ("3", "Trợ lý", "Hỏi chính sách đổi trả, hỏi tìm sản phẩm"),
        ("4", "So sánh", "Chọn 2–3 sản phẩm, xem bảng và trích dẫn"),
        ("5", "Lên kế hoạch", "“Chuyển vào studio, ngân sách 800 đô”"),
        ("6", "Quản trị", "Đổi thuật toán, mở Inspector, Playground, trace"),
    ]
    for index, (number, title, detail) in enumerate(steps):
        col, row = index % 2, index // 2
        x, y = Inches(0.6 + col * 6.15), Inches(1.95 + row * 1.6)
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, Inches(5.95), Inches(1.4))
        fill(card, WHITE)
        card.adjustments[0] = 0.08
        dot = slide.shapes.add_shape(MSO_SHAPE.OVAL, x + Inches(0.25), y + Inches(0.38), Inches(0.62), Inches(0.62))
        fill(dot, TEAL)
        text(slide, x + Inches(0.25), y + Inches(0.38), Inches(0.62), Inches(0.62), number, size=18, color=WHITE, bold=True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        text(slide, x + Inches(1.1), y + Inches(0.2), Inches(4.7), Inches(0.45), title, size=18, font=SERIF, color=NAVY)
        text(slide, x + Inches(1.1), y + Inches(0.7), Inches(4.7), Inches(0.6), detail, size=14, color=MUTED)


def closing():
    slide = prs.slides.add_slide(BLANK)
    background = slide.background.fill
    background.solid()
    background.fore_color.rgb = NAVY
    text(slide, Inches(0.9), Inches(2.3), Inches(11.5), Inches(1.2), "Cảm ơn cô và các bạn đã lắng nghe", size=40, font=SERIF, color=WHITE)
    text(slide, Inches(0.9), Inches(3.6), Inches(11.5), Inches(0.8), "Hỏi & đáp", size=24, font=SERIF, color=RGBColor(0x9F, 0xC9, 0xC4))
    text(slide, Inches(0.9), Inches(5.3), Inches(11.5), Inches(1.2), [
        "0,0375 → 0,55  Recall@10 dense  ·  0,7381  nDCG@10 holdout  ·  0,536  nDCG@10 ảnh + chữ",
        "Mọi số liệu: api/reports/a1/RESULTS.md",
    ], size=15, color=RGBColor(0xDD, 0xE7, 0xE4), spacing=1.4)
    slide.notes_slide.notes_text_frame.text = "Tóm tắt ba con số chính và mời câu hỏi."


def main():
    cover()
    problem()
    data()
    architecture()
    pipeline()
    dense_result()
    ablation()
    holdout()
    compose()
    assistant()
    compare()
    planner()
    admin()
    latency()
    quality()
    limits()
    demo()
    closing()
    prs.core_properties.title = "ShopMind – Báo cáo cuối kỳ"
    prs.core_properties.author = "Nhóm 4"
    prs.save(OUT)
    print("slides ->", OUT, len(prs.slides), "slides")


if __name__ == "__main__":
    main()
