"""Charts for the final report and slides (numbers copied from api/reports/a1/RESULTS.md).

usage: python docs/report/build/charts.py  ->  docs/report/build/assets/*.png
"""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

OUT = Path(__file__).resolve().parent / "assets"
OUT.mkdir(parents=True, exist_ok=True)
INK, MUTED, GRID = "#152C3C", "#536774", "#D7DFDA"
BLUE, TEAL, AMBER, ROSE, GREY = "#086F69", "#7FB3AE", "#C9A227", "#B44B34", "#B8C2C7"
plt.rcParams.update({"font.family": "Segoe UI", "font.size": 11, "axes.edgecolor": GRID, "axes.labelcolor": INK, "xtick.color": INK, "ytick.color": MUTED, "axes.spines.top": False, "axes.spines.right": False})


def save(fig, name):
    fig.savefig(OUT / name, dpi=200, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def bars(name, labels, values, colors, title, xlabel, highlight=None, fmt="{:.3f}", xmax=None):
    fig, ax = plt.subplots(figsize=(8, 0.42 * len(labels) + 1.2))
    y = range(len(labels))[::-1]
    ax.barh(list(y), values, color=colors, height=0.62)
    for yi, value in zip(y, values):
        ax.text(value + (xmax or max(values)) * 0.01, yi, fmt.format(value), va="center", color=INK, fontsize=10)
    ax.set_yticks(list(y), labels)
    ax.set_xlabel(xlabel)
    ax.set_xlim(0, (xmax or max(values)) * 1.12)
    ax.grid(axis="x", color=GRID)
    ax.set_axisbelow(True)
    ax.set_title(title, loc="left", color=INK, fontsize=12, fontweight="bold")
    save(fig, name)


# A1 text ablation (80 queries): Recall@10
labels = ["BM25", "Dense E5 (mới)", "Dense SigLIP2 text (cũ)", "Cross-modal chữ→ảnh", "BM25+dense không fusion", "Hybrid RRF", "Hybrid RRF trọng số 1/0.5", "Hybrid linear (mặc định)", "Lexical-preserving (cũ)", "Adaptive"]
recall = [0.4875, 0.55, 0.0375, 0.2125, 0.5, 0.5, 0.5125, 0.5875, 0.5, 0.5625]
colors = [GREY, BLUE, ROSE, GREY, GREY, TEAL, TEAL, BLUE, ROSE, TEAL]
bars("a1_recall.png", labels, recall, colors, "Benchmark A1 (80 truy vấn chữ): Recall@10", "Recall@10", xmax=0.7)
ndcg = [0.3632, 0.4424, 0.0375, 0.1229, 0.3711, 0.4051, 0.4037, 0.4470, 0.3711, 0.4517]
bars("a1_ndcg.png", labels, ndcg, colors, "Benchmark A1 (80 truy vấn chữ): nDCG@10", "nDCG@10", xmax=0.6)

# Dense before/after (headline)
bars("dense_before_after.png", ["Dense SigLIP2 text (cũ)", "BM25", "Dense E5 (mới)", "Hybrid linear (mặc định)"], [0.0375, 0.4875, 0.55, 0.5875], [ROSE, GREY, BLUE, BLUE], "Recall@10 trên A1: bộ embedding chữ riêng (E5)", "Recall@10", xmax=0.7)

# accuracy_v2 DEV/holdout grouped bars
runs = ["BM25", "Dense E5", "Hybrid RRF", "Hybrid RRF 1/0.5", "Hybrid linear", "Lexical-preserving (cũ)", "Adaptive"]
dev = [0.6636, 0.4298, 0.7312, 0.7387, 0.7773, 0.6636, 0.6481]
hold = [0.6075, 0.3151, 0.6720, 0.6548, 0.6961, 0.6075, 0.7151]
fig, ax = plt.subplots(figsize=(9, 3.8))
x = range(len(runs))
ax.bar([i - 0.2 for i in x], dev, width=0.4, color=BLUE, label="DEV (dùng để chọn)")
ax.bar([i + 0.2 for i in x], hold, width=0.4, color=TEAL, label="Holdout (chỉ đọc kết quả)")
for i, (a, b) in enumerate(zip(dev, hold)):
    ax.text(i - 0.2, a + 0.01, f"{a:.2f}", ha="center", fontsize=8.5, color=INK)
    ax.text(i + 0.2, b + 0.01, f"{b:.2f}", ha="center", fontsize=8.5, color=INK)
ax.set_xticks(list(x), runs, rotation=18, ha="right")
ax.set_ylim(0, 0.9)
ax.set_ylabel("nDCG@10")
ax.grid(axis="y", color=GRID)
ax.set_axisbelow(True)
ax.legend(frameon=False, loc="upper left")
ax.set_title("Benchmark accuracy_v2: chọn trên DEV, báo cáo trên holdout", loc="left", fontsize=12, fontweight="bold", color=INK)
save(fig, "accuracy_v2.png")

# F1 compose
bars("f1_compose.png", ["Chỉ ảnh", "Chỉ chữ (màu)", "Chữ: màu + danh mục", "Ảnh + chữ, α=0.7", "Ảnh + chữ, α=0.5", "Ảnh + chữ, α=0.3"], [0.1065, 0.1484, 0.4039, 0.3762, 0.4390, 0.5360], [GREY, GREY, GREY, TEAL, BLUE, BLUE], "F1 – tìm kết hợp ảnh + chữ (40 truy vấn): nDCG@10", "nDCG@10", xmax=0.65)

# Latency before/after
cases = ["Tìm chữ, truy vấn mới", "Tìm chữ, truy vấn lặp lại", "Tìm có bộ lọc", "Ảnh + chữ khi kéo α", "Lên kế hoạch mua sắm"]
before = [179, 136, 70, 334, 614]
after = [179, 64, 16, 68, 213]
fig, ax = plt.subplots(figsize=(8.5, 3.4))
y = range(len(cases))[::-1]
ax.barh([i + 0.2 for i in y], before, height=0.38, color=GREY, label="Trước")
ax.barh([i - 0.2 for i in y], after, height=0.38, color=BLUE, label="Sau")
for i, (a, b) in zip(y, zip(before, after)):
    ax.text(a + 6, i + 0.2, f"{a} ms", va="center", fontsize=9, color=MUTED)
    ax.text(b + 6, i - 0.2, f"{b} ms", va="center", fontsize=9, color=INK)
ax.set_yticks(list(y), cases)
ax.set_xlabel("Trung vị độ trễ (ms)")
ax.set_xlim(0, 720)
ax.grid(axis="x", color=GRID)
ax.set_axisbelow(True)
ax.legend(frameon=False, loc="lower right")
ax.set_title("Độ trễ phục vụ trước/sau tối ưu", loc="left", fontsize=12, fontweight="bold", color=INK)
save(fig, "latency.png")

# Vocabulary holdout
fig, ax = plt.subplots(figsize=(6.5, 2.8))
names = ["BM25", "Hybrid linear (mặc định)"]
b, a = [0.6075, 0.6961], [0.6631, 0.7381]
x = range(len(names))
ax.bar([i - 0.18 for i in x], b, width=0.36, color=GREY, label="Trước")
ax.bar([i + 0.18 for i in x], a, width=0.36, color=BLUE, label="Sau khi mở rộng từ điển")
for i in x:
    ax.text(i - 0.18, b[i] + 0.01, f"{b[i]:.3f}", ha="center", fontsize=9)
    ax.text(i + 0.18, a[i] + 0.01, f"{a[i]:.3f}", ha="center", fontsize=9)
ax.set_xticks(list(x), names)
ax.set_ylim(0, 1.0)
ax.set_ylabel("nDCG@10 holdout")
ax.legend(frameon=False, loc="upper left", ncol=2)
ax.grid(axis="y", color=GRID)
ax.set_axisbelow(True)
save(fig, "vocab_holdout.png")
print("charts ->", OUT)
