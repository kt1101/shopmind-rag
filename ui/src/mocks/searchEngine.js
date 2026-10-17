// Deterministic in-memory search engine for the storefront mock (VITE_MOCK_API=1).
// It mimics the backend pipelines closely enough that every Inspector view has real data:
// query_understanding (aliases, adaptive mode, filter resolution) -> lexical BM25-ish retrieve
// (matched_terms + ES query DSL) -> dense retrieve (query_vector dims/norm) -> RRF fuse
// (contributions + formula) -> rerank (before/after). Pure functions, no timers.

import { PRODUCTS } from './fixtures.js'
import { ALIASES, CATEGORY_LABELS_VI, PRODUCT_COLORS, STOPWORDS, WORD_MAP, productArt } from './storefrontFixtures.js'

export const RRF_K = 60
export const CANDIDATE_K = 100
export const TRACE_ITEM_CAP = 20
const DENSE_MIN_SCORE = 0.45

const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits

export function hash(text) {
  let h = 0x811c9dc5
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

// Deterministic noise in [-1, 1).
function noise(...parts) {
  return (hash(parts.join('|')) / 2 ** 32) * 2 - 1
}

let traceCounter = 0
export function newTraceId(seed = '') {
  traceCounter += 1
  return `tr_${hash(`${seed}|${traceCounter}`).toString(16).padStart(8, '0')}${traceCounter.toString(36)}`
}

export function stem(token) {
  if (token.length > 4 && token.endsWith('es') && /(sh|ch|x|s)es$/.test(token)) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

export function tokenize(text) {
  return (String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).map(stem)
}

export function detectLanguage(query) {
  return /[ăâđêôơưàáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹấầẩẫậắằẳẵặếềểễệốồổỗộớờởỡợứừửữự]/i.test(query || '') ? 'vi' : 'en'
}

// --- catalog index -----------------------------------------------------------------------

export function attributeValue(product, name) {
  return (product.attributes || []).find((attr) => attr.name.toLowerCase() === name.toLowerCase())?.value ?? null
}

const DOCS = PRODUCTS.map((product) => ({
  product,
  color: PRODUCT_COLORS[product.product_id] || null,
  fields: {
    title: tokenize(product.title),
    brand: tokenize(product.brand),
    category: tokenize((product.category || '').replaceAll('_', ' ')),
    color: [...new Set([...tokenize(PRODUCT_COLORS[product.product_id] || ''), ...tokenize(attributeValue(product, 'Color') || '')])],
    description: tokenize(`${product.description || ''} ${(product.attributes || []).map((a) => `${a.name} ${a.value}`).join(' ')}`),
  },
}))

const FIELD_BOOST = { title: 3, brand: 2, category: 2, color: 1.5, description: 1 }
const DOC_FREQ = new Map()
for (const doc of DOCS) {
  for (const term of new Set(Object.values(doc.fields).flat())) DOC_FREQ.set(term, (DOC_FREQ.get(term) || 0) + 1)
}
function idf(term) {
  const df = DOC_FREQ.get(term) || 0
  return Math.log(1 + (DOCS.length - df + 0.5) / (df + 0.5))
}

export const CATALOG = {
  brands: [...new Set(PRODUCTS.map((p) => p.brand))].sort(),
  categories: [...new Set(PRODUCTS.map((p) => p.category))].sort(),
  colors: [...new Set(Object.values(PRODUCT_COLORS).filter(Boolean))].sort(),
}

export function toResult(product, rank, score) {
  return {
    product_id: product.product_id,
    title: product.title,
    image_url: productArt(product),
    brand: product.brand,
    category: product.category,
    score: round(score),
    rank,
  }
}

// --- query understanding -----------------------------------------------------------------

function asList(value) {
  if (value == null) return []
  return (Array.isArray(value) ? value : [value]).map((v) => String(v).trim()).filter(Boolean)
}

// Exact catalog match first; substring/prefix fallback only for values absent from the catalog.
export function resolveFilters(filters = {}) {
  const fields = { brand: CATALOG.brands, category: CATALOG.categories, color: CATALOG.colors, product_id: PRODUCTS.map((p) => p.product_id) }
  const resolved = {}
  for (const [field, catalog] of Object.entries(fields)) {
    const requested = asList(filters[field])
    if (!requested.length) continue
    const values = []
    let match = 'exact'
    for (const value of requested) {
      if (catalog.includes(value)) {
        values.push(value)
        continue
      }
      match = 'fallback'
      const needle = value.toLowerCase()
      values.push(...catalog.filter((c) => c.toLowerCase().startsWith(needle) || c.toLowerCase().includes(needle)))
    }
    resolved[field] = { requested, resolved: [...new Set(values)], match }
  }
  return resolved
}

export function understandQuery(query = '', { mode = 'hybrid', filters = {} } = {}) {
  const original = String(query || '').toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim()
  let rest = ` ${original} `
  const aliases = []
  const terms = []
  const derived = { category: [], color: [] }
  for (const alias of [...ALIASES].sort((a, b) => b.from.length - a.from.length)) {
    const needle = ` ${alias.from} `
    if (!rest.includes(needle)) continue
    rest = rest.replace(needle, ' ')
    aliases.push({ from: alias.from, to: alias.to, kind: alias.kind })
    terms.push(...alias.terms)
    if (!derived[alias.kind].includes(alias.to)) derived[alias.kind].push(alias.to)
  }
  for (const [phrase, mapped] of Object.entries(WORD_MAP)) {
    if (phrase.includes(' ') && rest.includes(` ${phrase} `)) rest = rest.replace(` ${phrase} `, ` ${mapped} `)
  }
  for (const word of rest.split(/\s+/).filter(Boolean)) {
    const mapped = Object.prototype.hasOwnProperty.call(WORD_MAP, word) ? WORD_MAP[word] : word
    for (const token of tokenize(mapped)) if (!STOPWORDS.has(token)) terms.push(token)
  }
  const uniqueTerms = [...new Set(terms)]
  const language = detectLanguage(query)
  let adaptive
  let effectiveMode = mode
  if (mode === 'adaptive') {
    const idLike = /^[a-z]{1,3}-?\d{2,}$/i.test(original)
    if (idLike) adaptive = { mode: 'bm25', reason: 'identifier-like query (looks like a product id) -> exact-term BM25' }
    else if (uniqueTerms.length >= 3) adaptive = { mode: 'dense', reason: `descriptive query (${uniqueTerms.length} content terms) -> dense retrieval` }
    else adaptive = { mode: 'hybrid', reason: 'short mixed query -> hybrid BM25 + dense with RRF' }
    effectiveMode = adaptive.mode
  }
  return {
    language,
    normalized_query: uniqueTerms.join(' '),
    terms: uniqueTerms,
    aliases,
    derived,
    adaptive,
    effectiveMode,
    filters: resolveFilters(filters),
  }
}

function passesFilters(doc, resolved) {
  for (const [field, entry] of Object.entries(resolved)) {
    const allowed = entry.resolved
    const value = field === 'color' ? doc.color : doc.product[field]
    if (!allowed.includes(value)) return false
  }
  return true
}

// --- retrievers --------------------------------------------------------------------------

export function lexicalRetrieve(understanding, resolved, candidateK = CANDIDATE_K) {
  const scored = []
  for (const doc of DOCS) {
    if (!passesFilters(doc, resolved)) continue
    let score = 0
    const matched = {}
    for (const term of understanding.terms) {
      for (const [field, tokens] of Object.entries(doc.fields)) {
        const tf = tokens.filter((t) => t === term).length
        if (!tf) continue
        score += FIELD_BOOST[field] * idf(term) * ((tf * 2.2) / (tf + 1.2))
        matched[field] = matched[field] || []
        if (!matched[field].includes(term)) matched[field].push(term)
      }
    }
    if (score > 0) scored.push({ doc, score, matched })
  }
  scored.sort((a, b) => b.score - a.score || a.doc.product.product_id.localeCompare(b.doc.product.product_id))
  return scored.slice(0, candidateK).map((item, index) => ({ ...item, rank: index + 1, score: round(item.score, 3) }))
}

function conceptSimilarity(doc, understanding, { categoryWeight = 0.25, colorWeight = 0.12, overlapWeight = 0.35 } = {}) {
  const { derived, terms } = understanding
  const allTokens = new Set(Object.values(doc.fields).flat())
  const overlap = terms.length ? terms.filter((t) => allTokens.has(t)).length / terms.length : 0
  return (derived.category.includes(doc.product.category) ? categoryWeight : 0)
    + (doc.color && derived.color.includes(doc.color) ? colorWeight : 0)
    + overlapWeight * overlap
}

export function denseRetrieve(understanding, resolved, { field = 'text_vector', candidateK = CANDIDATE_K, query = '' } = {}) {
  const crossModal = field === 'image_vector'
  const scored = []
  for (const doc of DOCS) {
    if (!passesFilters(doc, resolved)) continue
    const sim = 0.3 + conceptSimilarity(doc, understanding, crossModal ? { categoryWeight: 0.16, colorWeight: 0.22, overlapWeight: 0.25 } : undefined)
      + 0.04 * noise(query, field, doc.product.product_id)
    if (sim >= DENSE_MIN_SCORE) scored.push({ doc, score: sim })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, candidateK).map((item, index) => ({ ...item, rank: index + 1, score: round(item.score) }))
}

export function rrfFuse(rankings, k = RRF_K) {
  const byId = new Map()
  for (const [rankingId, list] of Object.entries(rankings)) {
    for (const item of list) {
      const id = item.doc.product.product_id
      const entry = byId.get(id) || { doc: item.doc, score: 0, contributions: {}, terms: [] }
      const contribution = 1 / (k + item.rank)
      entry.score += contribution
      entry.contributions[rankingId] = { rank: item.rank, score: round(contribution) }
      entry.terms.push(`1/(${k}+${item.rank})`)
      byId.set(id, entry)
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.score - a.score || a.doc.product.product_id.localeCompare(b.doc.product.product_id))
    .map((entry, index) => ({ ...entry, rank: index + 1, score: round(entry.score), formula: entry.terms.join(' + ') }))
}

export function rerank(items, understanding, limit = 20) {
  const head = items.slice(0, limit)
  const max = Math.max(...head.map((i) => i.score), 1e-9)
  const rescored = head.map((item) => {
    const bonus = conceptSimilarity(item.doc, understanding, { categoryWeight: 0.2, colorWeight: 0.15, overlapWeight: 0.1 })
    return { ...item, before_rank: item.rank, reranker_score: round(0.6 * (item.score / max) + bonus) }
  })
  rescored.sort((a, b) => b.reranker_score - a.reranker_score || a.before_rank - b.before_rank)
  const reranked = rescored.map((item, index) => ({ ...item, after_rank: index + 1 }))
  const tail = items.slice(limit).map((item, index) => ({ ...item, before_rank: item.rank, after_rank: limit + index + 1, reranker_score: null }))
  return [...reranked, ...tail]
}

// --- trace helpers -----------------------------------------------------------------------

function stepItems(list, detailsFn = () => undefined) {
  return list.slice(0, TRACE_ITEM_CAP).map((item) => {
    const details = detailsFn(item)
    return {
      id: item.doc.product.product_id,
      rank: item.rank,
      score: item.score,
      title: item.doc.product.title,
      ...(details ? { details } : {}),
    }
  })
}

function timer(seed) {
  let clock = 0
  return {
    step(minMs, maxMs, { parallelWith } = {}) {
      const started = parallelWith ?? clock
      const duration = round(minMs + ((noise(seed, minMs, started) + 1) / 2) * (maxMs - minMs), 1)
      clock = Math.max(clock, started + duration)
      return { started_ms: round(started, 1), duration_ms: duration }
    },
    advance(ms) { clock = round(clock + ms, 1) },
    now() { return clock },
  }
}

export function buildQueryDsl(understanding, resolved, size) {
  const filter = Object.entries(resolved).map(([field, entry]) => ({ terms: { [field === 'product_id' ? 'product_id' : `${field}.keyword`]: entry.resolved } }))
  return {
    size,
    _source: ['product_id', 'title', 'brand', 'category', 'image_url'],
    query: {
      bool: {
        must: [{
          multi_match: {
            query: understanding.normalized_query,
            fields: ['title^3', 'brand^2', 'category^2', 'color^1.5', 'description'],
            type: 'best_fields',
            operator: 'or',
          },
        }],
        ...(filter.length ? { filter } : {}),
      },
    },
    highlight: { fields: { title: {}, description: { fragment_size: 120 }, brand: {}, category: {}, color: {} }, pre_tags: ['<em>'], post_tags: ['</em>'] },
  }
}

function understandingStep(understanding, clock, query) {
  const notes = understanding.aliases.map((a) => `alias '${a.from}' -> ${a.kind} '${a.to}'`)
  if (understanding.adaptive) notes.push(`adaptive chose ${understanding.adaptive.mode}: ${understanding.adaptive.reason}`)
  return {
    id: 'understand',
    step: 'query_understanding',
    impl: 'rules',
    params: { vocab: 'data/vocab/aliases.yaml' },
    ...clock.step(0.4, 1.1),
    summary: `${understanding.language} query, ${understanding.aliases.length} alias(es), ${understanding.terms.length} terms`,
    notes,
    details: {
      language: understanding.language,
      normalized_query: understanding.normalized_query,
      original_query: query,
      aliases: understanding.aliases,
      ...(understanding.adaptive ? { adaptive: understanding.adaptive } : {}),
      filters: understanding.filters,
    },
  }
}

const EMBEDDERS = {
  text_vector: 'intfloat/multilingual-e5-base',
  image_vector: 'google/siglip2-base-patch16-224',
}

// Full text search: returns the POST /search/text response body (trace included when `explain`).
export function searchTextEngine({ query = '', mode = 'hybrid', top_k: topK = 20, offset = 0, filters = {}, explain = false } = {}) {
  const understanding = understandQuery(query, { mode, filters })
  const resolved = understanding.filters
  const effective = understanding.effectiveMode
  const clock = timer(`${query}|${mode}`)
  const steps = [understandingStep(understanding, clock, query)]
  clock.advance(0.3)
  const filterOnly = understanding.terms.length === 0
  let final

  if (filterOnly) {
    const docs = DOCS.filter((doc) => passesFilters(doc, resolved))
    final = docs.map((doc, index) => ({ doc, rank: index + 1, score: 1 }))
    steps.push({
      id: 'filter', step: 'filter', impl: 'catalog_filter', params: {}, ...clock.step(2, 5),
      summary: `${docs.length} products match the filters`, notes: ['empty query: filter-only browse'],
      output: { items: stepItems(final), total: docs.length },
    })
  } else {
    const parallelStart = clock.now()
    let lexical = null
    let semantic = null
    if (effective === 'bm25' || effective === 'hybrid') {
      lexical = lexicalRetrieve(understanding, resolved)
      steps.push({
        id: 'lexical', step: 'retrieve', impl: 'bm25', params: { candidate_k: CANDIDATE_K, index: 'products' },
        ...clock.step(9, 24, { parallelWith: parallelStart }),
        summary: `${lexical.length} candidates from BM25`,
        notes: Object.keys(resolved).length ? [`filters applied as ES bool.filter on ${Object.keys(resolved).join(', ')}`] : [],
        details: { query_dsl: buildQueryDsl(understanding, resolved, CANDIDATE_K) },
        output: { items: stepItems(lexical, (item) => ({ matched_terms: item.matched })), total: lexical.length },
      })
    }
    if (effective === 'dense' || effective === 'hybrid' || effective === 'cross_modal') {
      const field = effective === 'cross_modal' ? 'image_vector' : 'text_vector'
      semantic = denseRetrieve(understanding, resolved, { field, query })
      steps.push({
        id: 'semantic', step: 'retrieve', impl: 'knn', params: { field, k: CANDIDATE_K, num_candidates: 200, min_score: DENSE_MIN_SCORE },
        ...clock.step(18, 34, { parallelWith: parallelStart }),
        summary: `${semantic.length} candidates from kNN on ${field}`,
        notes: [`query embedded with ${EMBEDDERS[field]}`],
        details: { field, embedder: EMBEDDERS[field], query_vector: { dims: 768, norm: 1.0 } },
        output: { items: stepItems(semantic), total: semantic.length },
      })
    }
    if (lexical && semantic) {
      clock.advance(0.2)
      const fused = rrfFuse({ lexical, semantic })
      steps.push({
        id: 'fuse', step: 'fuse', impl: 'rrf', params: { k: RRF_K },
        ...clock.step(0.2, 0.7),
        summary: `RRF over 2 rankings -> ${fused.length} unique products`,
        output: { items: stepItems(fused, (item) => ({ contributions: item.contributions, formula: item.formula })), total: fused.length },
      })
      clock.advance(0.2)
      const reranked = rerank(fused, understanding)
      final = reranked.map((item) => ({ ...item, rank: item.after_rank, score: item.reranker_score ?? item.score }))
      steps.push({
        id: 'rerank', step: 'rerank', impl: 'attribute_boost', params: { top_n: 20, weights: { fused: 0.6, category: 0.2, color: 0.15, terms: 0.1 } },
        ...clock.step(6, 12),
        summary: `re-scored top ${Math.min(20, fused.length)} with attribute matches`,
        output: {
          items: final.slice(0, TRACE_ITEM_CAP).map((item) => ({
            id: item.doc.product.product_id, rank: item.after_rank, score: item.reranker_score ?? item.score, title: item.doc.product.title,
            details: { before_rank: item.before_rank, after_rank: item.after_rank, reranker_score: item.reranker_score },
          })),
          total: final.length,
        },
      })
    } else {
      final = lexical || semantic || []
    }
  }

  const page = final.slice(offset, offset + topK)
  const results = page.map((item, index) => toResult(item.doc.product, offset + index + 1, item.score))
  const traceId = newTraceId(query)
  const body = {
    query,
    mode,
    filter_only: filterOnly,
    results,
    trace_id: traceId,
  }
  if (understanding.derived.category.length || understanding.derived.color.length) {
    body.understood = {
      filters: Object.fromEntries(Object.entries(understanding.derived).filter(([, values]) => values.length)),
      rewritten_query: understanding.normalized_query,
      intent: 'product_search',
    }
  }
  if (explain) {
    body.trace = {
      trace_id: traceId,
      pipeline: `search.${effective}`,
      kind: 'search',
      created_at: new Date().toISOString(),
      duration_ms: round(clock.now() + 0.8, 1),
      input: { query, filters, mode, top_k: topK },
      steps,
      output: { result_ids: results.map((r) => r.product_id) },
    }
  }
  return body
}

// --- image + compose -----------------------------------------------------------------------

// Pick the "uploaded" product deterministically: a fixture id in the file name wins
// (e.g. M-007.png), then category words, otherwise a hash of name + size.
export function seedProductForFile(file) {
  const name = String(file?.name || '').toLowerCase()
  const byId = PRODUCTS.find((p) => name.includes(p.product_id.toLowerCase()))
  if (byId) return byId
  const words = [['boot', 'hiking_boots'], ['shoe', 'running_shoes'], ['run', 'running_shoes'], ['pack', 'backpacks'], ['bag', 'backpacks'], ['jacket', 'jackets']]
  const hit = words.find(([word]) => name.includes(word))
  const pool = hit ? PRODUCTS.filter((p) => p.category === hit[1]) : PRODUCTS
  return pool[hash(`${name}|${file?.size ?? 0}`) % pool.length]
}

function imageSimilarity(seed, doc) {
  if (doc.product.product_id === seed.product_id) return 0.97
  const sameCategory = doc.product.category === seed.category
  const sameColor = doc.color && doc.color === PRODUCT_COLORS[seed.product_id]
  return 0.42 + (sameCategory ? 0.3 : 0) + (sameColor ? 0.12 : 0) + 0.05 * noise(seed.product_id, doc.product.product_id)
}

function imageStep(clock, field, list, summary) {
  return {
    id: 'image_knn', step: 'retrieve', impl: 'knn', params: { field, k: CANDIDATE_K, num_candidates: 200 },
    ...clock.step(20, 38),
    summary,
    notes: ['image bytes are never stored; only the embedding dims/norm are traced'],
    details: { field, embedder: EMBEDDERS.image_vector, query_vector: { dims: 768, norm: 1.0 } },
    output: { items: stepItems(list), total: list.length },
  }
}

export function searchImageEngine({ file, top_k: topK = 20, offset = 0, filters = {}, explain = false } = {}) {
  const seed = seedProductForFile(file)
  const resolved = resolveFilters(filters)
  const clock = timer(`img|${seed.product_id}`)
  const ranked = DOCS.filter((doc) => passesFilters(doc, resolved))
    .map((doc) => ({ doc, score: imageSimilarity(seed, doc) }))
    .sort((a, b) => b.score - a.score)
    .map((item, index) => ({ ...item, rank: index + 1, score: round(item.score) }))
  const steps = [imageStep(clock, 'image_vector', ranked, `${ranked.length} visually similar products`)]
  const results = ranked.slice(offset, offset + topK).map((item, index) => toResult(item.doc.product, offset + index + 1, item.score))
  const traceId = newTraceId(`img|${seed.product_id}`)
  const body = { mode: 'image_dense', results, trace_id: traceId }
  if (explain) {
    body.trace = {
      trace_id: traceId, pipeline: 'search.image', kind: 'image_search', created_at: new Date().toISOString(),
      duration_ms: round(clock.now() + 0.6, 1),
      input: { image: { name: file?.name || 'upload', bytes: file?.size ?? null }, filters },
      steps,
      output: { result_ids: results.map((r) => r.product_id) },
    }
  }
  return body
}

export const DEFAULT_ALPHA = 0.6

export function searchComposeEngine({ file, text = '', alpha = DEFAULT_ALPHA, top_k: topK = 20, explain = false } = {}) {
  const a = Math.min(1, Math.max(0, Number.isFinite(Number(alpha)) ? Number(alpha) : DEFAULT_ALPHA))
  const seed = seedProductForFile(file)
  const understanding = understandQuery(text)
  const clock = timer(`compose|${seed.product_id}|${text}|${a}`)
  const steps = [understandingStep(understanding, clock, text)]
  const textSim = (doc) => 0.3 + conceptSimilarity(doc, understanding, { categoryWeight: 0.2, colorWeight: 0.35, overlapWeight: 0.25 })
  steps.push({
    id: 'compose', step: 'compose_query', impl: 'weighted_sum', params: { alpha: round(a, 2), beta: round(1 - a, 2) },
    ...clock.step(14, 26),
    summary: `q = normalize(${round(a, 2)}·e_img + ${round(1 - a, 2)}·e_text)`,
    notes: [`image embedded with ${EMBEDDERS.image_vector}`, `text "${text}" embedded with the same SigLIP2 text tower`],
    details: {
      alpha: round(a, 2),
      formula: 'q = normalize(α·e_img + (1−α)·e_text)',
      image_vector: { dims: 768, norm: 1.0 },
      text_vector: { dims: 768, norm: 1.0 },
      query_vector: { dims: 768, norm: 1.0 },
      seed_hint: seed.product_id,
    },
  })
  const ranked = DOCS.map((doc) => ({ doc, score: a * imageSimilarity(seed, doc) + (1 - a) * textSim(doc) }))
    .sort((x, y) => y.score - x.score)
    .map((item, index) => ({ ...item, rank: index + 1, score: round(item.score) }))
  steps.push(imageStep(clock, 'image_vector', ranked, `${ranked.length} candidates for the composed query`))
  const results = ranked.slice(0, topK).map((item, index) => toResult(item.doc.product, index + 1, item.score))
  const traceId = newTraceId(`compose|${text}`)
  const body = { results, alpha: round(a, 2), trace_id: traceId }
  if (explain) {
    body.trace = {
      trace_id: traceId, pipeline: 'search.compose', kind: 'compose_search', created_at: new Date().toISOString(),
      duration_ms: round(clock.now() + 0.6, 1),
      input: { query: text, image: { name: file?.name || 'upload', bytes: file?.size ?? null }, alpha: round(a, 2) },
      steps,
      output: { result_ids: results.map((r) => r.product_id) },
    }
  }
  return body
}

// --- suggest, facets, understand, similar ------------------------------------------------

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]
}

const VOCAB = [...DOC_FREQ.keys()].filter((t) => t.length >= 3 && !/^\d+$/.test(t))

export function suggestEngine(q = '', limit = 8) {
  const needle = String(q).toLowerCase().trim()
  if (!needle) return { suggestions: [] }
  const out = []
  const push = (s) => {
    if (out.length < limit && !out.some((o) => o.type === s.type && o.value === s.value)) out.push(s)
  }
  for (const category of CATALOG.categories) {
    const labels = [category.replaceAll('_', ' '), CATEGORY_LABELS_VI[category] || ''].map((l) => l.toLowerCase())
    const aliasHit = ALIASES.some((a) => a.kind === 'category' && a.to === category && a.from.startsWith(needle))
    if (aliasHit || labels.some((l) => l.startsWith(needle) || l.split(' ').some((w) => w.startsWith(needle)))) {
      push({ type: 'category', value: category, label: CATEGORY_LABELS_VI[category] || category })
    }
  }
  for (const brand of CATALOG.brands) {
    if (brand.toLowerCase().startsWith(needle)) push({ type: 'brand', value: brand, label: brand })
  }
  const words = needle.split(/\s+/)
  for (const product of PRODUCTS) {
    const title = product.title.toLowerCase()
    if (words.every((w) => title.includes(w))) {
      push({ type: 'product', value: product.title, label: product.title, product_id: product.product_id, image_url: productArt(product) })
    }
  }
  if (!out.length) {
    // Typo tolerance: correct each token to the closest vocabulary word (edit distance <= 2).
    const corrected = tokenize(needle).map((token) => {
      let best = null
      for (const word of VOCAB) {
        const d = levenshtein(token, word)
        if (d <= 2 && (!best || d < best.d)) best = { word, d }
      }
      return best?.word
    }).filter(Boolean)
    if (corrected.length) {
      for (const doc of DOCS) {
        const tokens = new Set(Object.values(doc.fields).flat())
        if (corrected.every((w) => tokens.has(w))) {
          push({ type: 'product', value: doc.product.title, label: doc.product.title, product_id: doc.product.product_id, image_url: productArt(doc.product) })
        }
      }
    }
  }
  return { suggestions: out }
}

export function facetsEngine({ query = '', filters = {} } = {}) {
  let base = DOCS
  if (String(query || '').trim()) {
    const understanding = understandQuery(query)
    const ids = new Set([
      ...lexicalRetrieve(understanding, {}).map((i) => i.doc.product.product_id),
      ...denseRetrieve(understanding, {}, { query }).map((i) => i.doc.product.product_id),
    ])
    base = DOCS.filter((doc) => ids.has(doc.product.product_id))
  }
  const facetFields = ['brand', 'category', 'color']
  const facets = {}
  for (const field of facetFields) {
    // Disjunctive faceting: counts honour every filter except the field's own.
    const others = resolveFilters(Object.fromEntries(Object.entries(filters).filter(([key]) => key !== field)))
    const counts = new Map()
    for (const doc of base) {
      if (!passesFilters(doc, others)) continue
      const value = field === 'color' ? doc.color : doc.product[field]
      if (value) counts.set(value, (counts.get(value) || 0) + 1)
    }
    facets[field] = [...counts.entries()].map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
  }
  return { facets }
}

export function understandEngine(query = '') {
  const understanding = understandQuery(query)
  const filters = Object.fromEntries(Object.entries(understanding.derived).filter(([, values]) => values.length))
  for (const brand of CATALOG.brands) {
    if (String(query).toLowerCase().includes(brand.toLowerCase())) (filters.brand ||= []).push(brand)
  }
  return { query, filters, rewritten_query: understanding.normalized_query, intent: 'product_search', method: 'rules' }
}

export function similarEngine(productId, limit = 8) {
  const seed = PRODUCTS.find((p) => p.product_id === productId)
  if (!seed) return null
  const items = DOCS.filter((doc) => doc.product.product_id !== productId)
    .map((doc) => ({ doc, score: imageSimilarity(seed, doc) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item, index) => toResult(item.doc.product, index + 1, item.score))
  return { product_id: productId, items }
}
