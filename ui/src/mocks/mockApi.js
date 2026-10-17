// In-memory mock of the public storefront API (VITE_MOCK_API=1). Same function names and
// return shape ({data, durationMs, requestId}) as src/api.js / src/shared/api/storefront.js.
// Contract: docs/API_CONTRACT.md. State (feedback, clicks, chat sessions) resets on reload.

import { cleanFilters } from '../shared/api/filters.js'
import { PRODUCTS } from './fixtures.js'
import { chatReply, getSession, storeChatImage } from './chatEngine.js'
import { embeddingMap, projectQuery } from './embeddingEngine.js'
import { compareEngine, ragAskEngine } from './ragEngine.js'
import { planEngine } from './planEngine.js'
import {
  CATALOG, facetsEngine, searchComposeEngine, searchImageEngine, searchTextEngine, similarEngine, suggestEngine, understandEngine,
} from './searchEngine.js'
import { productArt, productImages, PRODUCT_COLORS, stockFor } from './storefrontFixtures.js'
import { mockConfigValue } from './adminMock.js'

export let mockDelayMs = 220
export function setMockDelay(ms) {
  mockDelayMs = ms
}

function wait(delayMs, signal) {
  signal?.throwIfAborted()
  if (delayMs <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  }).then(() => signal?.throwIfAborted())
}

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

let requestCounter = 0
async function respond(signal, build, delayMs = mockDelayMs) {
  const started = performance.now()
  await wait(delayMs, signal)
  const data = build()
  requestCounter += 1
  return { data, durationMs: Math.round(performance.now() - started), requestId: `mock-req-${requestCounter}` }
}

function withPrice(product) {
  return product.price ? { ...product.price, synthetic: true } : undefined
}

function toListItem(product) {
  const item = {
    product_id: product.product_id,
    title: product.title,
    brand: product.brand,
    category: product.category,
    image_url: productArt(product),
  }
  if (product.price !== undefined) item.price = withPrice(product)
  return item
}

// --- catalog (existing) -------------------------------------------------------------------

export async function getProducts({ category = [], brand = [], limit = 24, offset = 0, signal } = {}) {
  const started = performance.now()
  signal?.throwIfAborted()
  const cleaned = cleanFilters({ category, brand })
  const categories = cleaned.category ? [cleaned.category].flat() : []
  const brands = cleaned.brand ? [cleaned.brand].flat() : []
  let filtered = PRODUCTS
  if (categories.length > 0) filtered = filtered.filter((p) => categories.includes(p.category))
  if (brands.length > 0) filtered = filtered.filter((p) => brands.includes(p.brand))
  const numLimit = Number(limit ?? 24)
  const numOffset = Number(offset ?? 0)
  return {
    data: { total: filtered.length, items: filtered.slice(numOffset, numOffset + numLimit).map(toListItem) },
    durationMs: Math.round(performance.now() - started),
  }
}

export async function getProduct({ productId, signal } = {}) {
  const started = performance.now()
  signal?.throwIfAborted()
  const product = PRODUCTS.find((p) => p.product_id === productId)
  if (!product) throw httpError(404, 'product_not_found', 'product not found')
  const images = productImages(product)
  const data = {
    product_id: product.product_id,
    title: product.title,
    brand: product.brand,
    category: product.category,
    image_url: images[0] ?? null,
    description: product.description ?? '',
    attributes: Object.fromEntries((product.attributes || []).map((a) => [a.name, a.value])),
    images,
  }
  if (product.price) data.price = withPrice(product)
  if (product.attributes?.length) data.stock = stockFor(product.product_id)
  if (PRODUCT_COLORS[product.product_id]) data.attributes.color_normalized = PRODUCT_COLORS[product.product_id]
  return { data, durationMs: Math.round(performance.now() - started) }
}

export async function getSimilarProducts({ productId, limit = 8, signal } = {}) {
  return respond(signal, () => {
    const body = similarEngine(productId, limit)
    if (!body) throw httpError(404, 'product_not_found', 'product not found')
    return body
  })
}

// --- search -----------------------------------------------------------------------------

export function checkReadiness(signal) {
  return respond(signal, () => ({ status: 'ready', components: { elasticsearch: 'ok', embedder: 'ok', text_embedder: 'ok', llm: 'ok', database: 'ok' } }), 0)
}

// Pipeline name -> the mock engine mode that imitates it (unknown names fall back to hybrid).
const ENGINE_MODES = {
  'search.bm25': 'bm25', 'search.dense': 'dense', 'search.hybrid': 'hybrid', 'search.cross_modal': 'cross_modal',
  'search.adaptive': 'adaptive', 'search.hybrid_rerank': 'hybrid', 'search.dense_siglip': 'cross_modal',
}

// Which pipeline a POST /search/text runs (docs/API_CONTRACT.md "Storefront vs. staff"):
// `pipeline` wins, then `mode` (defaults.mode.*), else the admin default `defaults.search`.
// Filter-only requests always use search.bm25.
export function resolveSearchPipeline({ query = '', mode, pipeline, defaultPipeline = 'search.hybrid' } = {}) {
  if (!String(query || '').trim()) return { pipeline: 'search.bm25', engineMode: 'bm25', mode: mode || 'default' }
  if (pipeline) return { pipeline, engineMode: ENGINE_MODES[pipeline] || 'hybrid', mode: mode || 'pipeline' }
  if (mode) return { pipeline: `search.${mode}`, engineMode: ENGINE_MODES[`search.${mode}`] || 'hybrid', mode }
  return { pipeline: defaultPipeline, engineMode: ENGINE_MODES[defaultPipeline] || 'hybrid', mode: 'default' }
}

export function searchText({ query = '', mode, pipeline, topK = 20, offset = 0, filters = {}, explain = false, signal } = {}) {
  return respond(signal, () => {
    const resolved = resolveSearchPipeline({ query, mode, pipeline, defaultPipeline: mockConfigValue('defaults.search') || 'search.hybrid' })
    const body = searchTextEngine({ query: (query || '').trim(), mode: resolved.engineMode, top_k: topK, offset, filters: cleanFilters(filters), explain })
    body.mode = resolved.mode
    body.pipeline = resolved.pipeline
    if (body.trace) body.trace = { ...body.trace, pipeline: resolved.pipeline, input: { ...body.trace.input, mode: resolved.mode, pipeline: resolved.pipeline } }
    return body
  })
}

export function searchImage({ file, topK = 20, offset = 0, filters = {}, explain = false, signal } = {}) {
  return respond(signal, () => {
    if (!file) throw httpError(422, 'validation_error', 'image is required')
    return searchImageEngine({ file, top_k: topK, offset, filters: cleanFilters(filters), explain })
  }, mockDelayMs + 150)
}

export function searchCompose({ file, text = '', alpha, topK = 20, explain = false, signal } = {}) {
  return respond(signal, () => {
    if (!file) throw httpError(422, 'validation_error', 'image is required')
    if (!text.trim()) throw httpError(422, 'validation_error', 'text is required')
    return searchComposeEngine({ file, text: text.trim(), alpha, top_k: topK, explain })
  }, mockDelayMs + 150)
}

export function searchSuggest({ q = '', limit = 8, signal } = {}) {
  return respond(signal, () => suggestEngine(q, limit), Math.min(mockDelayMs, 90))
}

export function getFacets({ query = '', filters = {}, signal } = {}) {
  return respond(signal, () => facetsEngine({ query, filters: cleanFilters(filters) }), Math.min(mockDelayMs, 120))
}

export function understandQuery({ query = '', signal } = {}) {
  return respond(signal, () => understandEngine(query))
}

export function getFilterOptions({ field, prefix = '', limit = 20, signal } = {}) {
  return respond(signal, () => {
    const values = field === 'brand' ? CATALOG.brands : field === 'category' ? CATALOG.categories : field === 'product_id' ? PRODUCTS.map((p) => p.product_id) : null
    if (!values) throw httpError(422, 'validation_error', `unsupported field '${field}'`)
    const needle = prefix.trim().toLowerCase()
    return { field, options: values.filter((v) => !needle || v.toLowerCase().includes(needle)).slice(0, limit) }
  }, Math.min(mockDelayMs, 80))
}

// --- RAG ----------------------------------------------------------------------------------

export async function askProduct({ question = '', productId, sources = ['product'], explain = false, signal, delayMs = 600 } = {}) {
  const started = performance.now()
  signal?.throwIfAborted()
  await wait(delayMs, signal)
  if (productId && !PRODUCTS.some((p) => p.product_id === productId)) throw httpError(404, 'product_not_found', 'product not found')
  if (question.toLowerCase().includes('error')) throw new Error('Mock assistant error')
  return { data: ragAskEngine({ question, product_id: productId, sources, explain }), durationMs: Math.round(performance.now() - started) }
}

export function ragCompare({ productIds = [], question = '', explain = false, signal } = {}) {
  return respond(signal, () => {
    if (productIds.length < 2 || productIds.length > 3) throw httpError(422, 'validation_error', 'product_ids must contain 2 or 3 ids')
    return compareEngine({ product_ids: productIds, question, explain })
  }, mockDelayMs + 500)
}

// F6 shopping planner: works without an LLM (method "rules"), like the backend.
export function ragPlan({ request = '', budget, language, maxNeeds, explain = false, signal } = {}) {
  return respond(signal, () => planEngine({ request, budget, language, max_needs: maxNeeds, explain }), mockDelayMs + 450)
}

// --- chat ---------------------------------------------------------------------------------

function chatBody({ message = '', history = [], productId, sessionId, imageToken, explain = false }) {
  return { message, history, product_id: productId, session_id: sessionId, image_token: imageToken, explain }
}

export function chat({ signal, ...args } = {}) {
  return respond(signal, () => chatReply(chatBody(args)).payload, mockDelayMs + 400)
}

// Emits the SSE events one by one through `onEvent({event, data})`, resolves with the `done` payload.
export async function chatStream({ signal, onEvent, eventDelayMs, ...args } = {}) {
  const started = performance.now()
  signal?.throwIfAborted()
  const { events, payload } = chatReply(chatBody(args))
  const pace = eventDelayMs ?? Math.max(0, Math.round(mockDelayMs / 3))
  for (const evt of events) {
    await wait(evt.event === 'delta' ? Math.round(pace / 4) : evt.event === 'step' && evt.data.status === 'started' ? pace : Math.round(pace / 3), signal)
    onEvent?.(evt)
  }
  return { data: payload, durationMs: Math.round(performance.now() - started) }
}

export function uploadChatImage({ file, signal } = {}) {
  return respond(signal, () => {
    if (!file) throw httpError(422, 'validation_error', 'image is required')
    return storeChatImage(file)
  })
}

export function getChatSession({ sessionId, signal } = {}) {
  return respond(signal, () => {
    const session = getSession(sessionId)
    if (!session) throw httpError(404, 'session_not_found', 'session not found')
    return session
  }, Math.min(mockDelayMs, 100))
}

// --- feedback & events --------------------------------------------------------------------

const recorded = { feedback: [], clicks: [] }
export function getRecordedEvents() {
  return recorded
}

export function sendFeedback({ target, traceId, rating, productId, query, comment, signal } = {}) {
  return respond(signal, () => {
    if (!['search', 'answer'].includes(target) || ![1, -1].includes(rating)) throw httpError(422, 'validation_error', 'invalid feedback')
    const id = `fb_mock_${recorded.feedback.length + 1}`
    recorded.feedback.push({ id, target, trace_id: traceId, rating, product_id: productId ?? null, query: query ?? null, comment: comment ?? null })
    return { id }
  }, Math.min(mockDelayMs, 120))
}

export function sendClick({ traceId, productId, rank, signal } = {}) {
  return respond(signal, () => {
    recorded.clicks.push({ trace_id: traceId, product_id: productId, rank })
    return null
  }, 0)
}

// --- meta ---------------------------------------------------------------------------------

const UNDERSTAND = { id: 'understand', step: 'query_understanding', impl: 'rules' }
const LEXICAL = { id: 'lexical', step: 'retrieve', impl: 'bm25' }
const SEMANTIC = { id: 'semantic', step: 'retrieve', impl: 'knn' }

// `public: false` pipelines are evaluation-only; GET /meta/pipelines lists them with include_hidden=true.
export const MOCK_PIPELINES = {
  pipelines: [
    { name: 'search.hybrid', kind: 'search', public: true, description: 'BM25 + dense (E5) fused with RRF, then attribute rerank', steps: [
      UNDERSTAND, LEXICAL, SEMANTIC, { id: 'fuse', step: 'fuse', impl: 'rrf' }, { id: 'rerank', step: 'rerank', impl: 'attribute_boost' }] },
    { name: 'search.bm25', kind: 'search', public: true, description: 'Exact-term BM25 over title, brand, category, colour, description', steps: [UNDERSTAND, LEXICAL] },
    { name: 'search.dense', kind: 'search', public: true, description: 'Multilingual E5 text embedding, kNN on text_vector', steps: [UNDERSTAND, SEMANTIC] },
    { name: 'search.cross_modal', kind: 'search', public: true, description: 'SigLIP2 text embedding searched against image_vector', steps: [UNDERSTAND, SEMANTIC] },
    { name: 'search.adaptive', kind: 'search', public: true, description: 'Rule router: identifier -> BM25, descriptive -> dense, mixed -> hybrid', steps: [UNDERSTAND, LEXICAL, SEMANTIC] },
    { name: 'search.hybrid_rerank', kind: 'search', public: false, description: 'Hybrid RRF followed by a cross-encoder on the top 50 (evaluation only)', steps: [
      UNDERSTAND, LEXICAL, SEMANTIC, { id: 'fuse', step: 'fuse', impl: 'rrf' }, { id: 'rerank', step: 'rerank', impl: 'cross_encoder' }] },
    { name: 'search.dense_siglip', kind: 'search', public: false, description: 'Old SigLIP text tower on text_vector (evaluation baseline)', steps: [UNDERSTAND, SEMANTIC] },
    { name: 'search.image', kind: 'image_search', public: true, description: 'SigLIP2 image embedding, kNN on image_vector', steps: [{ id: 'image_knn', step: 'retrieve', impl: 'knn' }] },
    { name: 'search.compose', kind: 'compose_search', public: true, description: 'q = normalize(α·image + (1−α)·text) on image_vector', steps: [
      UNDERSTAND, { id: 'compose', step: 'compose_query', impl: 'weighted_sum' }, { id: 'image_knn', step: 'retrieve', impl: 'knn' }] },
    { name: 'rag.ask', kind: 'rag', public: true, description: 'Multi-source retrieve, RRF, budgeted context, LLM with citation validation', steps: [
      { id: 'retrieve', step: 'multi_source_retrieve', impl: 'multi_source' }, { id: 'fuse', step: 'fuse', impl: 'rrf' }, { id: 'context', step: 'build_context', impl: 'budgeted' },
      { id: 'generate', step: 'generate', impl: 'openai_responses' }, { id: 'citations', step: 'validate_citations', impl: 'exact_context' }] },
    { name: 'rag.plan', kind: 'rag', public: true, description: 'F6 shopping planner: decompose -> retrieve per need -> budget optimizer -> cited justification', steps: [
      { id: 'decompose', step: 'decompose', impl: 'rules' }, { id: 'needs', step: 'retrieve', impl: 'per_need' }, { id: 'budget', step: 'optimize_budget', impl: 'greedy' },
      { id: 'context', step: 'build_context', impl: 'budgeted' }, { id: 'justify', step: 'justify', impl: 'extractive' }] },
  ],
  defaults: { search: 'search.hybrid', rag: 'rag.ask' },
}

export function getPipelines({ includeHidden = false, signal } = {}) {
  return respond(signal, () => ({
    pipelines: MOCK_PIPELINES.pipelines.filter((p) => includeHidden || p.public !== false),
    defaults: { ...MOCK_PIPELINES.defaults, search: mockConfigValue('defaults.search') || MOCK_PIPELINES.defaults.search },
  }), Math.min(mockDelayMs, 80))
}

export function getEmbeddingMap({ space = 'text', signal } = {}) {
  return respond(signal, () => embeddingMap(space), mockDelayMs + 200)
}

export function projectEmbedding({ space = 'text', query = '', signal } = {}) {
  return respond(signal, () => projectQuery({ space, query }))
}
