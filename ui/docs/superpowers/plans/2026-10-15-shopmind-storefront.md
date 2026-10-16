# ShopMind Storefront Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shopper-facing storefront (catalog, header search, product detail, RAG chat widget) to the ShopMind A1 frontend, and move the existing Retrieval Lab to `/lab`.

**Architecture:** `react-router` v7 route table in `App.jsx`. Shop pages share a `ShopLayout` (header with search bar, footer, chat widget). All search and filter state lives in the URL, through pure helpers in `src/lib/urlState.js`. Three new backend endpoints (product list, product detail, chat) are called from `api.js` and served by an in-memory mock when `VITE_MOCK_API=1`. Pure logic (URL state, formatting, chat reducer, API contracts, mock) is unit-tested with `node --test`. UI tasks are checked with `npm run build` plus scripted manual checks against the mock.

**Tech Stack:** React 19, Vite 8, react-router 7, plain CSS, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-15-shopmind-storefront-design.md` — read it before starting any task; section numbers below (§) refer to it.

## Global Constraints

- Only one new runtime dependency: `react-router` (^7). No new dev or test dependencies.
- Shop routes: `/`, `/search`, `/products/:productId`, `/lab`, `*` (spec §2).
- Text modes in the shop: `hybrid` (default), `bm25`, `dense`, `cross_modal`, with labels `Hybrid`, `BM25`, `Dense text`, `Cross-modal`.
- Catalog page size `24`; search `topK` `20`; similar products `topK` `9`, showing at most 8; chat history sent is the last `10` user/assistant turns.
- The mock is enabled only when `import.meta.env.VITE_MOCK_API === '1'`, and only for `getProducts`, `getProduct`, `sendChatMessage`. It is loaded with dynamic `import()` so it stays out of the production bundle.
- Chat answers render as plain text with line breaks preserved (CSS `white-space: pre-wrap`); never `dangerouslySetInnerHTML`.
- Product links always go through `productPath(productId)` (URL-encoded).
- Every API function returns `{ data, durationMs }` and throws `Error` with `.status` set for HTTP errors.
- The Lab's behaviour and look at `/lab` must not change; its CSS is scoped under `.lab`, the shop's under `.shop`.
- Breakpoints: grid 4 cols ≥1200px, 3 ≥900px, 2 below; sidebar becomes a drawer <900px; search bar wraps <720px; chat panel full-screen <640px.
- Commit after every task, ending each message with the session's attribution trailer lines.

## Review Focus

1. **Product IDs containing `/`, spaces, `#`, or `?`**: links and the detail fetch must still reach the right product. Pinned in Task 2 (`productPath`) and Task 3 (`getProduct` URL).
2. **Category or brand values containing `&`, `+`, spaces, or non-ASCII**: they must survive a URL round-trip unchanged. Pinned in Task 2 (round-trip test with `Shoes & Gear` and `Café+Co`).
3. **A user pressing Send twice, or Enter while a reply is pending**: exactly one request and one user bubble. Pinned in Task 4 (`send while pending is ignored`).
4. **Chat answers containing HTML or markdown** (`<img src=x onerror=…>`): shown as literal text. Pinned in Task 11 (manual check; the mock echoes the question into the answer).
5. **Changing filters while a catalog page or "Load more" is in flight**: the grid must never mix items from the old and new filters. Pinned in Task 8 (manual check with throttled network, plus an abort-on-change requirement).

---

### Task 1: Formatting helpers and test glob

**Files:**
- Create: `src/lib/format.js`, `src/lib/format.test.js`
- Modify: `package.json` (test script)

**Interfaces:**
- Produces: `humanizeCategory(value: string): string`, `formatPrice(price?: { amount: number, currency?: string }): string | null`

- [ ] **Step 1: Change the test script** in `package.json` to `"test": "node --test \"src/**/*.test.js\""`. Run `npm test`. Expected: the existing 8 `api.test.js` tests pass.

- [ ] **Step 2: Write failing tests** in `src/lib/format.test.js`:

```js
test('humanizeCategory title-cases snake_case', () => {
  assert.equal(humanizeCategory('running_shoes'), 'Running Shoes')
  assert.equal(humanizeCategory('boots'), 'Boots')
  assert.equal(humanizeCategory(''), '')
})
test('formatPrice formats currency amounts', () => {
  assert.equal(formatPrice({ amount: 89, currency: 'USD' }), '$89.00')
  assert.equal(formatPrice({ amount: 1200, currency: 'EUR' }), '€1,200.00')
  assert.equal(formatPrice({ amount: 5 }), '$5.00')
})
test('formatPrice returns null for missing or invalid prices', () => {
  assert.equal(formatPrice(undefined), null)
  assert.equal(formatPrice({ amount: 'x', currency: 'USD' }), null)
  assert.equal(formatPrice({ amount: 10, currency: 'NOT_A_CODE' }), null)
})
```

- [ ] **Step 3: Run** `npm test`. Expected: FAIL, module not found.

- [ ] **Step 4: Implement** both functions in `src/lib/format.js`. `humanizeCategory` uses the same logic as the Lab's `humanizeOption` (`replaceAll('_', ' ')`, then capitalize each word). `formatPrice` uses `Intl.NumberFormat('en-US', { style: 'currency', currency })` with currency defaulting to `'USD'`, and returns `null` when the amount isn't a finite number or the formatter throws (`RangeError` for a bad code).

- [ ] **Step 5: Run** `npm test`. Expected: all pass.

- [ ] **Step 6: Commit** `feat: add formatting helpers and recursive test glob`.

---

### Task 2: URL state helpers

**Files:**
- Create: `src/lib/urlState.js`, `src/lib/urlState.test.js`

**Interfaces:**
- Produces:
  - `SEARCH_MODES: Record<'hybrid'|'bm25'|'dense'|'cross_modal', string>` (key → label, in that order)
  - `parseFilters(params: URLSearchParams): { category: string[], brand: string[] }`: trimmed, deduped, empties dropped
  - `parseSearch(params: URLSearchParams): { type: 'text'|'image'|null, query: string, mode: string, filters }`
  - `buildCatalogUrl(filters): string`
  - `buildSearchUrl({ type, query?, mode?, filters }): string`
  - `productPath(productId: string): string`

- [ ] **Step 1: Write failing tests**:

```js
test('parseFilters reads repeated params, trims and dedupes', () => {
  const p = new URLSearchParams('category=shoes&category=%20shoes%20&category=&brand=Acme&x=1')
  assert.deepEqual(parseFilters(p), { category: ['shoes'], brand: ['Acme'] })
})
test('parseSearch detects text, image and empty searches', () => {
  assert.deepEqual(parseSearch(new URLSearchParams('q=%20boots%20&mode=bm25')),
    { type: 'text', query: 'boots', mode: 'bm25', filters: { category: [], brand: [] } })
  assert.equal(parseSearch(new URLSearchParams('type=image&q=ignored')).type, 'image')
  assert.equal(parseSearch(new URLSearchParams('q=%20%20')).type, null)
})
test('parseSearch falls back to hybrid for unknown modes', () => {
  assert.equal(parseSearch(new URLSearchParams('q=a&mode=image_dense')).mode, 'hybrid')
  assert.equal(parseSearch(new URLSearchParams('q=a')).mode, 'hybrid')
})
test('buildCatalogUrl serializes filters or returns root', () => {
  assert.equal(buildCatalogUrl({ category: [], brand: [] }), '/')
  assert.equal(buildCatalogUrl({ category: ['a', 'b'], brand: ['X'] }), '/?category=a&category=b&brand=X')
})
test('buildSearchUrl builds text and image URLs', () => {
  assert.equal(buildSearchUrl({ type: 'text', query: 'black shoes', mode: 'dense', filters: { category: ['shoes'], brand: [] } }),
    '/search?q=black+shoes&mode=dense&category=shoes')
  assert.equal(buildSearchUrl({ type: 'image', filters: { category: [], brand: ['Acme'] } }), '/search?type=image&brand=Acme')
})
test('filter values with reserved characters round-trip', () => {
  const filters = { category: ['Shoes & Gear'], brand: ['Café+Co'] }
  const url = buildSearchUrl({ type: 'text', query: 'a', mode: 'hybrid', filters })
  assert.deepEqual(parseFilters(new URLSearchParams(url.split('?')[1])), filters)
})
test('productPath encodes ids', () => {
  assert.equal(productPath('P1'), '/products/P1')
  assert.equal(productPath('A/B #1?'), '/products/A%2FB%20%231%3F')
})
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** in `src/lib/urlState.js` with `URLSearchParams` for serialization. Param order: `q`, `mode`, then `type`, then `category`s, then `brand`s.

- [ ] **Step 4: Run** `npm test`. Expected: all pass.

- [ ] **Step 5: Commit** `feat: add URL state helpers for shop search and filters`.

---

### Task 3: API functions for the new endpoints, plus the mock

**Files:**
- Modify: `src/api.js` (`request()` and new exports), `src/api.test.js`
- Create: `src/mocks/fixtures.js`, `src/mocks/mockApi.js`, `src/mocks/mockApi.test.js`

**Interfaces:**
- Consumes: `cleanFilters` (existing).
- Produces:
  - `getProducts({ category = [], brand = [], limit = 24, offset = 0, signal, fetchImpl }) → { data: { total, items }, durationMs }`
  - `getProduct({ productId, signal, fetchImpl }) → { data: Product, durationMs }`
  - `sendChatMessage({ messages, signal, fetchImpl }) → { data: { answer, sources }, durationMs }`
  - HTTP errors from `request()` now carry `error.status` (number).
  - `mocks/mockApi.js` exports the same three functions with the same signatures (no `fetchImpl`), plus a `delayMs` option on `sendChatMessage` (default `600`).
  - `mocks/fixtures.js` exports `PRODUCTS: Product[]` (Product shape from spec §5.2).

- [ ] **Step 1: Write failing contract tests** in `src/api.test.js`, using the existing `jsonResponse` helper:

```js
test('getProducts sends repeated filters, limit and offset', async () => {
  // capture url; call getProducts({ category: ['shoes', ' boots '], brand: ['Acme'], limit: 24, offset: 48, fetchImpl })
  assert.equal(url, '/api/v1/products?category=shoes&category=boots&brand=Acme&limit=24&offset=48')
})
test('getProduct encodes the product id', async () => {
  // getProduct({ productId: 'A/B #1', fetchImpl })
  assert.equal(url, '/api/v1/products/A%2FB%20%231')
})
test('getProduct exposes 404 status', async () => {
  const fetchImpl = async () => jsonResponse({ error: { message: 'product not found' } }, 404)
  await assert.rejects(() => getProduct({ productId: 'nope', fetchImpl }), { message: 'product not found', status: 404 })
})
test('sendChatMessage posts the message history', async () => {
  // sendChatMessage({ messages: [{ role: 'user', content: 'boots?' }], fetchImpl })
  assert.equal(url, '/api/v1/chat'); assert.equal(options.method, 'POST')
  assert.deepEqual(JSON.parse(options.body), { messages: [{ role: 'user', content: 'boots?' }] })
})
```

- [ ] **Step 2: Run** `npm test`. Expected: the new tests fail with "not a function"; the existing ones pass.

- [ ] **Step 3: Implement** the three functions in `api.js` and set `status` on the thrown error in `request()` (`Object.assign(new Error(msg), { status: response.status })`). Each function starts with `if (import.meta.env?.VITE_MOCK_API === '1') return (await import('./mocks/mockApi.js')).<sameName>(args)`. The `?.` keeps `node --test` working, because there `import.meta.env` is undefined.

- [ ] **Step 4: Run** `npm test`. Expected: all pass.

- [ ] **Step 5: Create `src/mocks/fixtures.js`**: 24 products, 6 each in `running_shoes`, `hiking_boots`, `backpacks`, `jackets`, across the brands `Acme`, `Northpeak`, `Strider`, `Café+Co`. IDs are `M-001`…`M-024`, `image_url: null` (the cards show a placeholder), and each has a USD price, a 2-paragraph description (separated by a blank line), and 3–4 attributes (Color, Material, Weight, Waterproof). Exception: `M-024` has no `description`, `price`, or `attributes`, to exercise the optional-field paths. At least two titles contain "waterproof" and at least two contain "black".

- [ ] **Step 6: Write failing mock tests** in `src/mocks/mockApi.test.js`:

```js
test('mock getProducts filters and pages', async () => {
  const all = await getProducts({ limit: 10, offset: 20 })
  assert.equal(all.data.total, 24); assert.equal(all.data.items.length, 4)
  const boots = await getProducts({ category: ['hiking_boots'], limit: 24, offset: 0 })
  assert.equal(boots.data.total, 6)
  assert.ok(boots.data.items.every((p) => p.category === 'hiking_boots'))
})
test('mock getProduct returns fixture or 404', async () => {
  assert.equal((await getProduct({ productId: 'M-001' })).data.product_id, 'M-001')
  await assert.rejects(() => getProduct({ productId: 'nope' }), { status: 404 })
})
test('mock chat returns sources matching the question', async () => {
  const r = await sendChatMessage({ messages: [{ role: 'user', content: 'any waterproof boots?' }], delayMs: 0 })
  assert.ok(r.data.answer.includes('any waterproof boots?'))
  assert.ok(r.data.sources.length >= 1 && r.data.sources.length <= 3)
})
test('mock chat fails on demand', async () => {
  await assert.rejects(() => sendChatMessage({ messages: [{ role: 'user', content: 'trigger error' }], delayMs: 0 }))
})
```

- [ ] **Step 7: Run** `npm test`. Expected: the mock tests fail.

- [ ] **Step 8: Implement `src/mocks/mockApi.js`.** List items omit `description` and `attributes` (the list shape from spec §5.1). Chat matching: lowercase the last user message, split it into words of 3+ characters, score each product by word hits in `title` and `humanizeCategory(category)`, and take the top 3 with score > 0. The answer is `` `Here's what I found for "${question}":` `` followed by one line per source, or a "couldn't find" line when there are none. During the delay, reject with an `AbortError` `DOMException` if `signal` aborts.

- [ ] **Step 9: Run** `npm test`. Expected: all pass.

- [ ] **Step 10: Commit** `feat: add product and chat API functions with mock backend`.

---

### Task 4: Chat state reducer

**Files:**
- Create: `src/chat/chatState.js`, `src/chat/chatState.test.js`

**Interfaces:**
- Produces:
  - `initialChatState = { open: false, pending: false, messages: [], nextId: 1 }`
  - Message: `{ id: number, role: 'user'|'assistant'|'error', content: string, sources?: Source[] }`
  - `chatReducer(state, action)`, with actions `{type:'open'}`, `{type:'close'}`, `{type:'send', content}`, `{type:'receive', answer, sources}`, `{type:'fail', message}`, `{type:'retry'}`
  - `toApiMessages(messages): { role, content }[]`: user and assistant only, the last 10

- [ ] **Step 1: Write failing tests**:

```js
test('send appends a trimmed user message and sets pending', () => {
  const s = chatReducer(initialChatState, { type: 'send', content: '  hi  ' })
  assert.equal(s.pending, true); assert.deepEqual(s.messages.map((m) => [m.role, m.content]), [['user', 'hi']])
})
test('send is ignored when blank or while pending', () => {
  assert.equal(chatReducer(initialChatState, { type: 'send', content: '   ' }), initialChatState)
  const pending = chatReducer(initialChatState, { type: 'send', content: 'a' })
  assert.equal(chatReducer(pending, { type: 'send', content: 'b' }), pending)
})
test('receive appends assistant message with sources', () => {
  let s = chatReducer(initialChatState, { type: 'send', content: 'a' })
  s = chatReducer(s, { type: 'receive', answer: 'b', sources: [{ product_id: 'P1' }] })
  assert.equal(s.pending, false); assert.deepEqual(s.messages[1].sources, [{ product_id: 'P1' }])
})
test('fail appends an error message; retry removes it and re-pends', () => {
  let s = chatReducer(initialChatState, { type: 'send', content: 'a' })
  s = chatReducer(s, { type: 'fail', message: 'down' })
  assert.equal(s.messages.at(-1).role, 'error'); assert.equal(s.pending, false)
  s = chatReducer(s, { type: 'retry' })
  assert.equal(s.pending, true); assert.deepEqual(s.messages.map((m) => m.role), ['user'])
})
test('retry is ignored unless the last message is an error', () => {
  assert.equal(chatReducer(initialChatState, { type: 'retry' }), initialChatState)
})
test('message ids are unique and increasing', () => { /* send, receive, send → ids [1,2,3] */ })
test('toApiMessages drops errors and keeps the last 10 turns', () => {
  const messages = Array.from({ length: 12 }, (_, i) => ({ id: i, role: i % 2 ? 'assistant' : 'user', content: String(i) }))
  messages.splice(5, 0, { id: 99, role: 'error', content: 'x' })
  const out = toApiMessages(messages)
  assert.equal(out.length, 10); assert.deepEqual(out[0], { role: 'user', content: '2' })
  assert.ok(out.every((m) => Object.keys(m).join() === 'role,content'))
})
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement** in `src/chat/chatState.js`. Ignored actions return the same state object (the tests check identity).

- [ ] **Step 4: Run** `npm test`. Expected: all pass.

- [ ] **Step 5: Commit** `feat: add chat conversation reducer`.

---

### Task 5: Router, Lab move, and shared FilterField

**Files:**
- Modify: `package.json`, `package-lock.json`, `yarn.lock`, `src/main.jsx`, `src/App.jsx` (becomes the route table), `src/index.css`
- Create: `src/lab/LabPage.jsx` (body of the current `App.jsx`), `src/lab/lab.css` (the current `App.css`), `src/components/FilterField.jsx`, `src/components/useFilterOptions.js`, `src/shop/ShopLayout.jsx`, `src/shop/NotFoundPage.jsx`, `src/shop/shop.css`
- Delete: `src/App.css`

**Interfaces:**
- Consumes: `humanizeCategory` (Task 1).
- Produces:
  - `FilterField({ field, config: { label, placeholder, multiple }, value, draft, options, loading, error, onFocus, onDraftChange, onSelect, onRemove })`. Same behaviour as today. Category labels use `humanizeCategory`.
  - `useFilterOptions(field: string, prefix: string, enabled: boolean, limit = 20): { options, loading, error, reload() }`. Calls `getFilterOptions`, with a 250ms debounce when `prefix` is non-empty and an abort on change.
  - `ShopLayout`: renders `<div className="shop">`, a header placeholder, `<Outlet/>`, and a footer with a `Link` to `/lab`. Tasks 7 and 11 fill in the header and chat.
  - Route table: `/` → `CatalogPage`, `/search` → `SearchPage`, `/products/:productId` → `ProductPage` (each a placeholder `<h1>` in this task), `*` → `NotFoundPage`, all under `ShopLayout`; `/lab` → `LabPage` outside it.

- [ ] **Step 1: Install the router.** Run `npm install react-router@^7`, then `yarn install` to refresh `yarn.lock`. Expected: `react-router` appears in `dependencies`.

- [ ] **Step 2: Move the Lab.** Rename `App.jsx`'s component to `LabPage` in `src/lab/LabPage.jsx` and change its root `<main>` to `<main className="lab">`. Move `App.css` to `src/lab/lab.css` and prefix every selector with `.lab` (`main` becomes `.lab`; the rules inside `@media` blocks get prefixed too). Move the `:root` token rule into `index.css`, along with the `prefers-reduced-motion` rule and `@keyframes pulse`, which must stay global.

- [ ] **Step 3: Extract `FilterField`** into `src/components/FilterField.jsx` with the `config` prop. The Lab passes `config={FILTER_FIELDS[field]}`. Leave the Lab's own option-loading code alone. Write `useFilterOptions` for the shop, following the Lab's debounce and abort pattern.

- [ ] **Step 4: Wire the routes.** `main.jsx` wraps `<App/>` in `<BrowserRouter>`. `App.jsx` holds only the route table. Create `ShopLayout` and `NotFoundPage` (title "Page not found" plus a link home). `shop.css` holds the `.shop` root styles: background `#f6f8fb`, max width 1440px, padding as in the Lab.

- [ ] **Step 5: Verify.** Run `npm test && npm run build`. Expected: both pass. Then run `npm run dev` and check: `/lab` looks and behaves exactly as `/` did on the commit before this task (text compare, filter combobox with chips, image tab, readiness pill); `/` shows the placeholder with the footer's Lab link; `/nope` shows "Page not found"; there are no console errors.

- [ ] **Step 6: Commit** `refactor: add router, move Retrieval Lab to /lab, extract FilterField`.

---

### Task 6: Shop building blocks

**Files:**
- Create: `src/shop/StatusBlock.jsx`, `src/shop/ProductCard.jsx`, `src/shop/ProductGrid.jsx`, `src/shop/FilterSidebar.jsx`
- Modify: `src/shop/shop.css`

**Interfaces:**
- Consumes: `resolveImageUrl`, `getFilterOptions` (api.js); `humanizeCategory`, `formatPrice`; `productPath`; `FilterField`, `useFilterOptions`.
- Produces:
  - `StatusBlock({ tone: 'loading'|'empty'|'error', title, message?, action?: { label, onClick } })`
  - `ProductCard({ product })`. The whole card is a `Link` to `productPath(product.product_id)` (spec §3.5).
  - `ProductGrid({ products, loading = false, skeletonCount = 8 })`. Shows skeleton cards when `loading && products.length === 0`, and uses the spec's column breakpoints.
  - `FilterSidebar({ filters: { category, brand }, onChange(nextFilters) })` (spec §3.3). It owns the <900px "Filters (n)" toggle button and the drawer (with a close button; Esc closes it). The category list comes from `getFilterOptions({ field: 'category', limit: 50 })` and shows an inline error with a Retry button.

- [ ] **Step 1: Implement the four components and their `.shop`-scoped CSS.** Placeholder for missing or broken images: the `◇` glyph on `#e9eef6`, as in the Lab. Titles are clamped to 2 lines.

- [ ] **Step 2: Verify.** Temporarily render `<ProductGrid products={PRODUCTS}/>` and `<FilterSidebar …/>` from the placeholder `CatalogPage`. Run `VITE_MOCK_API=1 npm run dev` with the backend up. Check that: the cards link to `/products/M-001`; `M-024` shows no price; widths 1300/1000/600px give 4/3/2 columns; at 800px the drawer opens, closes, and closes on Esc; category checkboxes and brand chips call `onChange` (log it). Then run `npm run build`. Expected: passes.

- [ ] **Step 3: Commit** `feat: add shop product card, grid, status block and filter sidebar`.

---

### Task 7: Header, search bar, and image search context

**Files:**
- Create: `src/shop/SiteHeader.jsx`, `src/shop/SearchBar.jsx`, `src/shop/ImageSearchContext.jsx`
- Modify: `src/shop/ShopLayout.jsx`, `src/main.jsx` or `App.jsx` (provider placement), `src/shop/shop.css`

**Interfaces:**
- Consumes: `SEARCH_MODES`, `parseSearch`, `parseFilters`, `buildSearchUrl`.
- Produces:
  - `ImageSearchProvider` and `useImageSearch(): { imageFile: File|null, setImageFile(file) }`. The provider wraps the routes so the file survives navigation.
  - `SearchBar`: behaviour in spec §3.1. On `/search` it pre-fills from `parseSearch` (re-syncs when the URL changes). Submit carries the current `parseFilters(location.search)`. A non-image file shows "Choose a JPG, PNG, or WebP image." under the bar.

- [ ] **Step 1: Implement** the provider, `SearchBar` (input `aria-label="Search products"`, mode `<select aria-label="Search mode">`, camera button `aria-label="Search by image"`, submit disabled while the input is blank), and `SiteHeader` (brand link plus `SearchBar`). Mount the header in `ShopLayout`. Below 720px the search bar wraps to a full-width second row.

- [ ] **Step 2: Verify** with `npm run dev`: typing "black shoes", choosing Dense text, and submitting from `/?category=running_shoes` lands on `/search?q=black+shoes&mode=dense&category=running_shoes`; on that page the input and select are pre-filled; picking a `.txt` file shows the inline error; picking an image lands on `/search?type=image&category=running_shoes`. Run `npm run build`. Expected: passes.

- [ ] **Step 3: Commit** `feat: add shop header with text and image search bar`.

---

### Task 8: Catalog page

**Files:**
- Modify: `src/shop/CatalogPage.jsx`, `src/shop/shop.css`

**Interfaces:**
- Consumes: `getProducts`, `parseFilters`, `buildCatalogUrl`, `humanizeCategory`, `FilterSidebar`, `ProductGrid`, `StatusBlock`.

- [ ] **Step 1: Implement** spec §3.2. Filters come from `useSearchParams` through `parseFilters`; `FilterSidebar.onChange` calls `navigate(buildCatalogUrl(next))`. The fetch effect is keyed on the serialized filters: it resets the items and fetches `offset: 0, limit: 24` with an `AbortController`, aborting on change. "Load more" fetches `offset: items.length` using an `AbortController` stored in a ref, and that ref is aborted by the same filter-change cleanup, so a stale page can never be appended (Review Focus 5). The toolbar shows the title (`All products`, or the humanized categories joined by `, `), `{total} products`, active-filter chips, and "Clear all". States: loading skeletons; an error `StatusBlock` with Retry; an empty `StatusBlock` with a "Clear filters" action. Load-more errors show inline next to the button with a Retry.

- [ ] **Step 2: Verify** with `VITE_MOCK_API=1 npm run dev`: `/` shows 24 products and no Load more (total 24); temporarily set the page size to 10 to check that Load more reaches 24 and then hides, then revert it; selecting Hiking Boots gives 6 and the URL updates; Back restores all products; with DevTools set to Slow 3G, click Load more and immediately change the category — the grid only ever shows items from the new category. Run `npm run build`. Expected: passes.

- [ ] **Step 3: Commit** `feat: add catalog page with category and brand filters`.

---

### Task 9: Search results page

**Files:**
- Modify: `src/shop/SearchPage.jsx`, `src/shop/shop.css`

**Interfaces:**
- Consumes: `searchText`, `searchImage`, `parseSearch`, `buildSearchUrl`, `buildCatalogUrl`, `SEARCH_MODES`, `useImageSearch`, `FilterSidebar`, `ProductGrid`, `StatusBlock`.

- [ ] **Step 1: Implement** spec §3.4. `type === null` → `<Navigate to={buildCatalogUrl(filters)} replace />`. Text → `searchText({ query, mode, topK: 20, filters })`; image → `searchImage({ file: imageFile, topK: 20, filters })`. Image with no file → an empty `StatusBlock` whose action opens a file picker and calls `setImageFile`. Abort the previous request when the params or the file change. The header shows the query (or a thumbnail from `URL.createObjectURL`, revoked on cleanup), `SEARCH_MODES[mode]` (or "Image similarity"), the result count, and `{durationMs} ms`. Results map straight into `ProductGrid` (they have the same fields as the list items). Filter changes call `navigate(buildSearchUrl({ ...search, filters: next }))`. The empty state includes a "Try another mode" hint.

- [ ] **Step 2: Verify** against the real backend with `npm run dev`: run "black running shoes" in each of the 4 modes; add a category filter; run an image search; reload on `/search?type=image` and get the picker state; `/search` with no params redirects to `/`; stop the backend and get an error block with Retry. Run `npm run build`. Expected: passes.

- [ ] **Step 3: Commit** `feat: add search results page for text and image search`.

---

### Task 10: Product detail page

**Files:**
- Modify: `src/shop/ProductPage.jsx`, `src/shop/shop.css`

**Interfaces:**
- Consumes: `getProduct`, `searchText`, `resolveImageUrl`, `formatPrice`, `humanizeCategory`, `buildCatalogUrl`, `ProductCard`, `StatusBlock`, and `useChat().openChat` from Task 11. Until Task 11 lands, render the "Ask ShopMind about products" button without an `onClick`; Task 11 wires it.

- [ ] **Step 1: Implement** spec §3.6. `productId` comes from `useParams()` (already decoded by the router). Description paragraphs are split on `/\n\s*\n/`. Details is a `<table>` of attribute name/value pairs. Similar products: `searchText({ query: product.title, mode: 'hybrid', topK: 9 })`, filter out the current `product_id`, show at most 8, hide the section on an empty result or an error. `error.status === 404` → a "Product not found" `StatusBlock` with a Home link; other errors → an error `StatusBlock` with Retry. Scroll to the top when `productId` changes.

- [ ] **Step 2: Verify** with `VITE_MOCK_API=1 npm run dev`: `/products/M-001` shows the breadcrumb, price, two description paragraphs and the Details table; `/products/M-024` shows no price, description or details and nothing looks broken; `/products/nope` shows "Product not found"; the breadcrumb category link goes to `/?category=…`. Similar products uses the real backend: with it running, the section shows real products; with it stopped, the section is hidden and the page still works. Run `npm run build`. Expected: passes.

- [ ] **Step 3: Commit** `feat: add product detail page`.

---

### Task 11: Chat widget

**Files:**
- Create: `src/chat/ChatProvider.jsx`, `src/chat/ChatWidget.jsx`, `src/chat/chat.css`
- Modify: `src/shop/ShopLayout.jsx` (mount the widget), `App.jsx` or `main.jsx` (provider placement), `src/shop/ProductPage.jsx` (wire the Ask button)

**Interfaces:**
- Consumes: `chatReducer`, `initialChatState`, `toApiMessages`, `sendChatMessage`, `productPath`, `resolveImageUrl`.
- Produces: `ChatProvider` and `useChat(): { open, pending, messages, openChat(), closeChat(), send(content), retry() }`.

- [ ] **Step 1: Implement `ChatProvider`.** It uses `useReducer(chatReducer, initialChatState)`. One effect keyed on `state.pending`: when it turns true, call `sendChatMessage({ messages: toApiMessages(state.messages), signal })` and dispatch `receive` (with `sources ?? []`) or `fail` (ignore `AbortError`); abort on cleanup. This works under `StrictMode`'s double effect run, because the first call is aborted. Place the provider so it wraps all shop routes; the conversation must survive navigation.

- [ ] **Step 2: Implement `ChatWidget`** per spec §3.7, using the copy given there: the launcher, the `role="dialog"` panel with `aria-label="ShopMind Assistant"`, focus on the input when opened, Esc closes it, the 3 suggestion chips, user and assistant bubbles (assistant text with `white-space: pre-wrap`), source mini-cards as `Link`s to `productPath(...)`, a typing indicator while `pending`, error bubbles with Retry, `aria-live="polite"` on the list, and auto-scroll to the newest message. Enter sends; Shift+Enter inserts a newline; the send button is disabled while `pending` or the input is blank. Below 640px the panel is full-screen.

- [ ] **Step 3: Wire** the product page's "Ask ShopMind about products" button to `openChat()`.

- [ ] **Step 4: Verify** with `VITE_MOCK_API=1 npm run dev`:
  - A suggestion chip sends; the typing indicator shows for about 600ms; the reply lists up to 3 source cards that open the product pages.
  - Navigating from `/` to a product keeps the conversation.
  - Sending `<img src=x onerror=alert(1)> waterproof` shows the tag literally in both bubbles and no alert fires (Review Focus 4).
  - Pressing Enter twice quickly sends one message (Review Focus 3).
  - "trigger error" gives an error bubble; Retry leaves one user bubble followed by a new error bubble, because the mock fails again on that text.
  - Esc closes the panel; at 400px width the panel is full-screen.
  - `npm test && npm run build` pass.

- [ ] **Step 5: Commit** `feat: add floating RAG chat widget`.

---

### Task 12: Docs and final check

**Files:**
- Modify: `README.md`, `index.html` (title `ShopMind · Shop`, description "Shop the ShopMind catalog with multimodal search and a RAG assistant.")

- [ ] **Step 1: Update the README.** Add a "Storefront" section listing the routes; a `VITE_MOCK_API=1 npm run dev` section that says which three endpoints it mocks and why; and the three backend contracts, linking to spec §5 rather than copying them.

- [ ] **Step 2: Final verification.** Run `npm test && npm run build`. Expected: both pass. Then repeat the spec §7 manual checklist end to end, once with `VITE_MOCK_API=1` and once against the real backend for search, filters, similar products and `/lab`.

- [ ] **Step 3: Commit** `docs: document storefront routes, mock API and backend contracts`, then push the branch.
