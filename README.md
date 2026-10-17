# ShopMind

**Tìm kiếm sản phẩm đa phương thức + trợ lý mua sắm RAG có trích dẫn, minh bạch từng bước (glass-box).**

> **English summary.** ShopMind is a small, end-to-end shopping product built on a 1,500-product
> subset of Amazon Berkeley Objects. It offers text, image and composed (image + text) product
> search over Elasticsearch (BM25 + dense kNN, RRF fusion), a RAG shopping assistant that answers
> from products, reviews and store policies with validated citations, a glass-box inspector that
> shows every pipeline step, an admin console, and reproducible IR/RAG evaluation.
> Quick start: `cp .env.example .env && make setup && make up && make seed`, then open
> <http://localhost:5173>.

---

## ShopMind là gì

ShopMind là một "cửa hàng thu nhỏ" dùng để nghiên cứu và trình diễn truy hồi thông tin (IR) và RAG:

- **A1, truy hồi sản phẩm đa phương thức:** tìm bằng chữ, bằng ảnh, hoặc kết hợp ảnh + chữ trên
  1.500 sản phẩm ABO. Elasticsearch 8.15 làm search store (BM25 + kNN), SigLIP2 cho ảnh và
  cross-modal, một text embedder đa ngôn ngữ (E5) cho text ↔ text, hợp nhất bằng RRF.
- **A3, trả lời bằng RAG:** câu hỏi được trả lời từ ba nguồn bằng chứng (sản phẩm, review Amazon,
  policy thử nghiệm). Mỗi câu trả lời có citation được kiểm tra: ID trích dẫn phải nằm trong đúng
  context đã gửi cho LLM; thiếu bằng chứng thì từ chối trả lời (`insufficient_evidence`).
- **Glass-box:** mỗi request search/RAG sinh một *pipeline trace* (từng bước, input/output, điểm,
  thời gian, lý do) để thấy *vì sao* ra kết quả đó.

## Tính năng

| Nhóm | Tính năng |
|---|---|
| Tìm kiếm | Text search (`bm25`, `dense`, `cross_modal`, `hybrid`, `adaptive`), image search, **compose search** ("giống ảnh này nhưng màu đen"), autocomplete, facet có đếm, bộ lọc brand/category (OR trong một trường, AND giữa các trường), sản phẩm tương tự theo ảnh |
| Trợ lý RAG | Chat streaming (SSE) có lịch sử, viết lại câu hỏi độc lập, hiểu ý định và tự trích bộ lọc, chat nhận ảnh, hỏi đáp trên trang sản phẩm, **so sánh 2–3 sản phẩm có trích dẫn** |
| Glass-box inspector | Search Inspector (truy vấn đã hiểu, rank BM25/dense/RRF, từ khoá khớp, waterfall thời gian, ES query DSL), RAG Inspector (ứng viên theo nguồn, context thật sự gửi đi, prompt, kiểm tra citation), bản đồ embedding 2D |
| Admin console | Đăng nhập JWT, dashboard (latency, zero-result, abstain, phản hồi), sửa config hot-reload + rollback, Trace Explorer, quản lý index/alias, Policy CMS, Evaluation Center, gán nhãn relevance |
| Đánh giá | Benchmark A1 seed 42 (Recall@10, nDCG@10, MRR@10), ablation, lộ trình RAG `s0`–`s5`, mọi run ghi vào `runs/<timestamp>_<name>/` |

Lộ trình, phạm vi (MoSCoW) và **trạng thái thực hiện** (mục 15) nằm trong
[`docs/REFACTOR_PLAN.md`](docs/REFACTOR_PLAN.md); hợp đồng API dùng chung giữa backend và frontend nằm trong
[`docs/API_CONTRACT.md`](docs/API_CONTRACT.md). Số đo mới nhất: [`api/reports/a1/RESULTS.md`](api/reports/a1/RESULTS.md).

## Kiến trúc

```text
                    ┌──────────────────────── ui/ (React + Vite) ─────────────────────────────┐
                    │  Storefront   │  Chat Assistant  │  Inspector (glass-box)  │  /admin     │
                    └───────┬───────────────┬──────────────────┬───────────────────┬─────────┘
                            │ REST + SSE  (/api/v1, OpenAPI)                        │ JWT
┌───────────────────────────▼──────────────────────────────────────────────────────▼─────────┐
│ api/  FastAPI                                                                               │
│  interfaces (routers, schemas, SSE, auth, error mapping)                                    │
│  application (use cases: SearchProducts, AskRAG, Chat, Compare, ComposeSearch, RunEval…)    │
│  domain (Product, Query, Candidate, Document, Trace, Pipeline spec, ports/protocols)        │
│  infrastructure (adapters)                                                                  │
│     Embedders: SigLIP2 · E5/BGE        Search: Elasticsearch       LLM: OpenAI · (Ollama)   │
│     Rerankers: noop · cross-encoder    DB: PostgreSQL (SQLAlchemy)  Cache: in-proc / Redis*  │
│  pipeline engine (registry + YAML pipelines + tracer)                                       │
└──────────────┬───────────────────────────────┬─────────────────────────────┬───────────────┘
               │                               │                             │
       Elasticsearch 8.15              PostgreSQL 16                  OpenAI API
  products / reviews / policies   users, chat, traces, feedback,
  (aliases → versioned indexes)   configs, policies CMS, eval runs
               ▲
               │  offline pipeline (CLI, có thể chạy từ Admin dưới dạng job)
   prepare → embed (per embedder) → create_index → index → validate → switch alias
```

`*` Redis và Ollama là tuỳ chọn (compose profile `cache`, `llm-local`).
Chi tiết: [`docs/architecture.md`](docs/architecture.md) và các ADR trong [`docs/adr/`](docs/adr/).

## Bắt đầu nhanh (5 phút)

Yêu cầu: Docker + Docker Compose, Python 3.11+, Node 22+, GNU make, khoảng 10 GB đĩa trống
(image có torch CPU, model cache, ảnh sản phẩm).

```bash
cp .env.example .env     # điền OPENAI_API_KEY nếu muốn dùng chat/RAG; đổi JWT_SECRET, ADMIN_PASSWORD
make setup               # pip install -e 'api[dev]' + npm ci
make up                  # elasticsearch + postgres + api + frontend (docker compose up -d --build)
make seed                # dữ liệu demo + tài khoản admin (scripts.seed_demo)
make ps                  # chờ api ở trạng thái healthy
```

Index sản phẩm cần dữ liệu và embedding đã sinh. Nếu đã có `api/data/a1_abo_1500/` và
`api/data/embeddings/abo_a1_1500_v1/`, chỉ cần `make index` (và `make index-policies` cho chat).
Quy trình dựng lại từ đầu nằm ở [`api/README.md`](api/README.md#apply-the-current-a1-workflow).

| Địa chỉ | Nội dung |
|---|---|
| <http://localhost:5173> | Storefront |
| <http://localhost:5173/admin> | Admin console (tài khoản `ADMIN_USERNAME` / `ADMIN_PASSWORD` trong `.env`) |
| <http://localhost:5173/lab> | Retrieval lab |
| <http://localhost:8000/docs> | API docs (OpenAPI / Swagger) |
| <http://localhost:8000/health>, `/ready` | Liveness, readiness |
| <http://localhost:9200> | Elasticsearch |

Không có `OPENAI_API_KEY` thì tìm kiếm, trợ lý tìm sản phẩm (ý định `product_search`), so sánh dạng bảng
và toàn bộ admin vẫn chạy; câu hỏi cần RAG trả `503 llm_unavailable`.
Dùng LLM cục bộ: `docker compose --profile llm-local up -d ollama`.

`make help` liệt kê mọi lệnh.

### Chạy local không cần Docker (Windows / Linux)

Cần Elasticsearch 8.15 chạy ở `:9200` (bản zip chính thức, `discovery.type: single-node`,
`xpack.security.enabled: false`), Python 3.11+ và Node 22+.

```bash
cd api && python -m venv .venv && .venv/Scripts/python -m pip install -e '.[dev,text-embed,viz]'   # Linux: .venv/bin/python
export PYTHONUTF8=1                                   # Windows
python -m scripts.prepare_a1_abo_subset --output data/a1_abo_1500 --limit 1500 --seed 42 --max-per-category 150 --force
python -m scripts.generate_embeddings --input data/a1_abo_1500/products.jsonl --output-dir data/embeddings/abo_a1_1500_v1 --dataset-version abo_a1_1500_v1 --device cpu --force
python -m scripts.generate_embeddings --input data/a1_abo_1500/products.jsonl --output-dir data/embeddings/abo_a1_1500_v1_text_e5 --dataset-version abo_a1_1500_v1_text_e5 --embedder text_e5 --device cpu --force
cd .. && make index embedding-map            # hoặc chạy các lệnh tương ứng trong Makefile
cd api && python -m scripts.generate_knowledge_embeddings --source policy --input data/policies/shopmind_policies.jsonl --dataset-version policies_a3_v1 --output-dir data/embeddings/policies_a3_v1 --force
python -m scripts.index_policies --input data/policies/shopmind_policies.jsonl --embeddings data/embeddings/policies_a3_v1 --index-name policies_a3_v1 --switch-alias
SHOPMIND_PROFILE=dev python -m scripts.seed_demo   # SQLite data/shopmind.db, admin/admin, policy CMS, giá/tồn kho tổng hợp
cd .. && make dev-api                        # http://127.0.0.1:8000
cd ui && npm ci && cd .. && make dev-ui      # http://localhost:5173 (proxy tới 127.0.0.1:8000)
```

Trên Windows không có `make`: chạy `apiun-api-local.cmd` và `uiun-ui-local.cmd` (cùng cấu hình như `make dev-api` / `make dev-ui`).

Lưu ý Windows: dùng `127.0.0.1` thay vì `localhost` cho API (phân giải IPv6 `::1` trước làm mỗi request chậm ~2 giây).

## Cấu trúc dự án

```text
.
├── api/                       FastAPI backend (Python 3.11+)
│   ├── shopmind/              package ứng dụng (domain / application / infrastructure / interfaces / bootstrap / ingestion)
│   ├── configs/               app.yaml, experiments/*.yaml, experiments/rag/*.yaml (overlay)
│   ├── scripts/               CLI offline: prepare, generate_embeddings, create_index, index_*, seed_demo
│   ├── evaluation/            runner, ablation, metric, benchmark A1 (seed 42)
│   ├── tests/                 unit, api, evaluation, a3, integration
│   ├── data/                  dataset, embedding, policy (phần lớn được sinh ra, không commit)
│   ├── reports/               báo cáo A1/accuracy (số liệu lấy từ metrics.json)
│   ├── Dockerfile, docker-entrypoint.sh
│   └── pyproject.toml
├── ui/                        React + Vite (storefront, chat, inspector, admin)
├── docs/                      architecture.md, adr/, DEMO_SCRIPT.md, REFACTOR_PLAN.md, API_CONTRACT.md
├── scripts/ci/                check_hardcode.sh (guard CI)
├── .github/workflows/ci.yml   ruff + pytest + npm test/build + integration + hardcode guard
├── docker-compose.yml         elasticsearch, postgres, api, frontend (+ tools, ollama, redis theo profile)
├── Makefile
└── .env.example
```

## Kiểm thử và đánh giá

```bash
make test               # pytest nhanh (không cần ES, không tải model) + npm test
make test-integration   # cần Elasticsearch đang chạy (make up)
make lint               # ruff + npm run build
pre-commit install      # hook: ruff, yaml, whitespace, file lớn, private key

make embed              # sinh embedding SigLIP2 (+ text embedder) trong container, CPU
make index              # create_index + index_products, đổi alias products
make eval-a1            # ablation A1 + image run → api/runs/a1/
make eval-rag           # RAG s0–s3 (không gọi LLM) → api/runs/a3/
make eval-rag RAG_CONFIGS='configs/experiments/rag/s[0-5]_*.yaml'   # s4–s5 cần OPENAI_API_KEY
```

Mọi thứ tải SigLIP2 chạy trong container `tools` trên CPU (Python 3.13 + MPS trên host bị crash khi
nạp model). Mỗi run ghi `config.yaml`, `metrics.json`, `results.jsonl`, `errors.jsonl`, `summary.md`.
Số liệu trong `api/reports/` phải lấy từ `metrics.json`; qrels là nhãn seed, cần người duyệt trước khi
báo cáo.

## Dữ liệu và giấy phép

- **Amazon Berkeley Objects (ABO):** trang tải chính thức ghi CC BY 4.0, còn AWS Registry ghi
  CC BY-NC 4.0. Dự án áp dụng cách hiểu **thận trọng CC BY-NC 4.0**: chỉ dùng cho học thuật, phi
  thương mại, ghi nguồn Amazon.com và nhóm tác giả ABO; không phân phối lại ảnh hay metadata trong repo
  (dataset được tải và sinh cục bộ bởi `scripts.prepare_a1_abo_subset`).
- **Review Amazon** không được đóng gói kèm; người dùng tự cung cấp file và tuân theo điều khoản của nguồn.
- **Giá, tồn kho và policy cửa hàng là dữ liệu tổng hợp / thử nghiệm** (`synthetic`, `experimental`),
  được gắn nhãn trên UI và trong báo cáo. Đây không phải điều khoản thật của bất kỳ cửa hàng nào, và
  các ca RAG seed không được trình bày như chất lượng câu trả lời đã đo.

## Tài liệu thêm

- [`api/README.md`](api/README.md): pipeline A1/A3 chi tiết, API, đánh giá.
- [`ui/README.md`](ui/README.md): phát triển frontend, mock mode.
- [`docs/architecture.md`](docs/architecture.md), [`docs/adr/`](docs/adr/), [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).
