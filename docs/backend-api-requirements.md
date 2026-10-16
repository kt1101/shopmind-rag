# Backend API Requirements for ShopMind Storefront

This document details the backend APIs required to fully support the shopper-facing storefront (`/`, `/search`, `/products/:productId`, and the floating RAG assistant).

When running with `VITE_MOCK_API=1`, the three new endpoints, plus the existing A3 `POST /api/v1/rag/ask` (so product questions work with mock product IDs), are served by an in-memory mock (`src/mocks/mockApi.js`), while search and filter-option calls continue to hit the live backend.

---

## 1. New Endpoints (Required for Full Storefront Deployment)

All new endpoints follow standard JSON error responses:
```json
{
  "error": {
    "message": "Human-readable description of error"
  }
}
```

### 1.1 List Products
Enables browsing the product catalog with multi-value filtering and offset-based pagination.

- **Method**: `GET`
- **Path**: `/api/v1/products`
- **Used by**: `CatalogPage` (`/`)
- **Query Parameters**:
  | Parameter | Type | Required | Default | Description |
  |---|---|---|---|---|
  | `category` | `string` (repeatable) | No | `[]` | Filter by category names (e.g. `?category=running_shoes&category=hiking_boots`) |
  | `brand` | `string` (repeatable) | No | `[]` | Filter by brand names (e.g. `?brand=Acme&brand=Northpeak`) |
  | `limit` | `integer` | No | `24` | Number of items to return per page |
  | `offset` | `integer` | No | `0` | Starting index for pagination ("Load more") |

- **Success Response (`200 OK`)**:
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
      "price": {
        "amount": 89.0,
        "currency": "USD"
      }
    }
  ]
}
```
*Note: `price` is optional (items without pricing omit the field or set it to null). Items in list view omit long `description` and `attributes`.*

---

### 1.2 Get Product Details
Retrieves complete product information, specifications, and descriptions.

- **Method**: `GET`
- **Path**: `/api/v1/products/{product_id}`
- **Used by**: `ProductPage` (`/products/:productId`)
- **Path Parameter**:
  - `product_id` (`string`, URL-encoded)
- **Success Response (`200 OK`)**:
```json
{
  "product_id": "P123",
  "title": "Trail Runner 2",
  "brand": "Acme",
  "category": "running_shoes",
  "image_url": "/media/products/P123.jpg",
  "description": "Lightweight trail shoe engineered for rough terrain.\n\nBreathable mesh upper with reinforced toe bumper.",
  "price": {
    "amount": 89.0,
    "currency": "USD"
  },
  "attributes": [
    { "name": "Color", "value": "Black" },
    { "name": "Material", "value": "Ripstop nylon" },
    { "name": "Weight", "value": "310g" },
    { "name": "Waterproof", "value": "Yes" }
  ]
}
```
*Note: `description`, `price`, and `attributes` are optional.*

- **Error Responses**:
  - `404 Not Found` with `{ "error": { "message": "product not found" } }` if product ID does not exist.

---

### 1.3 Chat Assistant (RAG)
Conversational assistant grounded in the catalog, answering shopper questions and citing source products.

- **Method**: `POST`
- **Path**: `/api/v1/chat`
- **Used by**: `ChatWidget` (floating assistant across all storefront pages)
- **Headers**:
  - `Content-Type: application/json`
- **Request Body**:
```json
{
  "messages": [
    { "role": "user", "content": "Hi, what do you recommend for wet trails?" },
    { "role": "assistant", "content": "I recommend waterproof hiking boots with Vibram outsoles." },
    { "role": "user", "content": "Any boots under $100?" }
  ]
}
```
*Note: Sends up to the last 10 conversation turns, ending with the user's latest question. Only `user` and `assistant` roles are sent.*

- **Success Response (`200 OK`)**:
```json
{
  "answer": "Here are two waterproof options under $100 from our catalog:\n\n• Ridge GTX Boot ($89.00)\n• Mudguard Low ($79.00)",
  "sources": [
    {
      "product_id": "P9",
      "title": "Ridge GTX Boot",
      "brand": "Acme",
      "category": "hiking_boots",
      "image_url": "/media/products/P9.jpg"
    },
    {
      "product_id": "P14",
      "title": "Mudguard Low",
      "brand": "Strider",
      "category": "hiking_boots",
      "image_url": "/media/products/P14.jpg"
    }
  ]
}
```
*Note: `answer` is plain text (preserves line breaks; UI renders with `white-space: pre-wrap`). `sources` may be an empty array if no specific products are cited.*

---

## 2. Existing Endpoints Reused by the Storefront

The storefront connects to existing endpoints already implemented in the multimodal backend:

| Endpoint | Method | Consumed By | Description |
|---|---|---|---|
| `/api/v1/search/text` | `POST` | `SearchPage`, `ProductPage` | Text search supporting modes `hybrid`, `bm25`, `dense`, `cross_modal` with category/brand filtering. Also used to populate the "Similar products" row on product pages. |
| `/api/v1/search/image` | `POST` (multipart) | `SearchPage` | Visual similarity search by uploaded image with category/brand filtering. |
| `/api/v1/search/filter-options` | `GET` | `FilterSidebar` | Fetches available categories with counts and brand typeahead suggestions (`?field=category&limit=50`). |
| `/media/products/*` | `GET` | All pages | Serves static product images. |
| `/ready` | `GET` | `/lab` | Backend service readiness probe. |
