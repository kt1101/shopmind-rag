# ShopMind Storefront — Design Spec

Date: 2026-10-15
Status: Draft for review

## 1. Goal

Turn the ShopMind A1 frontend into a shopper-facing storefront that showcases the A1 retrieval work inside a realistic shop, while keeping the existing Retrieval Lab available.

A shopper can:

1. Browse the catalog on the home page and narrow it by category (and brand).
2. Search from a header search bar on every page, using any A1 text mode or an image.
3. Open a product detail page that describes the product.
4. Ask a floating chatbot about products; answers are grounded in the catalog (RAG) and cite the products they used.

### Agreed decisions

| Topic | Decision |
|---|---|
| Purpose | Demo storefront on the A1 backend. No cart, checkout, accounts, or payments. |
| Existing Lab | Kept unchanged in behaviour, moved to `/lab`. Shop becomes `/`. |
| Header search | Text search with mode picker (default Hybrid; BM25, Dense text, Cross-modal) plus image search. No side-by-side comparison. |
| Chat backend | Not built yet. Frontend codes against the contract in §5 and uses a mock until it exists. |
| Product detail data | New backend endpoint (contract in §5), mocked until it exists. Extra fields are optional. |
| Chat reply shape | Text answer + clickable cards for the source products. Non-streaming, with a typing indicator. Not page-aware. |
| Architecture | `react-router` for routing, split into pages/components, plain CSS extending the existing tokens. |

### Out of scope

Cart/checkout, auth, streaming chat, page-aware chat context, chat persistence across reloads, server-side rendering, and the backend implementation of the new endpoints.

## 2. Routes

| Route | Page | Layout |
|---|---|---|
| `/` | `CatalogPage` — browse with filters | `ShopLayout` |
| `/search` | `SearchPage` — text or image results with filters | `ShopLayout` |
| `/products/:productId` | `ProductPage` — product detail | `ShopLayout` |
| `/lab` | `LabPage` — existing comparison UI | none (keeps its own header) |
| `*` | `NotFoundPage` — "Page not found" + link home | `ShopLayout` |

`ShopLayout` renders `SiteHeader`, the page outlet, a small footer (with a "Retrieval Lab" link to `/lab`), and `ChatWidget`. The Lab's existing brand link already points to `/`, so it links back to the shop.

### URL state

Search and filter state lives in the query string so back/forward and shared links work:

- Catalog: `/?category=shoes&category=boots&brand=Acme`
- Text search: `/search?q=black+running+shoes&mode=hybrid&category=shoes`
- Image search: `/search?type=image&category=shoes`

Rules:

- `category` and `brand` are repeatable. Unknown params are ignored.
- `mode` must be one of `hybrid`, `bm25`, `dense`, `cross_modal`; anything else falls back to `hybrid`.
- `/search` with no `q` and no `type=image` redirects to `/` (keeping filters).
- Image files can't live in a URL. The chosen file is held in memory (`ImageSearchContext`). If `/search?type=image` loads with no file in memory (for example after a reload), the page shows an image picker empty state instead of results.

## 3. Pages and components

### 3.1 SiteHeader + SearchBar (all shop pages)

- Left: ShopMind brand → `/`.
- Centre: `SearchBar` with a text input, a compact mode `<select>` (Hybrid default), a camera button for image search, and a submit button.
  - Text submit → navigate to `/search?q=…&mode=…`, carrying the current page's `category`/`brand` filters.
  - Camera button → hidden file input (`accept="image/*"`). A valid image is stored in `ImageSearchContext` and navigates to `/search?type=image` with the current filters. A non-image file shows an inline error under the bar.
  - The input is pre-filled from the URL when on `/search`.
  - Empty text submit is ignored (button disabled).
- On narrow screens (<720px) the search bar wraps to a full-width second row.

### 3.2 CatalogPage (`/`)

- Two columns: `FilterSidebar` on the left (260px), product grid on the right.
- Toolbar above the grid: title ("All products", or the selected category names), result total, and active-filter chips with "Clear all".
- Grid: 4 columns ≥1200px, 3 ≥900px, 2 below. Each cell is a `ProductCard`.
- Data: `getProducts({ category, brand, limit: 24, offset })`. A "Load more" button appends the next page while `items.length < total`.
- On <900px the sidebar becomes a "Filters" button that opens a slide-in drawer.

### 3.3 FilterSidebar (catalog + search)

- **Category**: checkbox list from `getFilterOptions({ field: 'category', limit: 50 })`, labels humanized (`running_shoes` → "Running Shoes"), counts on the right. Scrolls internally past ~12 rows.
- **Brand**: the existing type-ahead `FilterField` (multi-select chips), extracted from `App.jsx` into `src/components/FilterField.jsx` with a `variant` prop (`dark` for the Lab, `light` for the shop). The Lab keeps the same look and behaviour.
- Every change updates the URL; the page reacts to the URL.
- Option-load errors show inline in that section ("Couldn't load categories · Retry").

### 3.4 SearchPage (`/search`)

- Same two-column layout as the catalog.
- Results header: the query text (or the uploaded image as a thumbnail), the mode label, result count, and round-trip time (the `durationMs` that `api.js` already returns).
- Text: `searchText({ query, mode, topK: 20, filters })`. Image: `searchImage({ file, topK: 20, filters })`.
- A new search aborts the previous one (same `AbortController` pattern as the Lab).
- No pagination: the API returns ranked top-K.
- Empty result: "No products match" + "Clear filters" (if any) + "Try another mode" hint.

### 3.5 ProductCard (shop)

A vertical card: square image (`resolveImageUrl`, placeholder on missing or broken image), category eyebrow, title (2-line clamp), brand, and price when present. The whole card is a link to `/products/:productId`. This is a new component; the Lab's horizontal card with rank and score stays in the Lab.

### 3.6 ProductPage (`/products/:productId`)

- Breadcrumb: Home › {Category} (category links to `/?category=…`).
- Two columns (stacked <900px): large image left; right has category eyebrow, title, brand, price (if present), product ID (small, monospace), and an "Ask ShopMind about products" button that opens the chat.
- Below: **Description** (if present, paragraphs split on blank lines) and **Details** (if `attributes` present: a two-column name/value table).
- **Similar products**: horizontal row of up to 8 `ProductCard`s from `searchText({ query: product.title, mode: 'hybrid', topK: 9 })`, excluding the current product. Hidden if empty; errors are silent (a secondary section never breaks the page).
- 404 → "Product not found" + link home. Other errors → message + Retry.

### 3.7 ChatWidget (all shop pages)

- **Launcher**: a round button fixed bottom-right (24px inset), chat icon, `aria-label="Open shopping assistant"`.
- **Panel**: 380×560px card anchored bottom-right; full-screen below 640px. Header has the title "ShopMind Assistant", a "Grounded in the catalog" subtitle, and a close button. The panel is `role="dialog"`, the input is focused on open, and Esc closes it.
- **Empty state**: greeting + 3 suggestion chips ("Waterproof hiking boots under $100", "What's good for running?", "Show me black backpacks"); clicking one sends it.
- **Messages**: user bubbles right, assistant bubbles left. Assistant messages can carry `sources`, shown as a horizontal row of mini cards (thumbnail + title) linking to `/products/:id`. The list is `aria-live="polite"` and auto-scrolls to the newest message.
- **Pending**: a typing indicator bubble; input stays enabled but send is disabled until the reply lands.
- **Error**: an assistant-side error bubble ("Couldn't reach the assistant") with a Retry button that resends the last user message.
- **State**: `ChatProvider` above the router outlet, so the conversation survives navigation between shop pages; it's cleared on reload. The last 10 messages are sent with each request.
- The product page's "Ask" button opens the panel (via the provider's `open()`), with no automatic context.

## 4. Code structure

```
src/
  main.jsx                 BrowserRouter + providers
  App.jsx                  route table only
  api.js                   existing + getProducts, getProduct, sendChatMessage; mock switch
  api.test.js              existing + contract tests for the new functions
  mocks/
    mockApi.js             in-memory implementations of the 3 new endpoints
    fixtures.js            ~24 sample products across 4 categories
    mockApi.test.js
  lib/
    urlState.js            parse/serialize search + filter query params
    urlState.test.js
    format.js              humanizeCategory, formatPrice
    format.test.js
  components/
    FilterField.jsx        extracted from App.jsx, variant prop
  shop/
    ShopLayout.jsx, SiteHeader.jsx, SearchBar.jsx, ImageSearchContext.jsx
    FilterSidebar.jsx, ProductCard.jsx, ProductGrid.jsx, StatusBlock.jsx
    CatalogPage.jsx, SearchPage.jsx, ProductPage.jsx, NotFoundPage.jsx
    shop.css
  chat/
    ChatProvider.jsx, ChatWidget.jsx
    chatState.js           pure reducer: send / receive / fail / retry
    chatState.test.js
    chat.css
  lab/
    LabPage.jsx            current App.jsx body, moved
    lab.css                current App.css, moved
```

- `StatusBlock` is the shared loading / empty / error block (title, message, optional action), reused by every page.
- Styles: `index.css` keeps the global reset and gains the shared tokens (`--ink`, `--muted`, `--line`, `--accent`, `--cyan`, `--surface`). These move out of `App.css` so the shop and the Lab share them. The Lab's rules live in `lab.css`, scoped under a `.lab` root class so they can't leak into the shop. Shop look: light background `#f6f8fb`, white cards, 12px radius, `--accent` for primary actions.
- `package.json` test script becomes `node --test "src/**/*.test.js"` (Node 24 supports globs).

## 5. API contracts (new)

All new endpoints use the existing error shape: non-2xx with `{ "error": { "message": string } }`.

### 5.1 List products

`GET /api/v1/products?category=<c>&category=<c2>&brand=<b>&limit=24&offset=0`

```json
{
  "total": 312,
  "items": [
    {
      "product_id": "P123",
      "title": "Trail Runner 2",
      "brand": "Acme",
      "category": "running_shoes",
      "image_url": "/media/products/P123.jpg",
      "price": { "amount": 89.0, "currency": "USD" }
    }
  ]
}
```

`price` may be absent. Ordering is stable (the backend decides; for example by title).

Why a new endpoint: the home page must list products with no filter selected and page through them. The existing filter-only search needs at least one filter and returns a fixed top-K with no offset.

### 5.2 Get product

`GET /api/v1/products/{product_id}` → `200`:

```json
{
  "product_id": "P123",
  "title": "Trail Runner 2",
  "brand": "Acme",
  "category": "running_shoes",
  "image_url": "/media/products/P123.jpg",
  "description": "Lightweight trail shoe…",
  "price": { "amount": 89.0, "currency": "USD" },
  "attributes": [ { "name": "Color", "value": "Black" } ]
}
```

`description`, `price`, and `attributes` are optional. Unknown ID → `404`.

### 5.3 Chat

`POST /api/v1/chat`

Request:

```json
{ "messages": [ { "role": "user", "content": "Any waterproof boots?" } ] }
```

`role` ∈ `user | assistant`. The array is the last ≤10 turns, ending with the new user message.

Response `200`:

```json
{
  "answer": "Here are two waterproof options…",
  "sources": [
    { "product_id": "P9", "title": "Ridge GTX", "brand": "Acme", "category": "boots", "image_url": "/media/products/P9.jpg" }
  ]
}
```

`sources` may be empty. The answer is plain text; the UI renders line breaks and nothing else (no HTML or markdown, so it can't inject markup).

### 5.4 Frontend functions (`api.js`)

- `getProducts({ category, brand, limit, offset, signal, fetchImpl })`
- `getProduct({ productId, signal, fetchImpl })`, which `encodeURIComponent`s the ID
- `sendChatMessage({ messages, signal, fetchImpl })`

Like the existing functions, each returns `{ data, durationMs }` and throws `Error(message)` on failure. A 404 from `getProduct` throws an error with `status = 404` so the page can show "not found".

### 5.5 Mocking

When `import.meta.env.VITE_MOCK_API === '1'`, the three new functions call `mocks/mockApi.js` instead of `fetch`. The existing search, filter-option, and readiness calls always hit the real backend. Mock behaviour:

- `getProducts` filters and pages the fixtures.
- `getProduct` returns the fixture or rejects with a 404-shaped error.
- `sendChatMessage` waits ~600ms, then keyword-matches the last user message against fixture titles and categories, and returns a templated answer plus up to 3 sources. If the message contains `"error"`, it rejects, so the error UI can be exercised.

Mock functions take the same arguments and return the same `{ data, durationMs }` shape, so pages can't tell the difference. The README documents the flag.

## 6. Error handling summary

| Situation | Behaviour |
|---|---|
| Any list or search loading | Skeleton cards (grid) or `StatusBlock` "Loading…" |
| Request fails | `StatusBlock` with the backend message + Retry |
| Superseded request | Aborted silently; no error shown |
| No results | `StatusBlock` with a clear-filters action when filters are set |
| Product 404 | "Product not found" + Home link |
| Similar-products failure | Section hidden |
| Broken image | Placeholder glyph (existing pattern) |
| Chat failure | Error bubble with Retry |
| Image picker non-image file | Inline error under the search bar |

## 7. Testing

Automated (`node --test`, no new test dependencies):

- `api.test.js`: request URL, method, and body for `getProducts` (repeated params, limit, offset), `getProduct` (encoding, 404 status), and `sendChatMessage` (body shape, error message).
- `urlState.test.js`: parse/serialize round-trip, repeated params, invalid mode fallback, ignoring unknown params.
- `format.test.js`: `humanizeCategory`, `formatPrice` (present, absent, and non-USD currencies).
- `chatState.test.js`: send → pending; receive → appends assistant message with sources; fail → error message; retry → resends last user message; history is capped at 10.
- `mockApi.test.js`: filtering, paging, 404, chat source matching.

Manual (with `VITE_MOCK_API=1 npm run dev` and the real backend):

- Browse, filter by category and brand, load more, and use back/forward.
- Text search in each mode; image search; reload on `/search?type=image`.
- Product page with all optional fields, with none, and with an unknown ID.
- Chat: suggestions, a reply with sources, navigating while the chat is open, the error-and-retry path, Esc to close, mobile full-screen.
- `/lab` looks and behaves as before.
- `npm test` and `npm run build` pass.
