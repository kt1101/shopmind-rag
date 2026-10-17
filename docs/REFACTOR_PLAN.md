# ShopMind: kế hoạch refactor và nâng cấp thành sản phẩm hoàn chỉnh

> Phiên bản: 2026-10-16 · Phạm vi: toàn bộ monorepo (`api/`, `ui/`, hạ tầng)
> Mục tiêu: biến đồ án từ "demo retrieval + RAG" thành **một sản phẩm thương mại thu nhỏ**, minh bạch được từng bước xử lý (glass-box), cấu hình được, và có thêm vài tính năng mới đủ ấn tượng nhưng **không dàn trải**.

---

## 0. Tóm tắt (TL;DR)

1. **Sửa lõi trước, làm đẹp sau.** Dense retrieval bằng text hiện gần như hỏng (Recall@10 = 0.0125, holdout nDCG = 0.0). Hybrid RRF đang *kéo tụt* BM25. Nếu không sửa thì mọi tính năng "AI" phía trên đều đứng trên nền yếu. → Thêm một **text embedder đa ngôn ngữ riêng** (ví dụ `intfloat/multilingual-e5-base` / `BAAI/bge-m3`), giữ SigLIP2 cho ảnh và cross-modal.
2. **Kiến trúc chuẩn: Clean Architecture / Ports & Adapters (Hexagonal)** cho backend, **Feature-Sliced Design** cho frontend, **12-Factor** cho cấu hình. Mọi thành phần (embedder, retriever, fusion, reranker, LLM, prompt, index alias, bước pipeline) đều **khai báo trong YAML + registry**, không hard-code.
3. **Glass-box làm điểm nhấn chính để chấm điểm.** Mỗi request search/RAG sinh ra một **Pipeline Trace** (từng bước, input/output, điểm số, thời gian, lý do). UI có **Search Inspector**, **RAG Inspector** và **bản đồ embedding 2D** để giảng viên thấy *vì sao* ra kết quả đó.
4. **Bổ sung đúng các cấu phần của một sản phẩm:** PostgreSQL (lịch sử chat, log, trace, feedback, config, policy CMS), **Admin Console** (dashboard, quản lý pipeline/config, index, policy, chạy đánh giá, gán nhãn).
5. **Bốn tính năng mới được chọn lọc** (đều xoay quanh search + RAG):
   - **F1. Tìm kiếm kết hợp ảnh + chữ** ("giống ảnh này nhưng màu đen").
   - **F2. Trợ lý mua sắm hiểu ý định**: tự trích bộ lọc từ câu tự nhiên, chat nhận cả ảnh.
   - **F3. So sánh sản phẩm có trích dẫn** (RAG cho 2–3 sản phẩm).
   - **F4. Vòng phản hồi và đánh giá online** (like/dislike, gán nhãn relevance → qrels → chạy lại eval).
   - Tuỳ chọn nếu còn thời gian: **F5. Tóm tắt review theo khía cạnh** (ưu/nhược điểm có trích dẫn).

---

## 1. Hiện trạng: điểm mạnh và vấn đề

### 1.1 Điểm mạnh nên giữ

- Pipeline offline tách stage, có artifact (`products.jsonl` → embeddings → index), index có version + alias, có validate trước khi đổi alias. Đây là nền tốt, **giữ nguyên tư tưởng**.
- Có A1 benchmark (Recall/nDCG/MRR), ablation, `runs/` tái lập được; A3 có lộ trình thí nghiệm `s0–s5`.
- RAG có kiểm tra citation (ID phải nằm trong context đã gửi, retry 1 lần), abstain khi thiếu bằng chứng, streaming SSE.
- `create_app(..., auto_wire=False)` cho phép inject fake để test. Test unit/api/a3 khá đầy đủ.

### 1.2 Vấn đề chất lượng lõi

| # | Vấn đề | Bằng chứng | Hệ quả |
|---|---|---|---|
| Q1 | Dense text gần như không hoạt động | `reports/a1/RESULTS.md`: Dense Recall@10 = 0.0125; `reports/accuracy`: dense holdout = 0.0 | Hybrid RRF tệ hơn BM25 (0.325 vs 0.4625). Hiện phải dùng `lexical_preserving` để che lỗi |
| Q2 | SigLIP2 được dùng cho text↔text, cắt cứng ở 64 token | `embedding/siglip2.py` (`max_length=64`) | SigLIP được huấn luyện cho text↔image, không tối ưu cho tìm mô tả dài, tiếng Việt yếu |
| Q3 | Hiểu truy vấn dựa trên từ điển hard-code | `retrieval/language.py` (CATEGORY_ALIASES, COLOR_ALIASES nằm trong code) | Khó mở rộng, không cấu hình được |
| Q4 | Chưa có chỉ số chất lượng câu trả lời RAG thật | `reports/accuracy`: "Real LLM answer accuracy … remain null" | Chưa chứng minh được RAG tốt |

### 1.3 Vấn đề kiến trúc và hard-code

| Vị trí | Hard-code / nợ kỹ thuật |
|---|---|
| `rag/service.py` | `REVIEW_INDEX_ALIAS = "reviews"`, `"policies"`; prompt `ANSWER_INSTRUCTIONS` viết thẳng trong code |
| `core/config.py` | `RAGLLMConfig.provider: Literal["openai"]`; `retrieval.default_mode: str` (không validate); `embedding.provider` có nhưng không được dùng để chọn class |
| `main.py::_wire_runtime` | Lắp ráp thủ công: luôn `SigLIP2EmbeddingProvider`, luôn `NoOpReranker` cho A1; ~15 exception handler lặp lại |
| `configs/retrieval.yaml` vs `configs/app.yaml` | Trùng lặp khoá `retrieval/fusion/reranker` |
| `create_app(...)` | 13 tham số keyword, state rải trên `app.state.*` |
| UI | Package tên `test-ui`; có cả `package-lock.json` và `yarn.lock`; JS thuần, không type; logic gọi API, state, view trộn trong component lớn (`LabPage.jsx` 342 dòng) |
| Repo | `api/shopmind.egg-info/` đang được commit |

### 1.4 Thiếu so với một "sản phẩm"

- Không có **database** nghiệp vụ (chỉ có Elasticsearch): không lưu lịch sử chat, phản hồi người dùng, log truy vấn, cấu hình.
- Không có **Admin page**, không có xác thực.
- Không có **giải thích kết quả** cho người xem (chỉ có `POST /debug/search` trả điểm thành phần).
- Chat widget chưa nhận ảnh (tìm bằng ảnh hiện chỉ nằm ở `SearchBar`).
- Dữ liệu ABO **không có giá, tồn kho, rating** → trang sản phẩm trông chưa "thương mại".

---

## 2. Nguyên tắc thiết kế

1. **Config over code:** thêm/đổi model, thuật toán, bước pipeline bằng YAML. Code chỉ đăng ký *implementation* vào registry.
2. **API-first:** mọi chức năng (kể cả admin, trace, đánh giá) đều qua REST `/api/v1` có OpenAPI. UI chỉ là một client.
3. **Glass-box by default:** mỗi bước pipeline phải tự mô tả: nó nhận gì, trả gì, mất bao lâu, vì sao.
4. **Trung thực dữ liệu:** dữ liệu tổng hợp (giá, policy) phải được gắn nhãn `synthetic`/`experimental` trên UI và trong báo cáo, theo đúng quy ước hiện có trong `CLAUDE.md`.
5. **Scope có kỷ luật:** mỗi hạng mục được gắn MoSCoW (Must / Should / Could / Won't). Chỉ làm "Could" khi "Must" đã xong và có số đo.

---

## 3. Kiến trúc đích

### 3.1 Tổng thể

```text
                    ┌──────────────────────── ui/ (React + TS + Vite) ────────────────────────┐
                    │  Storefront   │  Chat Assistant  │  Inspector (glass-box)  │  /admin     │
                    └───────┬───────────────┬──────────────────┬───────────────────┬─────────┘
                            │ REST + SSE  (/api/v1, OpenAPI-generated client)       │ JWT
┌───────────────────────────▼──────────────────────────────────────────────────────▼─────────┐
│ api/  FastAPI                                                                               │
│  interfaces (routers, schemas, SSE, auth, error mapping)                                    │
│  application (use cases: SearchProducts, AskRAG, Chat, Compare, ComposeSearch, RunEval…)    │
│  domain (Product, Query, Candidate, Document, Trace, Pipeline spec, ports/protocols)        │
│  infrastructure (adapters)                                                                   │
│     Embedders: SigLIP2 · E5/BGE        Search: Elasticsearch       LLM: OpenAI · (Ollama)   │
│     Rerankers: noop · cross-encoder    DB: PostgreSQL (SQLAlchemy)  Cache: in-proc / Redis*  │
│  pipeline engine (registry + YAML pipelines + tracer)                                       │
└──────────────┬───────────────────────────────┬─────────────────────────────┬───────────────┘
               │                               │                             │
       Elasticsearch 8.15              PostgreSQL 16                  OpenAI API
  products / reviews / policies   users, chat, traces, feedback,
  (aliases → versioned indexes)   configs, policies CMS, eval runs
               ▲
               │  offline pipeline (CLI, có thể kích hoạt từ Admin dưới dạng job)
   prepare → embed (per embedder) → create_index → index → validate → switch alias
```

`*` Redis là tuỳ chọn (Could). Mặc định dùng cache trong tiến trình.

### 3.2 Chuẩn kiến trúc backend: Clean Architecture / Hexagonal

Quy tắc phụ thuộc: `interfaces → application → domain ← infrastructure`. Domain không import FastAPI, Elasticsearch, torch hay OpenAI.

Cấu trúc thư mục đích (`api/shopmind/`):

```text
shopmind/
  domain/                 # thuần Python, không phụ thuộc framework
    models/               # Product, SearchQuery, Candidate, KnowledgeDocument, Citation, Trace, Feedback
    ports/                # Protocols: Embedder, Retriever, Fuser, Reranker, LLM, ProductRepo, TraceStore…
    errors.py             # lỗi nghiệp vụ (ProductNotFound, InvalidFilter, InsufficientEvidence…)
  application/            # use case, mỗi file một nghiệp vụ
    search/               # search_text.py, search_image.py, compose_search.py, explain.py
    rag/                  # ask.py, chat.py, compare.py, review_insights.py
    admin/                # manage_config.py, manage_index.py, manage_policies.py, run_eval.py
    feedback/             # submit_feedback.py, label_relevance.py
  pipeline/               # engine chung cho A1 và A3
    registry.py           # @register("retriever", "bm25")
    spec.py               # Pydantic model của pipeline YAML
    engine.py             # chạy các step theo spec, gom trace
    steps/                # query_understanding, retrieve, fuse, rerank, context, generate, validate
    tracing.py            # StepTrace, PipelineTrace, timer, redaction (không ghi vector/ảnh)
  infrastructure/
    embedding/            # siglip2.py, sentence_transformer.py (E5/BGE)
    elasticsearch/        # client, product_repo, knowledge_repo, index_admin
    llm/                  # openai_provider.py, ollama_provider.py (Could), prompt_loader.py
    rerank/               # cross_encoder.py, noop.py
    db/                   # SQLAlchemy models, repositories, alembic/
  interfaces/
    http/
      routers/            # public/, debug/, admin/
      schemas/
      deps.py             # FastAPI Depends: lấy use case từ container
      errors.py           # bảng ánh xạ exception → (status, code), thay cho 15 handler lặp
      sse.py
    cli/                  # entry points cho scripts (gọi lại application layer)
  bootstrap/
    settings.py           # pydantic-settings: YAML + env (12-factor)
    container.py          # Composition root: đọc config → registry → dựng object
    app.py                # create_app()
pipeline/ offline (giữ trong shopmind/pipeline_offline/ hoặc đổi tên thành ingestion/)
```

Gợi ý: đổi tên module offline hiện tại `shopmind/pipeline/` thành `shopmind/ingestion/` để không nhầm với pipeline engine runtime.

**Migration an toàn:** di chuyển từng module, giữ test xanh sau mỗi bước. Không viết lại thuật toán khi đang chuyển cấu trúc. Thứ tự: `domain` → `pipeline` engine (bọc logic hiện có) → `bootstrap/container` thay `_wire_runtime` → routers → xoá code cũ.

### 3.3 Chuẩn kiến trúc frontend: Feature-Sliced Design

```text
ui/src/
  app/            # router, providers (QueryClient, Auth, Theme), layout
  pages/          # catalog, search, product, compare, admin/*
  widgets/        # SiteHeader, ChatWidget, InspectorDrawer, EmbeddingMap
  features/       # search-bar, image-search, compose-search, ask-product, compare, feedback
  entities/       # product, trace, citation, chat-message (type + UI nhỏ)
  shared/
    api/          # client sinh từ OpenAPI (openapi-typescript) + TanStack Query hooks
    ui/           # design system: Button, Card, Badge, Drawer, Tabs, Skeleton, Toast
    lib/          # format, urlState
```

Nâng cấp kỹ thuật: **TypeScript**, **TanStack Query** (cache, loading, retry), client API **sinh tự động từ OpenAPI** (không viết tay `fetch`), **Vitest + Testing Library** (giữ test hiện có), một lockfile duy nhất (`npm`), đổi tên package thành `shopmind-ui`. Admin là một nhánh route `/admin` lazy-load trong cùng SPA để không phải dựng thêm app.

### 3.4 Cấu hình: phân lớp và registry

**Phân lớp (ưu tiên từ thấp đến cao):** `configs/base.yaml` → `configs/profiles/<profile>.yaml` (`dev`, `demo`, `eval`) → biến môi trường (`SHOPMIND__RAG__LLM__MODEL=...`, dùng `pydantic-settings` với `env_nested_delimiter="__"`) → *runtime override* do Admin lưu trong DB (chỉ cho các khoá được phép "hot-reload").

Giữ quy ước `extra="forbid"` hiện có. Gộp `configs/retrieval.yaml` vào `base.yaml`.

**Registry thành phần**, ví dụ:

```python
@register("embedder", "siglip2")
class SigLIP2Embedder: ...

@register("embedder", "sentence_transformer")
class SentenceTransformerEmbedder: ...

@register("fuser", "rrf")
def rrf(rankings, k: int = 60, weights: list[float] | None = None): ...
```

**Cấu hình đích (trích):**

```yaml
embedders:
  siglip2:            # ảnh + cross-modal
    impl: siglip2
    model_name: google/siglip2-base-patch16-224
    revision: 75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2
    max_text_tokens: 64
  text_e5:            # text ↔ text, đa ngôn ngữ (vi/en)
    impl: sentence_transformer
    model_name: intfloat/multilingual-e5-base
    query_prefix: "query: "
    passage_prefix: "passage: "

indexes:              # chỉ alias, không bao giờ là tên index vật lý
  products: { alias: products, vectors: { text_vector: text_e5, image_vector: siglip2 } }
  reviews:  { alias: reviews,  vectors: { text_vector: text_e5 } }
  policies: { alias: policies, vectors: { text_vector: text_e5 } }

llm:
  default: openai_mini
  providers:
    openai_mini: { impl: openai, model: gpt-5.4-mini, timeout_seconds: 60 }
    # local:     { impl: ollama, model: qwen2.5:7b, base_url: http://ollama:11434 }

prompts:              # prompt là file, có version, không nằm trong code
  answer:  prompts/answer.v2.md
  rewrite: prompts/rewrite.v1.md
  compare: prompts/compare.v1.md
  query_understanding: prompts/query_understanding.v1.md

vocabularies:         # thay cho dict hard-code trong retrieval/language.py
  category_aliases: data/vocab/category_aliases.yaml
  color_aliases:    data/vocab/color_aliases.yaml

pipelines:
  search.hybrid:
    steps:
      - { step: query_understanding, impl: rules }          # hoặc impl: llm
      - { step: retrieve, id: lexical, impl: bm25, params: { candidate_k: 100 } }
      - { step: retrieve, id: semantic, impl: dense, params: { field: text_vector, embedder: text_e5, candidate_k: 100 } }
      - { step: fuse, impl: rrf, params: { k: 60, weights: [1.0, 1.0] } }
      - { step: rerank, impl: noop }
  search.image:
    steps:
      - { step: retrieve, impl: dense, params: { field: image_vector, embedder: siglip2, input: image } }
  search.compose:                                           # F1
    steps:
      - { step: compose_query, impl: weighted_sum, params: { image_weight: 0.7, text_weight: 0.3 } }
      - { step: retrieve, impl: dense, params: { field: image_vector, embedder: siglip2 } }
      - { step: rerank, impl: attribute_boost, params: { fields: [color] } }
  rag.answer:
    steps:
      - { step: rewrite, impl: llm, when: has_history }
      - { step: multi_source_retrieve, sources: { product: search.hybrid, review: knowledge.hybrid, policy: knowledge.hybrid } }
      - { step: fuse, impl: rrf, params: { k: 60, top_k: 40 } }
      - { step: rerank, impl: cross_encoder, params: { model: BAAI/bge-reranker-v2-m3, top_k: 12 }, enabled: false }
      - { step: build_context, params: { max_documents: 12, per_source: { product: 4, review: 5, policy: 3 }, max_characters: 24000 } }
      - { step: generate, llm: openai_mini, prompt: answer }
      - { step: validate_citations, params: { max_attempts: 2 } }
```

Các file `configs/experiments/*.yaml` và `configs/experiments/rag/*.yaml` hiện có trở thành **overlay lên `pipelines`**, nên evaluation và runtime dùng chung một engine (hiện A1 và A3 có hai module fusion/reranker song song; sau refactor còn một).

> Ghi chú: `hybrid_no_rrf` vẫn là pipeline chỉ dùng cho đánh giá, không đưa ra `SearchMode` public (giữ quy ước hiện tại).

---

## 4. Phần A: sửa lõi tìm kiếm (Must)

| ID | Việc | Chi tiết | Tiêu chí chấp nhận |
|---|---|---|---|
| A-1 | Text embedder riêng | Thêm `SentenceTransformerEmbedder` (E5/BGE đa ngôn ngữ). Sinh artifact `data/embeddings/<version>/` theo từng embedder; manifest ghi `embedder_id`. Index products có thêm field `text_vector` (dims theo model). SigLIP2 giữ `image_vector` và cross-modal | Dense text Recall@10 trên benchmark A1 **> BM25** ở nhóm câu semantic; hybrid RRF **≥** BM25 tổng thể. Ghi số đo vào `reports/` từ `metrics.json` |
| A-2 | Văn bản để embed | Chuẩn hoá `title + brand + category + attributes chính (color, material…) + description rút gọn` thành template trong config | Template thay được bằng YAML, có test |
| A-3 | Bỏ hard-code từ điển | Chuyển `CATEGORY_ALIASES`, `COLOR_ALIASES` sang `data/vocab/*.yaml`; Admin sửa được | Test hiện có của `language.py` vẫn xanh |
| A-4 | RRF có trọng số + chuẩn hoá điểm | `rrf(weights=…)`, thêm tuỳ chọn `linear` (min-max) để so sánh trong ablation | Có dòng mới trong bảng ablation |
| A-5 | Reranker cho A1 | Cho phép bật cross-encoder ở pipeline search (hiện chỉ có ở A3) | Ablation có/không rerank |
| A-6 | Chạy lại ablation | BM25 / dense(E5) / cross-modal / hybrid / hybrid+rerank, tách en/vi | `reports/a1/RESULTS.md` cập nhật, ghi rõ qrels là nhãn seed chưa duyệt bởi người |

---

## 5. Phần B: Glass-box, giải thích quy trình (Must, điểm nhấn để chấm)

### 5.1 Backend: Pipeline Trace

Mỗi step trong engine ghi một `StepTrace`:

```json
{
  "step": "fuse", "impl": "rrf", "params": {"k": 60},
  "started_ms": 41.2, "duration_ms": 0.8,
  "input": {"lexical": 100, "semantic": 100},
  "output": [{"id": "B07X…", "rank": 1, "score": 0.0325,
              "contributions": {"lexical": {"rank": 1, "rrf": 0.0164}, "semantic": {"rank": 3, "rrf": 0.0159}}}],
  "notes": ["query detected as descriptive (vi) → adaptive chose hybrid"]
}
```

- Trả về khi request có `?explain=true` (hoặc header), lưu vào bảng `pipeline_traces` với `trace_id` = `request_id`.
- `GET /api/v1/traces/{trace_id}` để xem lại; Admin có Trace Explorer.
- BM25: dùng ES `explain` + `highlight` để lấy **từ nào khớp, ở field nào, đóng góp bao nhiêu**.
- Lọc: ghi rõ bộ lọc được giải theo kiểu *exact catalog match* hay *substring/prefix fallback* (logic đã có trong `repository.py`, chỉ cần đưa ra trace).
- RAG: câu hỏi gốc → câu hỏi độc lập (rewrite), ứng viên theo nguồn, sau fuse, sau rerank (điểm trước/sau), **context thật sự được gửi** (cái gì bị cắt vì ngân sách và lý do), prompt đã render (đã che API key), output có cấu trúc thô của LLM, kết quả kiểm tra citation (lần 1 bị loại vì sao, lần 2), token usage, ước tính chi phí.
- Chat streaming: thêm SSE event `step` để UI vẽ tiến trình theo thời gian thực ("Đang viết lại câu hỏi → Đang tìm 3 nguồn → Đang xếp hạng lại → Đang sinh câu trả lời").
- Quy tắc bảo mật giữ nguyên: **không ghi bytes ảnh và vector** vào log/trace (chỉ ghi dims, norm, hash).

### 5.2 Frontend: Inspector

- **Search Inspector** (drawer bên phải, bật bằng nút "Vì sao có kết quả này?"):
  - Tab *Truy vấn*: ngôn ngữ phát hiện, token sau chuẩn hoá, alias đã áp dụng, chế độ adaptive đã chọn và lý do, bộ lọc đã giải.
  - Tab *Xếp hạng*: bảng so sánh rank BM25 / dense / fused cho từng sản phẩm, **biểu đồ "rank movement"** (đường nối rank ở từng retriever đến rank cuối), công thức RRF điền số thật.
  - Tab *Từ khoá khớp*: highlight thuật ngữ khớp trong tiêu đề/mô tả kèm điểm BM25 theo field.
  - Tab *Hiệu năng*: waterfall thời gian từng step.
  - Tab *Truy vấn ES*: query DSL dạng JSON (cho người muốn xem sâu).
- **RAG Inspector** (trong chat và Q&A sản phẩm): timeline các step, danh sách tài liệu theo nguồn với điểm, context cuối cùng, mỗi câu trả lời gắn **citation chip** bấm vào mở đúng đoạn bằng chứng.
- **Embedding Map** (trang `/lab/embeddings`): chiếu 2D (PCA/UMAP tính offline) toàn bộ 1.500 sản phẩm, tô màu theo category; khi tìm kiếm, điểm truy vấn và top-k hiển thị trên bản đồ. Dùng PCA để chiếu điểm truy vấn trực tiếp (UMAP chỉ cho nền tĩnh). Có thể chuyển giữa không gian text-E5, text-SigLIP và image-SigLIP để **thấy trực quan vì sao dense SigLIP text cũ kém**.
- **Lab so sánh** (nâng cấp `LabPage` hiện có): chọn 2 pipeline bất kỳ từ config, chạy cùng truy vấn, xem kết quả song song và chỉ số overlap.

---

## 6. Phần C: cấu phần sản phẩm

### 6.1 Database: PostgreSQL 16 + SQLAlchemy 2 + Alembic (Must)

Elasticsearch vẫn là **search store** (read model). PostgreSQL là **system of record** cho nghiệp vụ:

| Bảng | Nội dung |
|---|---|
| `users` | Tài khoản admin/annotator (bcrypt), role |
| `chat_sessions`, `chat_messages` | Lịch sử hội thoại (ẩn danh theo session cookie cho shopper) |
| `search_events` | Truy vấn, mode, pipeline, latency, số kết quả, sản phẩm được click (không lưu vector/ảnh) |
| `pipeline_traces` | Trace JSONB theo `trace_id`, có TTL/retention trong config |
| `feedback` | 👍/👎 cho kết quả search và câu trả lời RAG, lý do, comment |
| `relevance_judgments` | Nhãn relevance (query, product, grade, annotator) → xuất ra qrels |
| `config_profiles` | Các phiên bản config runtime (ai sửa, khi nào, diff), có rollback |
| `policies` | Policy CMS: nội dung, version, trạng thái (draft/published) → job index lại |
| `products_overlay` | Thông tin thương mại bổ sung: giá, tồn kho **tổng hợp, gắn cờ `synthetic=true`** |
| `jobs` | Job nền: build index, sinh embedding, chạy eval (trạng thái, log, thời gian) |
| `eval_runs` | Metadata + metrics từ `runs/*/metrics.json` để Admin so sánh |

### 6.2 Admin Console `/admin` (Must: 1–4, Should: 5–7)

1. **Dashboard:** số truy vấn/ngày, p50/p95 latency theo pipeline, tỉ lệ zero-result, tỉ lệ abstain của RAG, tỉ lệ 👍, top truy vấn không có kết quả (gợi ý cải thiện từ điển).
2. **Pipeline & Config:** xem config hiệu lực (đã merge các lớp), sửa các khoá cho phép hot-reload (top_k, rrf_k, weights, bật/tắt reranker, chọn LLM, chọn prompt version), lưu thành profile, rollback. Validate bằng chính Pydantic model trước khi áp dụng.
3. **Trace Explorer:** tìm theo request_id/truy vấn/thời gian, mở Inspector đầy đủ.
4. **Index Management:** xem alias → index vật lý, số doc, dims, embedder; chạy job tạo index mới + validate + switch alias (bọc lại các script hiện có, không viết lại).
5. **Policy CMS:** sửa policy → publish → job re-embed + index `policies_vN+1` → switch alias. Demo hay: sửa "30 ngày" thành "14 ngày" và chatbot trả lời theo policy mới, kèm citation version mới.
6. **Evaluation Center:** chạy `evaluation.runner/ablation` dưới dạng job, bảng so sánh các run, biểu đồ metric theo en/vi và theo loại truy vấn, danh sách ca lỗi (error-cases) để phân tích.
7. **Annotation:** giao diện gán nhãn relevance nhanh (hiện query + top-k, chấm 0/1/2), xuất ra `qrels`, có chỉ số đồng thuận giữa 2 người (Cohen's kappa). Giải quyết luôn yêu cầu "qrels cần người duyệt" trong `CLAUDE.md`.

### 6.3 Xác thực và bảo mật (Must, tối giản)

- JWT cho `/api/v1/admin/*` và `/api/v1/debug/*`; storefront công khai.
- Rate limit đơn giản cho `/rag` và `/chat` (theo IP/session) để tránh tốn chi phí LLM khi demo công khai.
- CORS, giới hạn kích thước ảnh (đã có), che secret trong trace.
- Prompt-injection: giữ chỉ dẫn "evidence là dữ liệu"; thêm bộ test ca tấn công trong `tests/a3`.

### 6.4 Storefront UI/UX (Must)

- **Design system** nhỏ (token màu, typography, spacing, dark mode) và bộ component dùng chung; skeleton loading, empty state, error state, toast.
- **Tìm kiếm:** autocomplete (sản phẩm + category + brand), facet có **đếm số lượng** (ES aggregations), chip bộ lọc, sắp xếp, "Có phải bạn muốn tìm…" (gợi ý khi zero-result), giữ trạng thái trên URL (đã có `urlState`).
- **Trang sản phẩm:** gallery ảnh, thuộc tính, giá/tồn kho (synthetic, có ghi chú), **"Sản phẩm tương tự về hình ảnh"** (image kNN, gần như miễn phí), khung hỏi đáp RAG với câu hỏi gợi ý.
- **Giỏ hàng / yêu thích:** lưu cục bộ (localStorage), *không* có thanh toán (Won't).
- **Khả năng truy cập & responsive:** điều hướng bàn phím, alt text, layout mobile.
- **Song ngữ vi/en** cho giao diện (i18n nhẹ), vì benchmark có truy vấn tiếng Việt.

---

## 7. Phần D: tính năng mới (chọn lọc)

### F1. Tìm kiếm kết hợp ảnh + chữ: Composed Image Retrieval (Must)

- **Kịch bản:** người dùng tải ảnh một đôi giày và gõ "màu đen" hoặc "nhưng bằng da".
- **Cách làm:** vì SigLIP2 đặt text và ảnh vào cùng một không gian, dùng `q = normalize(α·e_img + β·e_text)` tìm trên `image_vector`, sau đó (tuỳ chọn) rerank tăng điểm cho thuộc tính khớp (color/material lấy từ metadata ABO). α, β nằm trong config, chỉnh được ở Lab bằng thanh trượt và thấy kết quả thay đổi trực tiếp.
- **API:** `POST /api/v1/search/compose` (multipart: `image`, `text`, `alpha`).
- **Đánh giá:** dựng 30–50 truy vấn từ chính dữ liệu: ảnh sản phẩm A + văn bản thuộc tính của sản phẩm B cùng category khác màu → B là đáp án. So sánh image-only, text-only, composed.
- **Vì sao đáng làm:** mới, trực quan, gắn chặt với multimodal (trọng tâm A1), chi phí thấp vì không cần model mới.

### F2. Trợ lý mua sắm hiểu ý định (Must)

- **Query understanding:** từ câu tự nhiên ("tìm ghế sofa xám của Rivet, dưới 500 đô") trích ra `{category: sofa, color: grey, brand: Rivet, price_max: 500}` bằng LLM với structured output, **chỉ chấp nhận giá trị có trong catalog** (tái dùng logic giải bộ lọc hiện có); fallback về rule-based từ `data/vocab` khi không có API key. Trace hiển thị phần nào của câu được hiểu thành bộ lọc nào.
- **Chat nhận ảnh:** widget chat cho phép đính kèm ảnh → định tuyến sang image search hoặc F1 nếu có kèm chữ.
- **Định tuyến ý định:** `product_search` / `product_question` / `policy_question` / `compare` / `chitchat` (rule + LLM, cấu hình được). Kết quả search hiện dạng thẻ sản phẩm ngay trong chat, câu trả lời có citation.
- Không xây agent nhiều bước phức tạp, chỉ định tuyến một bước (giữ scope).

### F3. So sánh sản phẩm có trích dẫn (Must)

- Chọn 2–3 sản phẩm ("Thêm vào so sánh") → trang `/compare`.
- Bảng thuộc tính lấy thẳng từ dữ liệu (không qua LLM), cộng một đoạn **nhận xét do RAG sinh**, mỗi nhận định gắn citation tới đúng thuộc tính/review/policy. Ô nào không có bằng chứng thì ghi "Không có dữ liệu", không suy đoán.
- **API:** `POST /api/v1/rag/compare`. Tái dùng `ContextBuilder` và `CitationValidator`.

### F4. Vòng phản hồi và đánh giá online (Should, nên làm)

- 👍/👎 trên kết quả search và câu trả lời RAG; ghi click-through.
- Admin xem phản hồi, chuyển thành nhãn relevance (6.2-7) → qrels mới → chạy lại eval → so sánh run. Đây là vòng **"đo, cải thiện, đo lại"** khép kín, rất phù hợp để trình bày tư duy kỹ sư IR.
- Chỉ số online trên dashboard: CTR@k, MRR theo click, tỉ lệ 👍 của RAG.

### F5. Tóm tắt review theo khía cạnh (Could)

- Job offline: với sản phẩm có đủ review, LLM tóm tắt ưu/nhược điểm theo khía cạnh (chất lượng, kích cỡ, giao hàng…), **mỗi ý gắn ID review**, cache vào DB, hiển thị trên trang sản phẩm.
- **Rủi ro:** độ phủ review trên tập ABO có thể thấp (xem `scripts/analyze_review_overlap.py`). Chỉ làm nếu độ phủ đủ để demo; nếu không, bỏ.

### Không làm (Won't), để giữ scope

Thanh toán, quản lý đơn hàng thật, đa tenant, recommendation học máy (collaborative filtering), fine-tune model, agent nhiều bước, voice search, mobile app native, Kubernetes.

---

## 8. Thiết kế API (v1)

Chuẩn chung: tiền tố `/api/v1`, JSON `snake_case`, lỗi `{ "error": { "code", "message" }, "request_id" }` (giữ như hiện tại), header `X-Request-ID`, phân trang `limit/offset`, OpenAPI là nguồn sự thật (UI sinh client từ đây).

| Nhóm | Endpoint | Ghi chú |
|---|---|---|
| Health | `GET /health`, `GET /ready` | `ready` báo trạng thái từng thành phần (ES, embedder, LLM, DB) |
| Search | `POST /search/text`, `POST /search/image`, `POST /search/compose`, `GET /search/suggest`, `GET /search/filter-options`, `GET /search/facets` | `?explain=true` trả trace |
| Products | `GET /products`, `GET /products/{id}`, `GET /products/{id}/similar` | |
| RAG | `POST /rag/ask`, `POST /rag/compare` | |
| Chat | `POST /chat`, `POST /chat/stream` (SSE: `meta`, `step`, `delta`, `reset`, `done`, `error`), `GET /chat/sessions/{id}` | |
| Feedback | `POST /feedback` | |
| Traces | `GET /traces/{trace_id}` | yêu cầu quyền debug |
| Meta | `GET /meta/pipelines`, `GET /meta/embedding-map` | danh sách pipeline public, toạ độ 2D |
| Admin | `/admin/auth/login`, `/admin/config` (GET/PUT/rollback), `/admin/indexes`, `/admin/jobs`, `/admin/policies`, `/admin/eval-runs`, `/admin/judgments`, `/admin/stats` | JWT |
| Debug | `POST /debug/search` | giữ tương thích, nội bộ gọi engine + trace |

Hợp đồng công khai của kết quả search giữ nguyên (`product_id, title, image_url, brand, category, score, rank`); điểm thành phần chỉ có trong trace/debug, đúng quy ước hiện tại.

---

## 9. Đánh giá và báo cáo

- **A1:** giữ benchmark seed 42; thêm bộ F1 (composed) và chia en/vi rõ ràng. Báo cáo: bảng ablation + phân tích lỗi + biểu đồ.
- **A3 (RAG):** bổ sung chỉ số
  - *Retrieval:* Recall@k / nDCG của context theo nguồn.
  - *Citation:* citation precision/recall (đã có validator, cần tập nhãn).
  - *Faithfulness & answer relevance:* LLM-as-judge với rubric cố định, model judge khác model sinh, **báo cáo kèm cảnh báo** về độ tin cậy; kiểm tra chéo 30 câu bằng người.
  - *Abstain:* tỉ lệ từ chối đúng/sai trên câu hỏi không có bằng chứng.
- Hợp nhất runner A1/A3 trên cùng pipeline engine; mọi run vẫn ghi `runs/<timestamp>_<name>/` như hiện tại và được nạp vào bảng `eval_runs`.
- Tuân thủ quy ước: số trong `reports/` phải lấy từ `metrics.json`; policy và seed case A3 là **placeholder**, không trình bày như chất lượng đo được.

---

## 10. DevOps và chất lượng mã

- `docker compose` có **profiles**: `core` (es, api, ui), `db` (postgres), `full` (thêm redis/ollama tuỳ chọn). Healthcheck cho mọi service.
- `Makefile` (hoặc `justfile`): `make setup`, `make up`, `make seed` (dữ liệu demo + admin mặc định), `make index`, `make eval`, `make test`, `make lint`.
- **CI GitHub Actions:** ruff + pytest (unit/api/evaluation/a3) + `npm test` + `npm run build` + kiểm tra OpenAPI client đã sinh khớp với backend.
- `pre-commit`: ruff, prettier/eslint, chặn commit file lớn/secret.
- Dọn repo: bỏ `api/shopmind.egg-info/` khỏi git, chỉ giữ một lockfile UI.
- Logging có cấu trúc (JSON) + `request_id`; metrics Prometheus đơn giản ở `/metrics` (Could).
- Tài liệu: `README` gốc (quick start 5 phút), `docs/architecture.md` (sơ đồ C4 mức 1–2), `docs/adr/` (Architecture Decision Records cho các quyết định lớn: chọn E5, chọn Postgres, pipeline engine).

---

## 11. Lộ trình theo giai đoạn

Ước lượng cho nhóm 3–4 người, tổng khoảng **7 tuần**. Mỗi giai đoạn kết thúc bằng demo nội bộ và test xanh.

| Giai đoạn | Thời gian | Nội dung | Kết quả bàn giao |
|---|---|---|---|
| **P0. Nền móng** | Tuần 1 | Dọn repo, CI, Makefile, `pydantic-settings` + phân lớp config, gộp `retrieval.yaml`, bảng ánh xạ lỗi, thêm PostgreSQL + Alembic vào compose | CI xanh; `make up` chạy đủ stack; config không còn trùng |
| **P1. Kiến trúc và pipeline engine** | Tuần 2 | Tạo `domain/ports`, registry, pipeline engine + tracer; bọc retriever/fusion/reranker hiện có thành step; `bootstrap/container` thay `_wire_runtime`; prompt và alias ra file config | Hành vi API không đổi (test cũ xanh); đổi pipeline chỉ bằng YAML |
| **P2. Sửa lõi tìm kiếm** | Tuần 3 | A-1 → A-6: text embedder E5, index v2, RRF có trọng số, rerank cho A1, chạy lại ablation | `reports/a1/RESULTS.md` mới, hybrid ≥ BM25 |
| **P3. Glass-box** | Tuần 4 | Trace API + lưu DB, Search/RAG Inspector, SSE `step`, Embedding Map | Demo được "vì sao" cho mọi truy vấn |
| **P4. Tính năng mới** | Tuần 5 | F1 compose search, F2 query understanding + chat nhận ảnh, F3 compare | 3 tính năng chạy end-to-end có test và số đo F1 |
| **P5. Admin và sản phẩm hoá UI** | Tuần 6 | Auth, Dashboard, Config editor, Trace Explorer, Index management, Policy CMS; design system, facet, similar items, i18n; F4 feedback | Admin dùng được; storefront hoàn chỉnh |
| **P6. Đánh giá, tài liệu, demo** | Tuần 7 | RAG eval (faithfulness/citation/abstain), annotation + kappa, báo cáo, slide, kịch bản demo, F5 nếu còn thời gian | Báo cáo cuối, video/kịch bản demo |

**Đường găng:** P1 (engine) và P2 (embedder) chặn hầu hết phần sau. Nếu trễ, cắt theo thứ tự: F5 → F4 → Policy CMS → Embedding Map. **Không cắt** P2, P3, F1.

### Gợi ý phân công (4 người)

- **Backend core:** P1 engine, container, config, API.
- **Retrieval/ML:** P2 embedder + ablation, F1, đánh giá A1/A3.
- **RAG/LLM:** trace RAG, F2, F3, prompt, eval faithfulness.
- **Frontend:** design system, Inspector, Admin, storefront.

---

## 12. Rủi ro và cách giảm

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Model E5/BGE nặng trên CPU | TB | Dùng bản `small/base`, sinh embedding offline; query embedding nhỏ nên vẫn nhanh. Đo p95 trước khi chọn |
| Refactor làm vỡ hành vi | Cao | Di chuyển từng module, giữ test API làm "golden"; không đổi thuật toán cùng lúc với đổi cấu trúc |
| Phụ thuộc OpenAI (chi phí, không có key khi demo) | TB | Rate limit; cache câu trả lời theo hash (question + context); provider dự phòng (Ollama) qua config; s0–s3 không cần LLM |
| Dữ liệu thiếu giá/review | TB | Giá synthetic có nhãn rõ; F5 phụ thuộc độ phủ review, có điều kiện dừng |
| Scope phình | Cao | MoSCoW + đường găng ở mục 11; chỉ mở "Could" khi "Must" có số đo |
| Nhãn đánh giá chưa được người duyệt | TB | Annotation tool + kappa trong P5/P6; báo cáo ghi rõ trạng thái nhãn |

---

## 13. Kịch bản demo cho giảng viên (≈10 phút)

1. **Storefront:** gõ "giày bốt da màu nâu", mở Search Inspector: alias tiếng Việt → category, bộ lọc trích ra, rank movement BM25 vs dense vs RRF, từ khoá khớp, waterfall thời gian.
2. **Embedding Map:** cùng truy vấn hiện trên bản đồ 2D, chuyển giữa không gian SigLIP-text và E5 để thấy vì sao dense cũ thất bại và dense mới đúng cụm.
3. **F1:** tải ảnh một chiếc túi, gõ "màu đen", kéo thanh α và xem kết quả dịch chuyển.
4. **Chat (F2):** "Tìm sofa xám dưới 500" → thẻ sản phẩm; "Cái thứ hai đổi trả được không?" → rewrite câu hỏi + policy có citation; mở RAG Inspector xem context, prompt, lần kiểm tra citation.
5. **F3:** so sánh 2 sản phẩm, citation trên từng nhận định, ô "Không có dữ liệu".
6. **Admin:** sửa policy 30 → 14 ngày, publish, job reindex, hỏi lại chatbot và thấy câu trả lời mới. Đổi pipeline (bật reranker) trong Config, chạy Evaluation Center, so sánh hai run.
7. **Kết:** bảng ablation, chỉ số RAG, phản hồi người dùng trên dashboard.

---

## 14. Checklist "Definition of Done" cho toàn dự án

- [ ] Không còn tên index vật lý, model, prompt, alias, từ điển nằm trong code ứng dụng (grep kiểm tra trong CI).
- [ ] Mọi pipeline search/RAG khai báo trong YAML; thêm một retriever mới chỉ cần 1 class + 1 dòng `@register` + YAML.
- [ ] Mọi request search/RAG có trace xem được trên UI.
- [ ] Hybrid ≥ BM25 trên benchmark A1; số liệu trong `reports/` khớp `metrics.json`.
- [ ] Admin: đăng nhập, dashboard, config + rollback, trace, index, policy.
- [ ] F1, F2, F3 chạy end-to-end, có test, F1 có số đo.
- [ ] CI xanh: ruff, pytest (unit/api/evaluation/a3), `npm test`, `npm run build`.
- [ ] README quick start chạy được trên máy sạch với `make setup && make up && make seed`.

---

## 15. Trạng thái thực hiện (cập nhật 2026-10-17)

Số đo lấy từ `metrics.json` trong `api/runs/` (chi tiết và đường dẫn run: [`api/reports/a1/RESULTS.md`](../api/reports/a1/RESULTS.md)).
Qrels A1/accuracy_v2 vẫn là nhãn seed/metadata chưa được người duyệt; nhãn F1 là nhãn tổng hợp.

### Đã xong

| Hạng mục | Kết quả |
|---|---|
| **P0** nền móng | Makefile (thêm `embed-text`, `index` 2 embedder, `embedding-map`, `eval-compose`, `dev-api`, `dev-ui`), CI (ruff, pytest gồm `tests/platform`, npm test/build, hard-code guard), pre-commit, PostgreSQL + Alembic (SQLite cho dev), profile `dev/demo/eval`, bỏ `egg-info`, một lockfile UI (`shopmind-ui`), `.gitattributes` giữ LF cho file benchmark |
| **P1** kiến trúc + engine | Registry, pipeline engine có trace, container + wiring theo subsystem, bảng ánh xạ lỗi. Mọi chế độ search chạy qua pipeline khai báo trong `configs/pipelines/search.yaml`; prompt là file có version (`configs/prompts/`), từ điển ở `configs/vocab/`, alias index ở `configs/components/embedders.yaml`; hard-code guard xanh |
| **P2** sửa lõi (A-1…A-6) | E5 đa ngôn ngữ cho `text_vector` (A-1), template văn bản embed trong config (A-2), từ điển YAML (A-3), RRF có trọng số + linear min-max (A-4), bước `rerank.cross_encoder` cho A1 (A-5), ablation mới (A-6). Dense text Recall@10: 0.0375 (SigLIP2 cũ) → **0.5500** (E5); BM25 0.4875; hybrid linear **0.5875**. Trên accuracy_v2: chọn hybrid linear theo DEV, holdout nDCG@10 **0.6961** so với 0.6075 của cấu hình cũ |
| **P3** glass-box | Trace từng bước cho search/RAG/chat/compare (`explain`, lưu DB, `GET /traces/{id}`), highlight + ES DSL + giải thích bộ lọc + công thức RRF/linear, SSE `step`, Search Inspector, RAG Inspector, Embedding Map (PCA, 3 không gian, chiếu truy vấn) |
| **P4** tính năng | F1 compose search (`/search/compose`, thanh trượt α; nDCG@10 0.536 so với 0.107 image-only, 0.148 text-only), F2 hiểu ý định + chat nhận ảnh + thẻ sản phẩm + phiên chat, F3 so sánh có trích dẫn (`/rag/compare`, bảng thuộc tính không qua LLM) |
| **P5** admin + storefront | JWT, dashboard, config + profile + rollback + hot-reload, Trace Explorer, index/jobs, Policy CMS (publish → job reindex), Evaluation Center, Feedback, Annotation + kappa; storefront: design token + dark mode, i18n vi/en, autocomplete, facet có đếm, giá/tồn kho tổng hợp có nhãn, sản phẩm tương tự theo ảnh, yêu thích/giỏ hàng (localStorage), F4 👍/👎 + click |
| Bảo mật | Rate limit `/rag`, `/chat`; `/admin`, `/debug`, `/traces` cần JWT; secret chỉ từ env; trace không chứa vector/ảnh; test prompt-injection (`tests/a3/test_prompt_injection.py`) |
| LLM | Provider theo registry (`openai`, `ollama`), không có key thì search/trợ lý tìm sản phẩm/so sánh dạng bảng vẫn chạy |

### Chưa làm / giới hạn còn lại

- **Frontend TypeScript, TanStack Query, client sinh từ OpenAPI** (§3.3): chưa chuyển; UI vẫn là JS + `fetch` qua `shared/api`, có mock đầy đủ. Không có test component (chỉ test logic thuần).
- **Đánh giá A3 thật (§9)**: s4–s5, faithfulness/LLM-as-judge, citation precision/recall cần `OPENAI_API_KEY` và tập ca có nhãn — chưa chạy. Chỉ số chất lượng câu trả lời RAG vẫn là **null**.
- **Review**: không có dữ liệu review cục bộ nên index `reviews` trống; F5 (tóm tắt review theo khía cạnh, Could) chưa làm.
- **Hạ tầng**: chưa chạy được `docker compose` trên máy hiện tại (không có Docker) và chưa chạy migration trên PostgreSQL thật (chỉ SQLite); Redis cache, cache câu trả lời theo hash, `/metrics` Prometheus (Could) chưa làm.
- Từ điển `configs/vocab/` sửa bằng file/config; Admin chưa có trang sửa từ điển. α mặc định của F1 (0.5) được so sánh trên chính tập tổng hợp, chưa có tập tách riêng.
- Nhãn qrels vẫn cần người duyệt (dùng trang Annotation) trước khi báo cáo chính thức.
