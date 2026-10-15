# Storefront API Design

Date: 2026-10-15
Status: approved in conversation; awaiting written-spec review

## Goal

Expose the backend API a storefront UI needs, on top of the existing A1 search and A3 RAG stack:

1. A home page that lists products and lets the user narrow by category.
2. A header search bar that uses the A1 search modes.
3. A product detail page.
4. A floating chatbot backed by RAG, with follow-up questions and streamed answers.

The OpenAI model is chosen once (no model comparison) and is configurable from `.env`.

## Scope

In scope: endpoints, services, repository methods, configuration, compose wiring, and tests in this repository.

Out of scope:

- The storefront UI in `../test-ui`. It will be built separately against this API. When it is built, the existing retrieval-lab page stays reachable at `/lab`.
- Cart, checkout, accounts, prices, ratings (the catalog has no price or rating data).
- Similar-products, autocomplete beyond the existing `filter-options`, server-side chat sessions.
- Changes to A1 ranking, A3 retrieval/fusion/reranking, or evaluation.

## Constraints carried from the codebase

- The app reads only the stable aliases `products`, `reviews`, `policies`; no physical index names in app code.
- Config models use `extra="forbid"`; every new key gets a Pydantic field.
- Public search results keep their current shape (`product_id`, `title`, `image_url`, `brand`, `category`, `score`, `rank`). The new detail endpoint is a separate contract and never returns vectors or `search_text`.
- Image bytes and embedding vectors are never logged.
- Runtime init failures stay on `app.state.*_runtime_error`; `/health` stays up.
- API tests use fakes through `create_app(..., auto_wire=False)`. No test calls OpenAI.

## API surface

All routes are under `/api/v1`.

### `GET /products` — catalog listing

Query parameters:

| Name | Type | Default | Rule |
|---|---|---|---|
| `category` | repeatable string | none | OR within the field |
| `brand` | repeatable string | none | OR within the field; AND with `category` |
| `page` | int | 1 | `>= 1` |
| `page_size` | int | 24 | `1..60` |

Filters reuse the repository's catalog-resolved filter clauses (`_resolved_filter_clauses`), so semantics match A1 search exactly: exact catalog match first, substring/prefix fallback only for values absent from the catalog.

`page * page_size` must be `<= 10000` (Elasticsearch `max_result_window`); otherwise `422 invalid_pagination` (new `InvalidPagination` error in `api/errors.py`, with its own handler in `main.py`).

Order: `product_id` ascending (stable, deterministic).

Response:

```json
{
  "items": [{"product_id": "...", "title": "...", "image_url": "...", "brand": "...", "category": "..."}],
  "total": 1500,
  "page": 1,
  "page_size": 24,
  "facets": {"category": [{"value": "SHOES", "label": "Shoes", "count": 150}]}
}
```

`facets.category` is a terms aggregation on `category.keyword`, size 300 (the catalog has 215 categories), ordered by count descending. The aggregation applies the `brand` filter but **not** the `category` filter, so the UI can show counts for other categories while one is selected. `label` uses the same humanization as the current UI (`HOME_BED_AND_BATH` → `Home Bed And Bath`).

### `GET /products/{product_id}` — product detail

Response:

```json
{
  "product_id": "B07X1R6RHZ",
  "title": "...",
  "brand": "Klepe",
  "category": "SHOES",
  "category_label": "Shoes",
  "description": "...",
  "attributes": {"color": "Black", "style": "..."},
  "bullet_points": ["..."],
  "category_path": ["Shoes", "Men", "Running"],
  "image_url": "..."
}
```

- `description` may be an empty string (common in this catalog); the field is still present.
- `bullet_points` comes from `metadata.bullet_points`; `category_path` is the first `metadata.node_paths` entry split on `/` with empty segments removed, or `[]`.
- Unknown ID → `404` with the existing error envelope (`{"error": {"code": "product_not_found", ...}, "request_id": ...}`).
- `product_id` path value is limited to 128 characters, matching `RAGAskRequest.product_id`.

### `POST /search/text`, `POST /search/image` — header search

Unchanged, with one addition: an optional `offset` (int, default 0, `>= 0`) so a results page can load more.

- Text: `offset` is a body field on `TextSearchRequest`. Image: `offset` is a query parameter.
- The service is asked for `offset + top_k` results and the route returns the slice `[offset, offset + top_k)`. `rank` stays the absolute rank (so the second page starts at `offset + 1`).
- `offset + top_k` must be `<= candidate_k`; otherwise `422`. Text: a `TextSearchRequest` model validator (standard `validation_error`). Image: the route raises `InvalidPagination` (`422 invalid_pagination`); the existing `candidate_k < top_k` check keeps its current `400 invalid_image`. This keeps paging inside the fused candidate set rather than issuing new queries.

The storefront default mode is `hybrid` (the existing default). All existing modes remain available.

### `POST /chat` and `POST /chat/stream` — floating chatbot

Request (shared):

```json
{
  "message": "Is it waterproof?",
  "history": [
    {"role": "user", "content": "Tell me about the Klepe black running shoes"},
    {"role": "assistant", "content": "..."}
  ],
  "product_id": "B07X1R6RHZ"
}
```

| Field | Rule |
|---|---|
| `message` | stripped, 1..2000 chars |
| `history` | 0..12 items (6 turns); `role` is `user` or `assistant`; each `content` 1..4000 chars. Older items beyond the limit are rejected with `422`, not silently dropped; the client trims. |
| `product_id` | optional, max 128 chars; the product the user is viewing |

`POST /chat` response:

```json
{
  "answer": "...",
  "sources": [{"document_id": "...", "source": "product", "title": "...", "score": 0.03, "product_id": "...", "policy_version": null, "source_url": null, "metadata": {}}],
  "insufficient_evidence": false,
  "standalone_question": "Is the Klepe Men's Black Running Shoe waterproof?"
}
```

`sources` items have the same shape as `RAGSourceResponse`.

`POST /chat/stream` responds with `text/event-stream`. Events, in order:

| Event | Data | When |
|---|---|---|
| `meta` | `{"standalone_question": "..."}` | once, first |
| `delta` | `{"text": "..."}` | zero or more; answer text increments |
| `reset` | `{"reason": "citation_retry"}` | at most once; client discards streamed text, the retry streams new `delta`s |
| `done` | same body as `POST /chat` | once, last on success |
| `error` | `{"code": "...", "message": "..."}` | once, last on failure after the stream opened |

Errors detected **before** the stream opens (validation, RAG not wired, missing API key, missing source index, retrieval/rerank/context failure) are returned as normal HTTP errors through the existing exception handlers, so the client sees a real status code. Only generation-time failures become `error` events.

## Components

### Configuration

- `OPENAI_MODEL` env var overrides `rag.llm.model` in `_overlay_env` (same pattern as `OPENAI_API_KEY`). Default model stays `gpt-5.4-mini`: it supports strict structured output and streaming and is the model the A3 runs already used.
- New `ApiConfig.cors_origins: list[str] = []`, overridable by `CORS_ORIGINS` (comma-separated). When non-empty, `create_app` adds `CORSMiddleware` for those origins with `GET`/`POST`. Empty means no CORS middleware (current behavior; the Vite proxy keeps working).
- New `ChatConfig` under `rag.chat`:
  - `sources: list[Literal["product", "review", "policy"]] = ["product", "policy"]`
  - `include_reviews_when_available: bool = true` — add `review` when the `reviews` alias exists (checked per request through the review `KnowledgeRepository.alias_exists`).
  - `max_history_items: int = 12`
- `docker-compose.yml` passes `OPENAI_MODEL` and `CORS_ORIGINS` to `api`; `.env.example` documents both.

### Repository: `ElasticsearchProductRepository`

- `list_products(filters, page, page_size) -> ProductPage` — `match_all` + resolved filter clauses, `from`/`size`, `sort: product_id`, `_source` excluding `text_vector`, `image_vector`, `search_text`; plus a `filter`-aggregation wrapping the `category.keyword` terms aggregation that applies only the non-category clauses. `track_total_hits: true`.
- `get_product(product_id) -> dict | None` — `GET` on the alias with `_source_excludes` for vectors and `search_text`; `None` on not-found.

`ProductPage` is a small frozen dataclass (`items`, `total`, `category_facets`) in `shopmind/app/domain/`.

### Catalog service and routes

- `shopmind/app/catalog/service.py::CatalogService` — validates paging, calls the repository, maps raw sources into `ProductSummary` / `ProductDetail` domain objects (category label, bullet points, category path). Raises `ProductNotFound` (new error, `404`).
- `shopmind/app/api/routes/products.py` — the two `GET` routes. `CatalogService` is built in the lifespan from the existing repository and stored on `app.state.catalog_service`; `create_app` accepts an injected `catalog_service`.
- `shopmind/app/api/schemas/products.py` — response models.

### RAG service split (no behavior change)

`RAGService.answer` currently retrieves, builds context, and generates in one call. Streaming needs the context before generation starts, so split it:

- `prepare(request) -> PreparedContext` — retrieval, fusion, rerank, context build, trace. Same exceptions as today.
- `generate(request, prepared) -> RAGAnswer` — the existing `_generate` loop (including the abstain shortcut when the context is empty).
- `generate_stream(request, prepared) -> Iterator[GenerationEvent]` — the streaming counterpart; yields `Delta(text)`, `Reset()`, `Final(RAGAnswer)`; raises `RAGGenerationError` / `LLMProviderError` as `generate` does.
- `answer(request)` becomes `generate(request, prepare(request))` and returns exactly what it returns today. The instruction string moves to a module constant shared by both generators.

`/rag/ask` and A3 evaluation keep calling `answer`; existing tests must pass unchanged.

### LLM provider

`OpenAIProvider` gains two methods; the `LLMProvider` protocol gains the same two:

- `generate_stream(request: LLMRequest) -> Iterator[str | LLMResponse]` — calls `responses.create(..., stream=True)` with the same strict JSON schema (`answer` first in `properties` and `required`). On each `response.output_text.delta`, feeds the delta to an `AnswerFieldExtractor` and yields any newly decoded answer text. On `response.completed`, parses the full output exactly like `generate` and yields the final `LLMResponse`. Stream failure or `response.failed` → `LLMProviderError`; unparsable final output → `InvalidLLMOutput`.
- `rewrite_question(history, message) -> str` — non-streaming call with a strict schema `{"question": string}` and instructions to produce a self-contained question in the user's language, resolving pronouns from history, without answering it. Empty or invalid output → `InvalidLLMOutput`.

`shopmind/app/llm/answer_stream.py::AnswerFieldExtractor` — incremental parser for the `"answer"` string value inside a partial JSON object. Handles JSON escapes (`\"`, `\\`, `\n`, `\uXXXX` including surrogate pairs) split across chunk boundaries, ignores everything outside the `answer` value, and stops emitting once the closing quote is seen. It never yields partial escape sequences.

### Chat service and routes

`shopmind/app/chat/service.py::ChatService(rag_service, llm, chat_config, source_availability)`:

1. `resolve_question(message, history)`: empty history → `message`. Otherwise `llm.rewrite_question`; on `LLMProviderError` or `InvalidLLMOutput`, fall back to `message` and record `rewrite_fallback=true` in the log fields.
2. `sources()`: configured sources, plus `review` when `include_reviews_when_available` and the `reviews` alias exists.
3. `prepare(...)`: builds `RAGRequest(standalone_question, product_id, sources)` and calls `rag_service.prepare`.
4. `answer(...)` → `ChatAnswer`; `stream(...)` → iterator of chat events (`meta`, `delta`, `reset`, `done`, `error`).

The streaming route performs steps 1–3 **before** returning `StreamingResponse`, so pre-generation failures surface as HTTP errors. The generator then runs generation; any `RAGGenerationError` / `LLMProviderError` inside it becomes one `error` event and the stream ends. SSE framing (`event:` / `data:` / blank line, JSON data) lives in `shopmind/app/api/sse.py`. Response headers: `Cache-Control: no-cache`, `X-Accel-Buffering: no`.

The rewritten question is used only for retrieval and generation; the user's original message is not altered in the response.

`ChatService` is built in the lifespan only when `rag_service` was built; otherwise chat routes raise `RAGUnavailable` (`503`), matching `/rag/ask`.

Logging (`shopmind.chat` logger): request ID, message length, history length, standalone question length, `rewrite_fallback`, sources, per-source context counts, generation attempts, latency, streamed or not. No message text, no answer text.

## Data flow

```text
GET /products ──► CatalogService ──► repository.list_products ──► ES products alias
GET /products/{id} ──► CatalogService ──► repository.get_product ──► ES products alias
POST /search/* ──► SearchService (unchanged) ──► slice [offset, offset+top_k)

POST /chat[/stream]
  ├─ ChatService.resolve_question ──(history?)──► OpenAIProvider.rewrite_question
  ├─ ChatService.sources (+review if alias exists)
  ├─ RAGService.prepare ──► MultiSourceRetriever ► fusion ► reranker ► ContextBuilder
  └─ RAGService.generate | generate_stream ──► OpenAIProvider.generate[_stream]
                                              ──► CitationValidator (1 retry → reset event)
                                              ──► CitationResolver ──► done
```

## Operational prerequisite

The chatbot defaults to `product` + `policy`. The `policies` alias does not exist in the current local stack. Before using chat, index the bundled experimental policies with the README's A3 commands (`scripts.generate_knowledge_embeddings --source policy` then `scripts.index_policies`). Without it, chat returns `503`, as `/rag/ask` does. Reviews are added automatically once a reviews index exists; no review data is bundled.

Policies are experimental examples, not real store terms; the existing generation instructions already require the answer to say so.

## Error handling summary

| Condition | Result |
|---|---|
| Invalid query/body (paging bounds, history size, offset beyond candidate_k) | `422` |
| Product ID not in catalog | `404 product_not_found` |
| Search runtime not ready | `503` (existing) |
| RAG not wired / no API key | `503` (existing) |
| Source index missing, retrieval/rerank/context failure | `503` (existing handlers) |
| Rewrite call fails | fall back to raw message; continue |
| No evidence for the question | `200` abstain answer, `insufficient_evidence: true`, no LLM call |
| Invalid citations or invalid output on both attempts | non-stream: `502 rag_generation_failed` (existing); stream: `error` event `rag_generation_failed` |
| LLM call fails during generation | non-stream: `503 llm_unavailable` (existing); stream: `error` event `llm_unavailable` |

## Testing

Unit (`tests/unit`):

- `AnswerFieldExtractor`: whole and byte-by-byte chunking, every escape type, surrogate pairs split across chunks, `answer` not first is still handled, trailing fields ignored, no output after the closing quote.
- `_overlay_env`: `OPENAI_MODEL` and `CORS_ORIGINS` override; empty values ignored.
- `CatalogService`: label humanization, `category_path` parsing, empty description, paging bounds.
- `ChatService`: no-history skips rewrite; rewrite failure falls back; review source added only when the alias exists; history limit.
- `RAGService`: `answer` equals `generate(prepare(...))`; `generate_stream` yields deltas then final; invalid citations on attempt 1 yield `Reset` then attempt 2; two failures raise `RAGGenerationError`.
- `OpenAIProvider.generate_stream` with a fake streaming client emitting `response.output_text.delta` / `response.completed` / `response.failed` events.

API (`tests/api`, fakes via `create_app(auto_wire=False)`):

- `GET /products`: items, total, facets, filter pass-through, page bounds `422`.
- `GET /products/{id}`: detail shape, no vector or `search_text` keys, `404`.
- `POST /search/text` and `/search/image` with `offset`: slice and absolute ranks; `offset + top_k > candidate_k` → `422`; default behavior unchanged.
- `POST /chat`: response shape; `503` when RAG is not wired.
- `POST /chat/stream`: event order on success; `reset` path; `error` event on generation failure; `503` HTTP status (not an event) when preparation fails; content type `text/event-stream`.
- CORS headers present only when `cors_origins` is set.

Integration (`tests/integration`, `-m integration`): `list_products` total/paging/facets and `get_product` against the real `products` alias.

Existing suites (`tests/unit tests/api tests/evaluation tests/a3`) must still pass unchanged.

## Review step

After the implementation plan is written, Haiku and Sonnet subagents critique it from opposing positions (one arguing for simplification, one hunting for correctness gaps). Agreed findings are folded into the plan before implementation starts.
