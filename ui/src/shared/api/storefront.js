// Public storefront API client (docs/API_CONTRACT.md: Search, Products, RAG, Chat, Feedback,
// Meta). Every function resolves to {data, durationMs, requestId} like `request` in http.js.
// With VITE_MOCK_API=1 (and no injected `fetchImpl`) calls are served by src/mocks/mockApi.js,
// so the whole storefront runs without a backend.

import { USE_MOCK_API, jsonBody, request } from './http.js'
import { cleanFilters } from './filters.js'
import { createSSEParser } from './sse.js'

export { cleanFilters }

const API = '/api/v1'

async function mock(name, args) {
  return (await import('../../mocks/mockApi.js'))[name](args)
}

function useMock(args) {
  return USE_MOCK_API && !args?.fetchImpl
}

function appendFilters(params, filters) {
  for (const [key, value] of Object.entries(cleanFilters(filters))) {
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item)
  }
}

function explainFlag(explain) {
  return explain ? { explain: true } : {}
}

// --- health -----------------------------------------------------------------------------

export function checkReadiness(signal, fetchImpl = fetch) {
  if (USE_MOCK_API && fetchImpl === fetch) return mock('checkReadiness', signal)
  return request('/ready', { signal }, fetchImpl)
}

// --- search -----------------------------------------------------------------------------

// POST /search/text. The storefront omits `mode` and `pipeline` so the backend runs the
// admin-configured default (`defaults.search`); staff tools (Search Playground) pass `pipeline`.
export function searchText(args = {}) {
  if (useMock(args)) return mock('searchText', args)
  const { query, mode, pipeline, topK, offset, filters, sort, explain, signal, fetchImpl = fetch } = args
  const body = { query: (query || '').trim(), top_k: topK, filters: cleanFilters(filters) }
  if (mode) body.mode = mode
  if (pipeline) body.pipeline = pipeline
  if (offset) body.offset = offset
  if (sort) body.sort = sort
  return request(`${API}/search/text`, { ...jsonBody({ ...body, ...explainFlag(explain) }), signal }, fetchImpl)
}

export function searchImage(args = {}) {
  if (useMock(args)) return mock('searchImage', args)
  const { file, topK, offset, filters, explain, signal, fetchImpl = fetch } = args
  const params = new URLSearchParams({ top_k: String(topK) })
  if (offset) params.set('offset', String(offset))
  appendFilters(params, filters)
  if (explain) params.set('explain', 'true')
  const body = new FormData()
  body.set('image', file)
  return request(`${API}/search/image?${params}`, { method: 'POST', body, signal }, fetchImpl)
}

// F1: image + text composed query. `alpha` is the image weight in [0, 1].
export function searchCompose(args = {}) {
  if (useMock(args)) return mock('searchCompose', args)
  const { file, text, alpha, topK, explain, signal, fetchImpl = fetch } = args
  const body = new FormData()
  body.set('image', file)
  body.set('text', (text || '').trim())
  if (alpha != null) body.set('alpha', String(alpha))
  if (topK != null) body.set('top_k', String(topK))
  if (explain) body.set('explain', 'true')
  return request(`${API}/search/compose`, { method: 'POST', body, signal }, fetchImpl)
}

export function searchSuggest(args = {}) {
  if (useMock(args)) return mock('searchSuggest', args)
  const { q, limit = 8, signal, fetchImpl = fetch } = args
  const params = new URLSearchParams({ q: (q || '').trim(), limit: String(limit) })
  return request(`${API}/search/suggest?${params}`, { signal }, fetchImpl)
}

export function getFacets(args = {}) {
  if (useMock(args)) return mock('getFacets', args)
  const { query, filters, signal, fetchImpl = fetch } = args
  const body = { filters: cleanFilters(filters) }
  if (query && query.trim()) body.query = query.trim()
  return request(`${API}/search/facets`, { ...jsonBody(body), signal }, fetchImpl)
}

export function understandQuery(args = {}) {
  if (useMock(args)) return mock('understandQuery', args)
  const { query, signal, fetchImpl = fetch } = args
  return request(`${API}/search/understand`, { ...jsonBody({ query: (query || '').trim() }), signal }, fetchImpl)
}

export function getFilterOptions(args = {}) {
  if (useMock(args)) return mock('getFilterOptions', args)
  const { field, prefix = '', limit = 20, signal, fetchImpl = fetch } = args
  const params = new URLSearchParams({ field, prefix: prefix.trim(), limit: String(limit) })
  return request(`${API}/search/filter-options?${params}`, { signal }, fetchImpl)
}

// --- products ---------------------------------------------------------------------------

export function getProducts(args = {}) {
  if (useMock(args)) return mock('getProducts', args)
  const { category = [], brand = [], limit = 24, offset = 0, signal, fetchImpl = fetch } = args
  const params = new URLSearchParams()
  appendFilters(params, { category, brand })
  if (limit != null) params.set('limit', String(limit))
  if (offset != null) params.set('offset', String(offset))
  const qs = params.toString()
  return request(`${API}/products${qs ? `?${qs}` : ''}`, { signal }, fetchImpl)
}

export function getProduct(args = {}) {
  if (useMock(args)) return mock('getProduct', args)
  const { productId, signal, fetchImpl = fetch } = args
  return request(`${API}/products/${encodeURIComponent(productId)}`, { signal }, fetchImpl)
}

export function getSimilarProducts(args = {}) {
  if (useMock(args)) return mock('getSimilarProducts', args)
  const { productId, limit = 8, signal, fetchImpl = fetch } = args
  return request(`${API}/products/${encodeURIComponent(productId)}/similar?limit=${encodeURIComponent(limit)}`, { signal }, fetchImpl)
}

// --- RAG --------------------------------------------------------------------------------

export function askProduct(args = {}) {
  if (useMock(args)) return mock('askProduct', args)
  const { question, productId, sources = ['product'], debug = false, explain = false, signal, fetchImpl = fetch } = args
  const body = { question: question.trim(), product_id: productId, sources, ...(debug ? { debug: true } : {}), ...explainFlag(explain) }
  return request(`${API}/rag/ask`, { ...jsonBody(body), signal }, fetchImpl)
}

export function ragCompare(args = {}) {
  if (useMock(args)) return mock('ragCompare', args)
  const { productIds = [], question, explain, signal, fetchImpl = fetch } = args
  const body = { product_ids: productIds, ...(question && question.trim() ? { question: question.trim() } : {}), ...explainFlag(explain) }
  return request(`${API}/rag/compare`, { ...jsonBody(body), signal }, fetchImpl)
}

// F6 shopping planner. `budget` (USD) is optional; the backend may also parse it from the text.
export function planBody({ request: text, budget, language, maxNeeds, explain } = {}) {
  const body = { request: String(text || '').trim() }
  const amount = Number(budget)
  if (budget !== null && budget !== undefined && budget !== '' && Number.isFinite(amount) && amount > 0) body.budget = amount
  if (language === 'vi' || language === 'en') body.language = language
  if (Number.isInteger(maxNeeds)) body.max_needs = Math.min(8, Math.max(2, maxNeeds))
  if (explain) body.explain = true
  return body
}

export function ragPlan(args = {}) {
  if (useMock(args)) return mock('ragPlan', args)
  const { signal, fetchImpl = fetch } = args
  return request(`${API}/rag/plan`, { ...jsonBody(planBody(args)), signal }, fetchImpl)
}

// --- chat -------------------------------------------------------------------------------

export function chatRequestBody({ message, history = [], productId, sessionId, imageToken, explain } = {}) {
  const body = { message: (message || '').trim(), history }
  if (productId) body.product_id = productId
  if (sessionId) body.session_id = sessionId
  if (imageToken) body.image_token = imageToken
  if (explain) body.explain = true
  return body
}

export function chat(args = {}) {
  if (useMock(args)) return mock('chat', args)
  const { signal, fetchImpl = fetch } = args
  return request(`${API}/chat`, { ...jsonBody(chatRequestBody(args)), signal }, fetchImpl)
}

// POST /chat/stream. `onEvent({event, data})` receives every SSE event (meta, step, products,
// delta, reset, unknown ones too). Resolves with the `done` payload; an `error` event rejects.
export async function chatStream(args = {}) {
  if (useMock(args)) return mock('chatStream', args)
  const { signal, onEvent, fetchImpl = fetch } = args
  const started = performance.now()
  const response = await fetchImpl(`${API}/chat/stream`, {
    ...jsonBody(chatRequestBody(args)),
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    signal,
  })
  if (!response.ok) {
    let data = null
    try {
      data = await response.json()
    } catch {
      data = null
    }
    throw Object.assign(new Error(data?.error?.message || `Request failed (${response.status})`), { status: response.status, code: data?.error?.code })
  }
  let done = null
  let streamError = null
  const parser = createSSEParser((evt) => {
    if (evt.event === 'done') done = evt.data
    if (evt.event === 'error') streamError = evt.data
    onEvent?.(evt)
  })
  const reader = response.body?.getReader?.()
  try {
    if (reader) {
      const decoder = new TextDecoder()
      for (;;) {
        const { value, done: finished } = await reader.read()
        if (finished) break
        parser.push(decoder.decode(value, { stream: true }))
        if (streamError) break
      }
      parser.push(decoder.decode())
    } else {
      parser.push(await response.text())
    }
  } catch (error) {
    // The connection dropped mid-answer (not a user abort): report it as an incomplete stream.
    signal?.throwIfAborted()
    if (error?.name === 'AbortError') throw error
    throw Object.assign(new Error(error?.message || 'The assistant stream was interrupted'), { code: 'stream_incomplete', cause: error })
  } finally {
    if (streamError) reader?.cancel?.().catch?.(() => {})
  }
  parser.flush()
  signal?.throwIfAborted()
  if (streamError) {
    throw Object.assign(new Error(streamError?.message || 'Assistant stream failed'), { code: streamError?.code, status: streamError?.status })
  }
  if (!done) throw Object.assign(new Error('The assistant stream ended before the answer was complete'), { code: 'stream_incomplete' })
  return { data: done, durationMs: Math.round(performance.now() - started), requestId: response.headers?.get?.('x-request-id') ?? null }
}

export function uploadChatImage(args = {}) {
  if (useMock(args)) return mock('uploadChatImage', args)
  const { file, signal, fetchImpl = fetch } = args
  const body = new FormData()
  body.set('image', file)
  return request(`${API}/chat/image`, { method: 'POST', body, signal }, fetchImpl)
}

export function getChatSession(args = {}) {
  if (useMock(args)) return mock('getChatSession', args)
  const { sessionId, signal, fetchImpl = fetch } = args
  return request(`${API}/chat/sessions/${encodeURIComponent(sessionId)}`, { signal }, fetchImpl)
}

// --- feedback & click events -------------------------------------------------------------

export function sendFeedback(args = {}) {
  if (useMock(args)) return mock('sendFeedback', args)
  const { target, traceId, rating, productId, query, comment, signal, fetchImpl = fetch } = args
  const body = { target, trace_id: traceId, rating }
  if (productId) body.product_id = productId
  if (query) body.query = query
  if (comment && comment.trim()) body.comment = comment.trim()
  return request(`${API}/feedback`, { ...jsonBody(body), signal }, fetchImpl)
}

export function sendClick(args = {}) {
  if (useMock(args)) return mock('sendClick', args)
  const { traceId, productId, rank, signal, fetchImpl = fetch } = args
  return request(`${API}/events/click`, { ...jsonBody({ trace_id: traceId, product_id: productId, rank }), signal, keepalive: true }, fetchImpl)
}

// --- meta -------------------------------------------------------------------------------

// `includeHidden` also lists evaluation-only pipelines (`public: false`), for staff tools.
export function getPipelines(args = {}) {
  if (useMock(args)) return mock('getPipelines', args)
  const { includeHidden = false, signal, fetchImpl = fetch } = args
  return request(`${API}/meta/pipelines${includeHidden ? '?include_hidden=true' : ''}`, { signal }, fetchImpl)
}

export function getEmbeddingMap(args = {}) {
  if (useMock(args)) return mock('getEmbeddingMap', args)
  const { space = 'text', signal, fetchImpl = fetch } = args
  return request(`${API}/meta/embedding-map?space=${encodeURIComponent(space)}`, { signal }, fetchImpl)
}

export function projectEmbedding(args = {}) {
  if (useMock(args)) return mock('projectEmbedding', args)
  const { space = 'text', query, signal, fetchImpl = fetch } = args
  return request(`${API}/meta/embedding-map/project`, { ...jsonBody({ space, query: (query || '').trim() }), signal }, fetchImpl)
}

// --- images -----------------------------------------------------------------------------

const DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif|avif|svg\+xml)[;,]/i

export function resolveImageUrl(imageUrl) {
  if (typeof imageUrl !== 'string') return null
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl
  if (DATA_IMAGE.test(imageUrl)) return imageUrl
  if (/^\/media\/products\/[^/].*/.test(imageUrl) && !imageUrl.includes('..')) return imageUrl
  const prefix = 'data/raw/images/'
  if (!imageUrl.startsWith(prefix)) return null
  const relativePath = imageUrl.slice(prefix.length)
  return relativePath ? `/media/products/${relativePath.split('/').map(encodeURIComponent).join('/')}` : null
}
