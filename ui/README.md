# shopmind-ui

React 19 + Vite 8 + react-router 7 frontend for ShopMind: the shopper storefront (multimodal
search, product pages, compare, cart, the shopping planner), the RAG shopping assistant and the
admin console (`/admin`) with the engineering tools (glass-box inspectors, Search Playground,
embedding map). Plain JavaScript, no extra UI libraries: charts, drawers and scatter plots are
React + SVG + CSS.

HTTP shapes follow [`docs/API_CONTRACT.md`](../docs/API_CONTRACT.md) (source of truth).

## Routes

| Route | What it is |
|---|---|
| `/` | Catalog with category/brand facets (counts) and pagination |
| `/search?q=` | Text search with facets incl. colour, "Hệ thống hiểu" banner, "Có phải bạn muốn tìm…", 👍/👎. No algorithm choice: the request has no `mode`/`pipeline`, the backend runs the admin default (`defaults.search`); old `?mode=` links are ignored |
| `/search?type=image` | Image search (image attached from the search bar) |
| `/search?type=compose&q=&alpha=` | F1 image + text search with a live α slider |
| `/products/:id` | Gallery, synthetic price/stock, add to cart/compare/wishlist, "Sản phẩm tương tự về hình ảnh", Ask-about-this-product (RAG) |
| `/compare?ids=a,b,c` | F3 attribute table + cited RAG summary |
| `/cart` | Cart and wishlist (localStorage, no checkout) |
| `/plan?q=&budget=` | F6 shopping planner (`POST /rag/plan`): occasion + optional USD budget → one product per need with cited reasons, budget bar, alternatives that swap the pick and recompute the total client-side, `skipped_budget` / `no_match` states, policy tips, "Thêm tất cả vào giỏ" |
| `/admin/*` | Admin console (lazy loaded, JWT) |
| `/lab`, `/lab/embeddings` | Redirect to `/admin/playground` and `/admin/embedding-map` (the Retrieval Lab was removed) |

Admin console groups: **Vận hành / Operate** (Dashboard, Pipeline & Config, Indexes & Jobs,
Policies, Feedback) and **Glass-box & lab** (Traces, Search Playground, Embedding Map,
Evaluation, Annotation). The console is Vietnamese by default and uses the same i18n dictionary
and vi/en setting as the storefront (toggle in its top bar); pipeline names, config keys,
metrics and job types are never translated.

Errors are shown in plain words (`shared/api/errors.js`): `503 llm_unavailable` says AI answers
are switched off and that search, compare and the planner still work, instead of the raw
backend message (kept under "Chi tiết kỹ thuật"). See [`docs/QUALITY_AUDIT.md`](docs/QUALITY_AUDIT.md)
for the 2026-10 quality pass.

- **Pipeline & Config** starts with the card "Thuật toán tìm kiếm của cửa hàng": the public
  search pipelines from `/meta/pipelines` (name + description), bound to the hot-reloadable
  key `defaults.search`. Saving uses `PUT /admin/config` with an auto-filled profile name
  (`search-default-<pipeline>`); the card shows the active value, the `defaults.search` history
  and a roll-back button (profile re-activation).
- **Search Playground** (`/admin/playground?q=&a=&b=&k=&category=&brand=`): one query through
  one or two pipelines from `/meta/pipelines?include_hidden=true` (evaluation-only ones
  flagged) with `explain: true`, results side by side with rank cross-reference, overlap@10,
  round-trip and server latency, and a button per side that opens the Search Inspector.
- **Embedding Map** (`/admin/embedding-map`): text E5 / old SigLIP text / SigLIP image spaces
  with query projection.
- **Traces**: rows open in the same Inspector drawer (the console mounts `InspectorHost`).

## Shoppers vs. staff (glass-box)

Shoppers never see algorithms, traces or `explain`. **Staff mode** turns on while an
admin-console session exists (`shared/lib/useStaffMode.js`, which reads
`pages/admin/lib/authStorage.js`; the session lives in `localStorage` so a login or logout in
another tab is picked up through the `storage` event, plus a same-tab event). Staff mode shows a
"Chế độ quản trị" pill in the header and these affordances, each sending `explain: true`:
"Vì sao có kết quả này?" on the results page (**Search Inspector**: Truy vấn · Xếp hạng · Từ
khoá khớp · Hiệu năng · Truy vấn ES) and the pipeline name that ran; the chat "Minh bạch" toggle,
the product Q&A explain toggle and the compare page "Xem quy trình" (**RAG Inspector**: step
timeline, candidates per source, the context actually sent, generation, citation validation);
the planner's `method` and "Xem quy trình" (**planner trace view**: timeline, decomposed needs,
candidates per need, budget decisions, context, justification). Citation chips that open the
exact evidence snippet are shopper features and always on.

## Layout (feature-sliced, plain JS)

```text
src/
  App.jsx, main.jsx          router + providers (i18n, toast, shopper lists)
  shared/api/                http.js (request), storefront.js (public API), admin.js, sse.js, filters.js,
                             errors.js (error -> plain-language message)
  shared/ui/                 Drawer, Tabs, Toast, Skeleton, I18nProvider, ui.css
  shared/i18n.js             vi (default) / en dictionary (+ i18n.more.js, i18n.admin.js); header toggle
                             persisted in localStorage; catalogLabels.js = category/colour/attribute names
  shared/lib/                storage (never-throwing localStorage), inspectorBridge,
                             staffMode (pure) + useStaffMode (hook)
  entities/trace/            pure trace -> view-model logic (search, RAG and planner inspectors)
  entities/citation/         [citation_id] parsing, AnswerText + EvidenceCard
  entities/product/          attributes / gallery / stock helpers
  features/                  search-bar (suggest), search (call mapping), compose, facets,
                             feedback, compare, shop-lists (compare tray, wishlist, cart),
                             embedding-map, planner (plan view model, swaps, totals)
  widgets/inspector/         InspectorDrawer, SearchInspector, RagInspector, PlanInspector, InspectorHost
  pages/                     compare, cart, plan, embedding-map (mounted in the admin), admin
                             (incl. Search Playground, lib/pipelines + lib/playground)
  shop/, chat/               storefront pages, assistant widget
  mocks/                     in-memory backend for VITE_MOCK_API=1
```

Pure logic lives in `*.js` modules with a `*.test.js` next to them; components stay thin.
`widgets/inspector/InspectorHost.jsx` answers the `shopmind:open-inspector` event used by the
admin Trace Explorer; the admin layout mounts it with `getTrace`.

## Mock mode (`VITE_MOCK_API=1`)

```bash
VITE_MOCK_API=1 npm run dev        # or: VITE_MOCK_API=1 npx vite --port 5174
```

Every endpoint the UI calls is served in memory by `src/mocks/` (no backend needed):
search (text with full traces, image, compose, suggest, facets, understand, filter-options),
products (list, detail with synthetic price/stock/images, similar), RAG (ask, compare, plan),
chat (`/chat`, `/chat/stream` as paced SSE-like events, `/chat/image`, `/chat/sessions/{id}`),
feedback, click events, meta (pipelines incl. `include_hidden`, embedding map + projection) and
the admin API (login `admin/admin` or `annotator/annotator`). A text search without
`mode`/`pipeline` runs the admin mock's `defaults.search` (change it on the Config page, same
page session). `/rag/plan` is a deterministic rules-mode planner over the fixture catalog
(occasion templates, budget parsed from the text, greedy must-first optimizer, extractive
reasons citing product/review evidence, policy tips, full trace); the chat routes occasion /
budget requests to it as intent `shopping_plan`. The mock search engine is deterministic and
records real query-understanding aliases (e.g. "giày bốt da màu nâu"), BM25 matched terms and
ES DSL, dense vector dims/norm, RRF contributions/formula and rerank moves, so every Inspector
view has data. Mock state (feedback, sessions) resets on reload, except chat sessions which are
kept in localStorage to demo session restore.

Demo inputs: an uploaded file named like a fixture id (e.g. `M-009.png`) is treated as that
product's photo for image/compose search; `ba lô`, `giày bốt da màu nâu`, `áo khoác đen`
exercise the aliases; in the chat try "Ba lô đen chống nước" then "Cái thứ hai có chống nước
không?", "Đổi trả trong bao lâu?" and "Chuẩn bị đi biển 5 ngày, ngân sách 300$". On `/plan`
the example chips cover every planner state (the beach trip under 300 USD has a need skipped
for budget and one with no matching product). Log in to `/admin` to see the storefront in
staff mode.

## Run with the backend

From the repository root: `docker compose up --build`, then open <http://localhost:5173>.
For local development start the FastAPI backend on port 8000 and run:

```bash
npm ci        # single lockfile: package-lock.json (yarn is not used)
npm run dev
```

Set `VITE_API_PROXY_TARGET` to use a backend other than `http://localhost:8000`. The assistant
falls back to the older `rag/ask` + `search/text` behaviour when `/chat` is not deployed (404).

## Checks

```bash
npm test        # node --test, pure-logic tests only (no DOM)
npm run build
```
