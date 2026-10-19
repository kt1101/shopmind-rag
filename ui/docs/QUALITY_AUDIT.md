# UI quality audit (2026-10-17)

Quality pass on the React UI, no new features. Every page was walked in headless Chrome
against the real backend (`VITE_API_PROXY_TARGET=http://127.0.0.1:8000`, no LLM key, so RAG
answers return `503 llm_unavailable`) at 1366×900 and 390×844, light and dark, Vietnamese and
English: catalog, search (text, empty, image, compose + α slider), product page + Q&A,
compare, cart/wishlist, planner (empty + result), chat (product search, chitchat, plan,
llm_unavailable), every admin page (login, dashboard, config, traces + inspector drawer,
indexes & jobs, policies, evaluation, feedback, annotation, search playground, embedding map)
and the storefront in staff mode (pipeline name + Search Inspector). Each page was also probed
for horizontal scroll, unlabeled form controls, nameless buttons/links, images without `alt`,
console errors and failed requests; request counts were measured for page loads, fast typing
in the search box and quick α-slider moves.

Severity: **high** = wrong or misleading on a demo path, or broken for some users;
**medium** = visible polish/consistency problem or a11y gap; **low** = minor.

## Findings and fixes

| Page | Issue | Severity | Category | Fix / why not |
|---|---|---|---|---|
| Chat | A question that hits `503 llm_unavailable` showed "Không kết nối được trợ lý" + the raw "OPENAI_API_KEY is not configured" and a Retry button that can never work | high | copy / logic | `shared/api/errors.js` maps status/code to a plain message: "Chưa trả lời được câu hỏi này — phần trả lời bằng AI đang tắt… bạn vẫn tìm sản phẩm, so sánh và lên kế hoạch được", neutral colour, link to the planner instead of Retry |
| Product Q&A | Same raw "OPENAI_API_KEY is not configured" in red | high | copy | Same plain message; technical text folded under "Chi tiết kỹ thuật"; Retry only when it can help |
| Product Q&A | The panel is below the fold at 1366×900: after "Hỏi" the answer or the error appeared off-screen, so the button looked dead | medium | UX | The new answer / error scrolls into view (`block: nearest`) |
| Catalog, search, product, compare, planner | Error blocks printed `error.message` (English, backend wording) | high | copy / i18n | `ErrorBlock` shows the page headline + a plain explanation per error kind (network, timeout, server, rate limit, invalid, not found) |
| Chat (SSE) | A connection that dropped mid-answer surfaced as a generic TypeError; a stream ending without `done` had an English message | high | logic / robustness | `chatStream` rejects with `code: stream_incomplete` ("Câu trả lời bị ngắt giữa chừng"); user aborts stay AbortError; reader cancelled after an `error` event (tests added) |
| Admin (all pages) | Console almost entirely English, with one mixed "Thuật toán tìm kiếm của cửa hàng · Storefront search algorithm" title; not translatable | high | i18n | All admin strings go through the shared dictionary (`shared/i18n.admin.js`), Vietnamese by default, EN/VI toggle in the top bar; technical ids (pipelines, config keys, metrics, job types, JSON) unchanged; button names follow DEMO_SCRIPT ("Lưu thành profile", "Chạy đánh giá", "Lưu nháp", "Publish", "Rollback") |
| Search Playground | Category/brand menus empty: the UI asked `filter-options?limit=100` (backend max 50 → 422); after that, React warned about duplicate `[object Object]` keys because the backend returns `[{value,count}]` | high | logic | `limit=50`; `normalizeOptions()` accepts both `[str]` and `[{value,count}]` (also used by the storefront brand autocomplete) |
| Catalog, search, product, planner, embedding map | Real categories rendered raw: `CELLULAR PHONE CASE`, `HOME BED AND BATH`, `FINENECKLACEBRACELETANKLET` (also in vi) | high | i18n / copy | `shared/catalogLabels.js`: Vietnamese names for the most common catalog types (every type in the top 110 by product count, 168 in total) ("Ốp điện thoại", "Chăn ga & phòng tắm", "Dây chuyền, vòng tay cao cấp"), English overrides for glued words, readable Title Case fallback |
| Drawer (Search/RAG/plan inspector) | Effect depended on an inline `onClose`, so every parent re-render (trace arriving, streamed chat token) re-ran it: focus jumped back to the close button | high | a11y / logic | `onClose` read through a ref; effect depends on `open` only; focus returns to the opener only if it is still in the page |
| Search (nonsense query, dense-only results) | Sidebar showed two empty "DANH MỤC" / "THƯƠNG HIỆU" boxes | medium | visual / UX | Facet groups without values are hidden and "Không có bộ lọc cho kết quả này." is shown |
| Product cards, compare, planner, cart | `object-fit: cover` cut products off (boots, backpacks, jewellery) | medium | visual | Packshots shown whole (`contain` on white) |
| Product page | Attribute names in English (Color, Material, Product type) and product type value `SOFA` in vi | medium | i18n | `attributeLabel()`; product type via `categoryLabel()`; names are row headers (`th scope=row`) |
| Compare | Row names `brand/category/price/stock`; cells "692.99 USD (synthetic)", "in stock (80, synthetic)" in vi | medium | i18n | Row names localized; price/stock cells re-rendered ("$692.99 (giả lập)", "Còn hàng (80)"), unknown text passes through (`localizeCompareValue`, tested) |
| Compare | 👍/👎 "Câu trả lời có hữu ích không?" under a summary that does not exist (no LLM) | medium | UX / logic | Hidden when `llm_available === false` (nothing to rate, avoids junk feedback rows) |
| Compare | No-LLM banner: "Chưa cấu hình LLM (OPENAI_API_KEY)…" in heavy bold | medium | copy | "Phần nhận xét bằng AI đang tắt trên máy chủ này. Bảng thuộc tính ở trên vẫn đủ để bạn so sánh." |
| Compare | Remove "×" was a tiny ghost button far from the product | low | visual / a11y | Round 28 px button in the column corner with a name |
| Titles (all shopper views) | HTML entities from the data: "Dove Grey &amp;amp; Black" | medium | visual | `displayTitle()` decodes entities for display (text only); see backend list |
| Cart | Rows showed the unit price only; total had no label | medium | correctness / UX | Line total (price × quantity) with "… / món" when quantity > 1, labelled "Tạm tính"; per-row button names |
| Planner | After swapping/removing an item the server summary still quoted its own total ("tổng 253.94 USD") while the budget bar showed the new total | medium | logic | `isEdited(plan)` (tested) adds a note that the summary describes the original suggestion |
| Planner | Thumbnail link next to the title link had no accessible name | medium | a11y | Duplicate link removed from tab order and the accessibility tree |
| Chat | `aria-live` on the whole message list announced every streamed token | medium | a11y | `role=log`, `aria-relevant=additions`, `aria-busy` while streaming; progress/“done” labels translated |
| Chat | Closing the panel (Esc or ×) left focus nowhere | medium | a11y | Focus returns to the launcher |
| Chat | Smooth scrolling on every streamed token stuttered | low | performance / UX | Instant scroll while streaming, smooth for new messages |
| Mobile filter drawer | Opening/closing did not move focus | medium | a11y | Focus goes to the close button, back to the toggle on close |
| Footer / last rows | The floating chat button covered the footer note ("…phục vụ demo") and the right end of the last row | medium | visual | Footer keeps clear of the button (right padding) |
| Labels (cards, Q&A kicker and form labels, filter titles, chat citations) | Uppercase monospace crowded Vietnamese diacritics; long category eyebrows wrapped to two lines and misaligned card titles | low | visual / typography | Sans font with letter-spacing; eyebrows on one line with ellipsis; long facet labels truncate with a tooltip |
| Sidebar | "Số lượng theo kết quả hiện tại" floated above the first card | low | visual | Moved under the lists it describes |
| Image / compose search | The facet hint claimed counts follow the results, but without a keyword query they cover the whole catalog | low | copy / logic | "Số lượng tính trên toàn bộ danh mục" on image and compose search |
| Planner (mobile) | After "Lên kế hoạch" the result rendered below the form and six example chips, off-screen | medium | UX | The result scrolls into view after a submit/example when it starts below the fold (not on shared links or swaps) |
| Storefront copy | "dữ liệu tổng hợp (synthetic)" reads as "aggregated data"; "Tìm bằng kNN trên vector ảnh SigLIP2" and "Nhận xét (RAG…)" leak algorithms to shoppers | medium | copy | "dữ liệu giả lập"; "Những sản phẩm có hình ảnh giống sản phẩm này nhất"; plainer evidence warnings ("Mình chưa tìm đủ thông tin để trả lời chắc chắn câu này") |
| Storefront a11y strings | "Skip to content", nav label "ShopMind", "Loading options…", "No suggestions", "Product", inspector "N steps", legacy chat replies were English in vi | low | i18n | Translated |
| English mode | "1 products", "Added 1 items" | low | i18n | `translate()` uses a `<key>.one` variant for count 1 |
| Product Q&A sources | Source type shown as raw `product` / `policy`, "version 2026-09", "rrf score" | low | i18n | Localized source names and version; score type dropped from shopper text |
| Embedding map | 1,500 `<circle>` elements re-rendered on every mouse move (hover state) | medium | performance | Memoized dots layer, nearest-point lookup once per animation frame, state only changes when the hovered product changes |
| Embedding map | Switching the space re-ran the text search for the top-k although it does not depend on the space | low | performance | Projection per space, top-k search once per query |
| Admin dates | Shown in UTC (`toISOString`) without saying so | low | correctness | Local time, same `YYYY-MM-DD HH:mm` format |
| Admin pills / kappa / grades / validation | Status words, kappa bands, grade names, client validation messages in English | low | i18n | Translated at display time; pure helpers and their tests unchanged |
| All | No visible focus ring on several storefront/chat controls | medium | a11y | `:focus-visible` outline on links, buttons, inputs, summaries |

### Checked and fine (no change)

- **Request hygiene**: search, facets, understand, product, similar, compare and plan requests
  all use `AbortController`; header autocomplete is debounced (180 ms; typing 11 characters
  quickly sent 1 request); the α slider is debounced (8 quick moves sent 2 compose requests,
  the stale one aborted); facets are debounced 120 ms. The doubled requests seen in dev are
  React StrictMode's mount/unmount/mount (the first is aborted); production builds send one.
- URL state: search filters, compose α, planner `q`/`budget`, playground, traces and
  feedback filters live in the URL (read on load, written on change).
- Double submits: chat, Q&A, planner, compare, feedback, admin forms disable their buttons
  while a request runs.
- No horizontal scroll at 390 px on any walked page and no images without `alt` (automated
  probe on every screenshot); dark mode uses the token palette (product photos keep a white
  backdrop on purpose, they are packshots on white).

### Not fixed (reason)

| Page | Issue | Why not |
|---|---|---|
| Search results | Result cards have no price (catalog cards do) | `ProductResult` from `/search/*` carries no price; adding it is a backend change |
| Search | A nonsense query ("xyzzyqwert") returns 20 products | Dense retrieval always returns neighbours; a minimum-score cut-off belongs in the pipeline config |
| Chat | Product-search answers repeat the product list as text above the cards and say "Mình đã hiểu: color: gray; giá max 500 (giá tổng hợp)" | Answer text is written by the backend |
| Planner / Q&A | Policy tips and some summaries are English | Policy texts in the index are English; backend content |
| Product page | Low-resolution source photos look soft when enlarged | Source data |

## Backend issues and contract mismatches (not changed, `api/` is out of scope)

1. **`GET /search/filter-options` shape**: returns `options: [{value, count}]`; the contract
   (docs/API_CONTRACT.md) says `options: [str]`. The UI now accepts both. Evidence:
   `curl /api/v1/search/filter-options?field=brand&limit=3` →
   `{"options":[{"value":"AmazonBasics","count":289},…]}`.
2. **`limit` bound**: `filter-options` rejects `limit > 50` with 422 `validation_error` (the
   contract gives no bound).
3. **Compare cells in English**: `/rag/compare` writes `price` and `stock` as English text
   ("692.99 USD (synthetic)", "in stock (80, synthetic)"); structured values (amount,
   currency, quantity) would let any client format them.
4. **HTML entities in titles**: e.g. B075X4VW2P "…Dove Grey &amp;amp; Black"; ingestion should
   unescape.
5. **Colour vocabulary**: the colour facet still lists non-English raw values (`काला`, `नीला`,
   `zwart`) and near-duplicates (`multicolor` / `multi-colored`, `gray` / `grey`).
6. **Chat product search**: "Tìm sofa xám dưới 500" returns patio chairs, an office chair and
   a media cabinet; only `color: gray` and `price_max` were extracted, not `category: SOFA`.
7. **`/chat` answer text** for `product_search` duplicates the product list and mixes English
   filter names into Vietnamese ("color: gray", "giá tổng hợp").
