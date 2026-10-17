# shopmind-ui

React 19 + Vite 8 + react-router 7 frontend for ShopMind: the shopper storefront (multimodal
search, product pages, compare, cart), the RAG shopping assistant, the glass-box inspectors,
the embedding map, the Retrieval Lab and the admin console (`/admin`). Plain JavaScript, no
extra UI libraries: charts, drawers and scatter plots are React + SVG + CSS.

HTTP shapes follow [`docs/API_CONTRACT.md`](../docs/API_CONTRACT.md) (source of truth).

## Routes

| Route | What it is |
|---|---|
| `/` | Catalog with category/brand facets (counts) and pagination |
| `/search?q=&mode=` | Text search (hybrid, BM25, dense, cross-modal) with facets incl. colour, "Hệ thống hiểu" banner, "Có phải bạn muốn tìm…", 👍/👎 |
| `/search?type=image` | Image search (image attached from the search bar) |
| `/search?type=compose&q=&alpha=` | F1 image + text search with a live α slider |
| `/products/:id` | Gallery, synthetic price/stock, add to cart/compare/wishlist, "Sản phẩm tương tự về hình ảnh", Ask-about-this-product (RAG) |
| `/compare?ids=a,b,c` | F3 attribute table + cited RAG summary |
| `/cart` | Cart and wishlist (localStorage, no checkout) |
| `/lab/embeddings` | Embedding map (text E5 / old SigLIP text / SigLIP image) with query projection |
| `/lab` | Retrieval Lab (side-by-side comparison) |
| `/admin/*` | Admin console (lazy loaded, JWT) |

Glass-box everywhere: "Vì sao có kết quả này?" on the results page opens the **Search
Inspector** drawer (tabs Truy vấn · Xếp hạng · Từ khoá khớp · Hiệu năng · Truy vấn ES); RAG
answers (product panel, chat, compare) expand an inline **RAG Inspector** (step timeline,
candidates per source, the context actually sent, generation, citation validation). Citation
chips open the exact evidence snippet.

## Layout (feature-sliced, plain JS)

```text
src/
  App.jsx, main.jsx          router + providers (i18n, toast, shopper lists)
  shared/api/                http.js (request), storefront.js (public API), admin.js, sse.js, filters.js
  shared/ui/                 Drawer, Tabs, Toast, Skeleton, I18nProvider, ui.css
  shared/i18n.js             vi (default) / en dictionary; header toggle persisted in localStorage
  shared/lib/                storage (never-throwing localStorage), inspectorBridge
  entities/trace/            pure trace -> view-model logic (search + RAG inspectors)
  entities/citation/         [citation_id] parsing, AnswerText + EvidenceCard
  entities/product/          attributes / gallery / stock helpers
  features/                  search-bar (suggest), search (call mapping), compose, facets,
                             feedback, compare, shop-lists (compare tray, wishlist, cart), embedding-map
  widgets/inspector/         InspectorDrawer, SearchInspector, RagInspector, InspectorHost
  pages/                     compare, cart, embedding-map, admin
  shop/, chat/, lab/         storefront pages, assistant widget, Retrieval Lab
  mocks/                     in-memory backend for VITE_MOCK_API=1
```

Pure logic lives in `*.js` modules with a `*.test.js` next to them; components stay thin.
`widgets/inspector/InspectorHost.jsx` answers the `shopmind:open-inspector` event used by the
admin Trace Explorer, so the admin can mount it (with `getTrace`) to show traces in the same drawer.

## Mock mode (`VITE_MOCK_API=1`)

```bash
VITE_MOCK_API=1 npm run dev        # or: VITE_MOCK_API=1 npx vite --port 5174
```

Every endpoint the UI calls is served in memory by `src/mocks/` (no backend needed):
search (text with full traces, image, compose, suggest, facets, understand, filter-options),
products (list, detail with synthetic price/stock/images, similar), RAG (ask, compare), chat
(`/chat`, `/chat/stream` as paced SSE-like events, `/chat/image`, `/chat/sessions/{id}`),
feedback, click events, meta (pipelines, embedding map + projection) and the admin API
(login `admin/admin` or `annotator/annotator`). The mock search engine is deterministic and
records real query-understanding aliases (e.g. "giày bốt da màu nâu"), BM25 matched terms and
ES DSL, dense vector dims/norm, RRF contributions/formula and rerank moves, so every Inspector
view has data. Mock state (feedback, sessions) resets on reload, except chat sessions which are
kept in localStorage to demo session restore.

Demo inputs: an uploaded file named like a fixture id (e.g. `M-009.png`) is treated as that
product's photo for image/compose search; `ba lô`, `giày bốt da màu nâu`, `áo khoác đen`
exercise the aliases; in the chat try "Ba lô đen chống nước" then "Cái thứ hai có chống nước
không?" and "Đổi trả trong bao lâu?".

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
