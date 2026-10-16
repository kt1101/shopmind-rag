# ShopMind API contract (v1)

Source of truth shared by backend and frontend workstreams while the refactor in
`docs/REFACTOR_PLAN.md` is implemented in parallel. Backend must match these shapes; the
UI may mock them (`VITE_MOCK_API=1`) until the backend lands. Field names are `snake_case`.
Additive fields are allowed; renaming/removing requires updating this file.

## Conventions

- Prefix: `/api/v1`. Every response carries header `X-Request-ID`.
- Error body (all non-2xx): `{"error": {"code": "<slug>", "message": "<text>"}, "request_id": "<id>"}`.
- Pagination: `limit` + `offset` query params, responses include `total`.
- Explain: search/RAG endpoints accept `explain: true` (JSON body) or `?explain=true` (multipart/GET).
  When set, the response includes `trace_id` and an inline `trace` (see Trace schema).
  Without it, responses still include `trace_id` (the request id) so the UI can fetch it later.
- Public product result (unchanged): `{product_id, title, image_url, brand, category, score, rank}`.
- Auth: `/api/v1/admin/*`, `/api/v1/debug/*` and `GET /api/v1/traces/*` require
  `Authorization: Bearer <jwt>` when `auth.enabled: true` in config (default `true` in docker,
  tests may disable). `401 {"error":{"code":"unauthorized"}}` otherwise.

## Trace schema

```json
{
  "trace_id": "9f2c...",
  "pipeline": "search.hybrid",
  "kind": "search | image_search | compose_search | rag | chat | compare",
  "created_at": "2026-10-16T10:00:00Z",
  "duration_ms": 63.1,
  "input": {"query": "giày bốt da nâu", "filters": {}, "mode": "hybrid"},
  "steps": [
    {
      "id": "lexical",
      "step": "retrieve",
      "impl": "bm25",
      "params": {"candidate_k": 100},
      "started_ms": 1.2,
      "duration_ms": 22.4,
      "summary": "100 candidates from BM25",
      "notes": ["alias 'giày bốt' -> category 'boot'"],
      "output": {
        "items": [
          {"id": "B07XYZ", "rank": 1, "score": 12.3, "title": "...",
           "details": {"matched_terms": {"title": ["leather", "boot"]}}}
        ],
        "total": 100
      }
    },
    {
      "id": "fuse", "step": "fuse", "impl": "rrf", "params": {"k": 60},
      "output": {"items": [{"id": "B07XYZ", "rank": 1, "score": 0.0325,
        "details": {"contributions": {"lexical": {"rank": 1, "score": 0.0164},
                                       "semantic": {"rank": 3, "score": 0.0159}}}}]}
    }
  ],
  "output": {"result_ids": ["B07XYZ", "..."]}
}
```

- `step` vocabulary: `query_understanding`, `rewrite`, `retrieve`, `multi_source_retrieve`, `fuse`,
  `rerank`, `compose_query`, `filter`, `build_context`, `generate`, `validate_citations`, `route_intent`.
- `output.items` is capped (default 20) for display; vectors and image bytes are NEVER included
  (only `dims`, `norm` may appear in `details`).
- RAG-specific step details: `build_context.details = {documents:[{id, source, chars, included, reason}], rendered_chars, budget}`,
  `generate.details = {model, prompt_id, prompt_version, attempt, usage: {input_tokens, output_tokens}, raw_output}`,
  `validate_citations.details = {attempts:[{attempt, valid, error}]}`.

## Health

- `GET /health` → `{"status":"ok"}`
- `GET /ready` → `200 {"status":"ready","components":{"elasticsearch":"ok","embedder":"ok","text_embedder":"ok","llm":"ok|disabled","database":"ok|disabled"}}`; 503 when search is not ready (error body).

## Search

- `POST /search/text` body `{query, mode: bm25|dense|hybrid|cross_modal|adaptive, top_k, offset, candidate_k, filters: {brand?: str|[str], category?: str|[str], product_id?: str, color?: [str]}, sort?: relevance|title, explain?: bool}`
  → `{query, mode, filter_only, results:[ProductResult], trace_id, trace?, understood?: {filters, rewritten_query, intent}}`
- `POST /search/image` multipart `image` + query `top_k, offset, candidate_k, brand, category, product_id, explain` → `{results, trace_id, trace?}`
- `POST /search/compose` multipart `image` (required), form `text` (required), `alpha` (0..1, image weight, default from config), `top_k`, `explain` → `{results, alpha, trace_id, trace?}`
- `GET /search/suggest?q=&limit=8` → `{suggestions:[{type: product|brand|category, value, label, product_id?, image_url?}]}`
- `GET /search/filter-options?field=brand|category|product_id&prefix=&limit=` (unchanged) → `{field, options:[str]}`
- `POST /search/facets` body `{query?, filters}` → `{facets: {brand:[{value,count}], category:[{value,count}], color:[{value,count}]}}`
- `POST /search/understand` body `{query}` → `{query, filters, rewritten_query, intent, method: llm|rules}`

## Products

- `GET /products?category=&brand=&limit=24&offset=0` → `{total, items:[{product_id,title,brand,category,image_url,price?:{amount,currency,synthetic:true}}]}`
- `GET /products/{id}` → `{product_id,title,brand,category,image_url,description,attributes:{},price?,stock?:{in_stock,quantity,synthetic:true},images:[url]}`
- `GET /products/{id}/similar?limit=8` → `{product_id, items:[ProductResult]}` (image kNN, excludes self)

## RAG

- `POST /rag/ask` body `{question, product_id?, sources:[product|review|policy], debug?, explain?}` →
  `{answer, sources:[Citation], insufficient_evidence, metadata, trace_id, trace?}`
- `Citation = {citation_id, source, document_id, title, snippet, product_id?, url?, image_url?, metadata:{}}` (existing shape, additive)
- `POST /rag/compare` body `{product_ids:[2..3], question?, explain?}` →
  `{products:[{product_id,title,brand,category,image_url}], attributes:[{name, values:{<product_id>: str|null}}], summary, points:[{text, citation_ids:[str]}], sources:[Citation], insufficient_evidence, trace_id, trace?}`

## Chat

- `POST /chat` body `{message, history:[{role,content}], product_id?, session_id?, image_token?}` →
  `{answer, sources, insufficient_evidence, standalone_question, session_id, intent, products?:[ProductResult], trace_id}`
- `POST /chat/stream` same body, SSE events: `meta {standalone_question, rewrite_fallback, session_id, intent, trace_id}`,
  `step {id, step, status: started|done, summary, duration_ms?}`, `products {items:[ProductResult]}`,
  `delta {text}`, `reset {reason}`, `done {...same as POST /chat}`, `error {code,message}`.
- `POST /chat/image` multipart `image` → `{image_token, expires_in}` (server caches the image embedding; chat body references it via `image_token`). Intent `product_search` with image + text → compose search; image only → image search.
- `GET /chat/sessions/{session_id}` → `{session_id, messages:[{role, content, created_at, sources?, products?}]}`

Intents: `product_search | product_question | policy_question | compare | chitchat`.

## Feedback

- `POST /feedback` body `{target: search|answer, trace_id, rating: 1|-1, product_id?, query?, comment?}` → `201 {id}`
- `POST /events/click` body `{trace_id, product_id, rank}` → `204`

## Traces & meta

- `GET /traces/{trace_id}` → Trace (404 `trace_not_found`)
- `GET /meta/pipelines` → `{pipelines:[{name, kind, description, steps:[{id, step, impl}]}], defaults:{search, rag}}`
- `GET /meta/embedding-map?space=text|image|siglip_text` → `{space, points:[{product_id, x, y, category, title}], projection:"pca"|"umap"}`
- `POST /meta/embedding-map/project` body `{space, query}` → `{x, y}` (PCA projection of the query embedding)

## Admin (JWT)

- `POST /admin/auth/login` body `{username, password}` → `{access_token, token_type:"bearer", expires_in, user:{username, role}}`
- `GET /admin/auth/me` → `{username, role}`
- `GET /admin/stats?days=7` → `{totals:{searches, chats, feedback_positive, feedback_negative, zero_result_rate, abstain_rate}, latency:{<pipeline>:{p50,p95}}, daily:[{date, searches, chats}], top_queries:[{query,count}], zero_result_queries:[{query,count}]}`
- `GET /admin/config` → `{effective:{...merged config...}, hot_reloadable:[dotted.keys], active_profile:{id, name, created_at, created_by}}`
- `PUT /admin/config` body `{name, overrides:{dotted.key: value}}` → `{profile:{id,...}, effective}` (422 on validation error)
- `GET /admin/config/profiles` → `{items:[{id,name,created_at,created_by,overrides,active}]}`; `POST /admin/config/profiles/{id}/activate`
- `GET /admin/traces?q=&kind=&limit=&offset=` → `{total, items:[{trace_id, kind, pipeline, created_at, duration_ms, input_summary}]}`
- `GET /admin/indexes` → `{items:[{alias, index, doc_count, vector_fields:{name:dims}, embedder_ids}]}`
- `GET /admin/jobs` / `POST /admin/jobs` body `{type: reindex_policies|run_eval|build_embedding_map, params:{}}` / `GET /admin/jobs/{id}` → `{id,type,status: queued|running|succeeded|failed, params, log, created_at, finished_at}`
- `GET /admin/policies` → `{items:[{id, policy_id, section_id, title, content, policy_type, version, status: draft|published, updated_at}]}`;
  `POST /admin/policies`, `PUT /admin/policies/{id}`, `POST /admin/policies/publish` → `{job_id}`
- `GET /admin/eval-runs` → `{items:[{id, name, kind: a1|a3, created_at, metrics:{}, config:{}}]}`; `GET /admin/eval-runs/{id}`
- `GET /admin/feedback?limit=&offset=` → `{total, items:[{id,target,trace_id,rating,query,product_id,comment,created_at}]}`
- `GET /admin/judgments?query=` / `POST /admin/judgments` body `{query, product_id, grade:0|1|2}` / `GET /admin/judgments/export` → qrels JSONL; `GET /admin/judgments/agreement` → `{kappa, pairs}`
