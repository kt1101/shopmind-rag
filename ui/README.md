# ShopMind A1 + A3 UI

React + Vite interface for comparing retrieval modes, searching by image, and asking source-backed questions about a selected product, plus a shopper-facing storefront.

## Storefront

The storefront provides shopper-facing catalog browsing, multimodal search, product details, and a floating RAG assistant:

- `/` — Catalog browse with category & brand filters and pagination
- `/search` — Multimodal search (Hybrid, BM25, Dense text, Cross-modal, or Image search) with filters
- `/products/:productId` — Product detail with description, specifications, similar products, and an "Ask about this product" panel backed by the A3 `POST /api/v1/rag/ask` endpoint
- `/lab` — Multimodal Retrieval Lab (the original comparison lab, unchanged)

The floating assistant is scoped to the product you are viewing and answers through `POST /api/v1/rag/ask` with cited evidence. Outside a product page (or after removing the scope) it runs a hybrid catalog search, and **Ask about this** on any result scopes the chat to that product.

## In-memory mock mode (`VITE_MOCK_API=1`)

To run the frontend with the in-memory mock:

```bash
VITE_MOCK_API=1 npm run dev
```

### Endpoints mocked

- `GET /api/v1/products` — catalog listing with filtering and pagination
- `GET /api/v1/products/{product_id}` — product detail with descriptions and attributes (or 404)
- `POST /api/v1/rag/ask` — product-scoped answers built from the mock product's attributes and description (reviews and policies are reported as missing evidence)

### Why use mock mode

The storefront can be explored and tested independently without requiring the catalog-listing and product-detail backend endpoints to be deployed yet, while search and filter-options continue to hit the live backend.

### Backend API contracts

For full request and response schemas of the required endpoints, see:
- Quick reference: [`docs/backend-api-requirements.md`](docs/backend-api-requirements.md)
- Storefront design spec: [`docs/superpowers/specs/2026-10-15-shopmind-storefront-design.md#5-api-contracts-new`](docs/superpowers/specs/2026-10-15-shopmind-storefront-design.md#5-api-contracts-new)

## Run with the backend

From `/Users/yuji/research/rag/test`:

```bash
docker compose up --build
```

Open <http://localhost:5173>.

Search by text or image, choose **Ask about this product** on a result, then enter a question. Questions use product details by default; enable reviews or experimental policies after those indexes are loaded. Further questions stay scoped to that product until you choose another result. Each answer shows its cited sources and retrieval scores; curated ShopMind policy sources are marked experimental. The backend needs `OPENAI_API_KEY` for generated answers.

## Frontend development

Start the FastAPI backend on port 8000, then run:

```bash
npm install
npm run dev
```

Set `VITE_API_PROXY_TARGET` to use a backend other than `http://localhost:8000`.

## Checks

```bash
npm test
npm run build
```
