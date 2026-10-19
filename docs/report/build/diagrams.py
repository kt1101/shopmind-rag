"""Architecture and flow diagrams for the report/slides (matplotlib, no external tools)."""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch  # noqa: E402

OUT = Path(__file__).resolve().parent / "assets"
OUT.mkdir(parents=True, exist_ok=True)
INK, MUTED = "#152C3C", "#536774"
FILL = {"ui": "#E6EDE8", "api": "#DCE9E6", "app": "#CFE3DF", "infra": "#F3EBDD", "store": "#F1E1DA", "ext": "#F5F3ED", "step": "#EEF4F2", "llm": "#F6DFC8"}
plt.rcParams.update({"font.family": "Segoe UI"})


FS = 1.0  # font scale of the diagram being drawn (figures are shrunk to the page width)


def box(ax, x, y, w, h, text, kind, size=10, bold=False):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.08", linewidth=1.1, edgecolor="#94a3b8", facecolor=FILL[kind]))
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=size * FS, color=INK, fontweight="bold" if bold else "normal", wrap=True)


def arrow(ax, x1, y1, x2, y2, text=None):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=12, color=MUTED, linewidth=1.2))
    if text:
        ax.text((x1 + x2) / 2 + 0.05, (y1 + y2) / 2, text, fontsize=8.5 * FS, color=MUTED, va="center")


def canvas(w, h):
    fig, ax = plt.subplots(figsize=(w, h))
    ax.set_xlim(0, w)
    ax.set_ylim(0, h)
    ax.axis("off")
    return fig, ax


def save(fig, name):
    fig.savefig(OUT / name, dpi=200, bbox_inches="tight", facecolor="white")
    plt.close(fig)


# --- system architecture ---------------------------------------------------------------------
FS = 1.3
fig, ax = canvas(12, 7.6)
box(ax, 0.3, 6.5, 5.5, 0.8, "Cửa hàng (khách hàng)\ntìm kiếm · trang sản phẩm · trợ lý chat · so sánh · lên kế hoạch", "ui", 8.6)
box(ax, 6.2, 6.5, 5.5, 0.8, "Admin console (JWT)\ncấu hình · playground · trace · index · policy · đánh giá", "ui", 8.6)
ax.text(6, 7.45, "ui/ — React + Vite (SPA)", ha="center", fontsize=12, color=MUTED)
arrow(ax, 3.0, 6.5, 3.0, 5.85, "REST + SSE /api/v1")
arrow(ax, 9.0, 6.5, 9.0, 5.85, "REST (Bearer JWT)")
box(ax, 0.3, 5.0, 11.4, 0.8, "interfaces/http — router tự đăng ký · schema · SSE · bảng ánh xạ lỗi · rate limit · auth", "api", 9.5)
box(ax, 0.3, 3.75, 11.4, 1.05, "application — use case: tìm kiếm (pipeline engine + trace) · RAG · chat (định tuyến ý định)\nso sánh (F3) · lên kế hoạch mua sắm (F6) · admin (config, jobs, policy CMS, đánh giá)", "app", 9.5)
box(ax, 0.3, 2.85, 11.4, 0.7, "domain — Product · SearchRequest · SearchResult · RetrievedDocument · Citation (không phụ thuộc framework)", "app", 9.5)
box(ax, 0.3, 1.65, 3.6, 1.0, "infrastructure/elasticsearch\nBM25 · kNN · facet · highlight", "infra", 9)
box(ax, 4.2, 1.65, 3.6, 1.0, "infrastructure/embedding\nE5 (chữ) · SigLIP2 (ảnh) · cache", "infra", 9)
box(ax, 8.1, 1.65, 3.6, 1.0, "infrastructure/llm · db\nOpenAI / Ollama · SQLAlchemy", "infra", 9)
box(ax, 0.3, 0.2, 3.6, 1.0, "Elasticsearch 8.15\nalias products · policies · reviews", "store", 9)
box(ax, 4.2, 0.2, 3.6, 1.0, "Mô hình Hugging Face\nmultilingual-e5-base · siglip2-base", "ext", 9)
box(ax, 8.1, 0.2, 3.6, 1.0, "PostgreSQL / SQLite\nuser · trace · phản hồi · cấu hình · job", "store", 9)
for x in (2.1, 6.0, 9.9):
    arrow(ax, x, 1.65, x, 1.22)
ax.text(11.85, 3.3, "bootstrap/\nwiring\n(composition\nroot)", fontsize=8.5, color=MUTED, va="center")
save(fig, "architecture.png")

# --- hybrid search pipeline (glass-box) -------------------------------------------------------
FS = 1.3
fig, ax = canvas(12, 3.3)
box(ax, 0.2, 1.3, 1.9, 1.0, "Truy vấn\n“giày bốt da màu nâu”", "ext", 8)
box(ax, 2.5, 1.3, 2.0, 1.0, "query_understanding\nngôn ngữ · alias\nbộ lọc", "step", 8.8)
box(ax, 5.0, 2.05, 2.1, 0.9, "retrieve BM25\n(highlight, DSL)", "step", 8.8)
box(ax, 5.0, 0.6, 2.1, 0.9, "retrieve dense E5\nkNN text_vector", "step", 8.8)
box(ax, 7.6, 1.3, 1.9, 1.0, "fuse\nlinear / RRF\n(có trọng số)", "step", 8.8)
box(ax, 9.9, 1.3, 1.9, 1.0, "rerank\nnoop / cross-encoder\n→ kết quả", "step", 7.6)
arrow(ax, 2.1, 1.8, 2.5, 1.8)
arrow(ax, 4.5, 1.9, 5.0, 2.45)
arrow(ax, 4.5, 1.7, 5.0, 1.05)
arrow(ax, 7.1, 2.45, 7.6, 1.95)
arrow(ax, 7.1, 1.05, 7.6, 1.65)
arrow(ax, 9.5, 1.8, 9.9, 1.8)
ax.text(6.05, 3.15, "chạy song song", ha="center", fontsize=11.5, color=MUTED)
ax.text(6, 0.15, "Mỗi bước ghi một StepTrace (input/output, điểm, thời gian, lý do) → Search Inspector", ha="center", fontsize=12, color=INK)
save(fig, "search_pipeline.png")

# --- RAG answer flow (two rows so the text stays readable at page width) ------------------------
FS = 1.25
fig, ax = canvas(10, 4.4)
steps = [
    ("Câu hỏi\n(+ lịch sử chat)", "ext"),
    ("rewrite\ncâu hỏi độc lập", "step"),
    ("multi_source_retrieve\nsản phẩm · review\n· policy", "step"),
    ("fuse RRF\n+ rerank", "step"),
    ("build_context\nngân sách ký tự", "step"),
    ("generate\nLLM structured\noutput", "llm"),
    ("validate_citations\nID phải thuộc\ncontext", "step"),
]
for index, (text, kind) in enumerate(steps):
    row, col = divmod(index, 4)
    x, y = 0.15 + col * 2.5, 2.75 - row * 1.85
    box(ax, x, y, 2.1, 1.25, text, kind, 9.5)
    if col:
        arrow(ax, x - 0.38, y + 0.62, x, y + 0.62)
arrow(ax, 8.55, 2.75, 1.2, 2.15)
ax.text(5, 0.25, "Sai trích dẫn → thử lại 1 lần kèm phản hồi; không có bằng chứng → từ chối (insufficient_evidence)", ha="center", fontsize=11.5, color=INK)
save(fig, "rag_flow.png")

# --- shopping planner flow --------------------------------------------------------------------
FS = 1.3
fig, ax = canvas(12, 3.6)
box(ax, 0.1, 1.4, 2.0, 1.1, "“Chuyển vào căn hộ\nstudio, ngân sách 800$”", "ext", 7.8)
box(ax, 2.35, 1.4, 2.05, 1.1, "decompose\nLLM (ràng buộc\ndanh mục) hoặc\ntemplate dịp", "step", 8.3)
for i, label in enumerate(["sofa", "bàn", "đèn", "ga giường", "thảm"]):
    box(ax, 4.75, 2.85 - i * 0.62, 1.7, 0.5, f"retrieve: {label}", "step", 7.4)
    arrow(ax, 4.35, 1.95, 4.75, 3.1 - i * 0.62)
box(ax, 6.85, 1.4, 1.75, 1.1, "optimize_budget\nquy hoạch động\n(tối ưu chính xác)", "step", 8.5)
box(ax, 8.95, 1.4, 1.5, 1.1, "build_context\n+ policy", "step", 8.5)
box(ax, 10.75, 1.4, 1.2, 1.1, "lý do có\ntrích dẫn", "llm", 8.5)
arrow(ax, 2.1, 1.95, 2.45, 1.95)
for i in range(5):
    arrow(ax, 6.45, 3.1 - i * 0.62, 6.85, 1.95)
arrow(ax, 8.6, 1.95, 8.95, 1.95)
arrow(ax, 10.45, 1.95, 10.75, 1.95)
ax.text(6, 0.1, "Không có LLM: template dịp (configs/vocab/occasions.yaml) + lý do trích xuất từ dữ liệu sản phẩm", ha="center", fontsize=12, color=INK)
save(fig, "planner_flow.png")
print("diagrams ->", OUT)
