// Mock A3 RAG pipeline (VITE_MOCK_API=1): multi-source retrieve over the fixture product,
// review and policy documents, RRF across sources, budgeted context building, a templated
// "generation" with [citation_id] markers, and citation validation with a visible retry.
// Produces contract-shaped responses and RAG traces (build_context / generate /
// validate_citations details).

import { PRODUCTS } from './fixtures.js'
import { POLICIES, REVIEWS, productArt } from './storefrontFixtures.js'
import { detectLanguage, hash, newTraceId } from './searchEngine.js'

export const CONTEXT_BUDGET = 900
export const MAX_CONTEXT_DOCS = 4
const MODEL = 'gpt-4.1-mini'
const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits

const STOPWORDS = new Set(['what', 'does', 'with', 'this', 'that', 'there', 'have', 'from', 'about', 'which', 'will', 'your', 'they', 'them', 'much', 'many', 'come', 'comes', 'good', 'like', 'được', 'không', 'những', 'này', 'nào'])

// Vietnamese question phrases -> English evidence words (the fixture evidence is English).
const VI_TERMS = [
  ['chống nước', 'waterproof'], ['chất liệu', 'material'], ['đổi trả', 'return'], ['trả hàng', 'return'], ['trả lại', 'return'],
  ['hoàn tiền', 'refund'], ['giao hàng', 'shipping'], ['vận chuyển', 'shipping'], ['bảo hành', 'warranty'], ['màu', 'color'],
  ['nặng', 'weight'], ['trọng lượng', 'weight'], ['đệm', 'cushioning'], ['vừa chân', 'fits'], ['kích cỡ', 'size'], ['size', 'size'],
  ['ấm', 'warm'], ['nhẹ', 'light'], ['da', 'leather'],
]

export function questionWords(question = '') {
  const lower = String(question).toLowerCase()
  const words = []
  for (const [phrase, term] of VI_TERMS) if (new RegExp(`(^|\\s)${phrase}(\\s|$|\\?|,|\\.)`, 'u').test(lower)) words.push(term)
  for (const w of lower.match(/[\p{L}\p{N}]+/gu) || []) {
    if (w.length >= 4 && !STOPWORDS.has(w) && /^[a-z0-9-]+$/.test(w)) words.push(w)
  }
  return [...new Set(words)]
}

function sentences(text) {
  return String(text || '').split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean)
}

// --- documents per source -----------------------------------------------------------------

function productDoc(product, words) {
  const mentions = (text) => words.some((word) => text.toLowerCase().includes(word))
  const facts = (product.attributes || []).filter((a) => mentions(`${a.name} ${a.value}`)).map((a) => `${a.name}: ${a.value}.`)
  facts.push(...sentences(product.description).filter(mentions))
  const full = [...(product.attributes || []).map((a) => `${a.name}: ${a.value}.`), product.description || ''].join(' ')
  return {
    id: `product:${product.product_id}`,
    source: 'product',
    title: product.title,
    product_id: product.product_id,
    text: full,
    facts,
    score: facts.length ? round(0.55 + 0.4 * Math.min(1, facts.length / Math.max(1, words.length))) : 0,
  }
}

function sentenceDoc({ id, source, title, text, product_id: productId, metadata }, words) {
  const facts = sentences(text).filter((s) => words.some((w) => s.toLowerCase().includes(w)))
  return {
    id, source, title, text, product_id: productId, metadata, facts,
    score: facts.length ? round(0.4 + 0.5 * Math.min(1, facts.length / Math.max(1, words.length)) + (hash(id) % 50) / 1000) : 0,
  }
}

export function retrieveSources({ words, productIds = [], sources = ['product'] }) {
  const perSource = {}
  if (sources.includes('product')) {
    perSource.product = PRODUCTS.filter((p) => productIds.includes(p.product_id)).map((p) => productDoc(p, words))
  }
  if (sources.includes('review')) {
    const reviews = productIds.length ? REVIEWS.filter((r) => productIds.includes(r.product_id)) : REVIEWS
    perSource.review = reviews.map((r) => sentenceDoc({ id: `review:${r.id}`, source: 'review', title: r.title, text: r.text, product_id: r.product_id, metadata: { rating: r.rating } }, words))
  }
  if (sources.includes('policy')) {
    perSource.policy = POLICIES.map((p) => sentenceDoc({
      id: `policy:${p.id}`, source: 'policy', title: p.title, text: p.text,
      metadata: { policy_id: p.policy_id, section_id: p.section_id, provenance: 'shopmind_curated_experimental' },
    }, words))
  }
  for (const key of Object.keys(perSource)) {
    perSource[key] = perSource[key].filter((d) => d.score > 0).sort((a, b) => b.score - a.score).map((d, i) => ({ ...d, rank: i + 1 }))
  }
  return perSource
}

export function fuseSources(perSource, k = 60) {
  const fused = []
  for (const [source, docs] of Object.entries(perSource)) {
    for (const doc of docs) fused.push({ ...doc, fused: 1 / (k + doc.rank), contributions: { [source]: { rank: doc.rank, score: round(1 / (k + doc.rank)) } } })
  }
  return fused.sort((a, b) => b.fused - a.fused || b.score - a.score).map((d, i) => ({ ...d, fused_rank: i + 1, fused: round(d.fused) }))
}

export function buildContext(fused, budget = CONTEXT_BUDGET, maxDocs = MAX_CONTEXT_DOCS) {
  let rendered = 0
  const documents = []
  const included = []
  for (const doc of fused) {
    const snippet = doc.facts.join(' ')
    const chars = snippet.length + doc.title.length + 24
    let reason = 'included'
    if (included.length >= maxDocs) reason = 'max_documents'
    else if (rendered + chars > budget) reason = 'over_budget'
    const isIncluded = reason === 'included'
    if (isIncluded) {
      rendered += chars
      included.push({ ...doc, snippet })
    }
    documents.push({ id: doc.id, source: doc.source, chars, included: isIncluded, reason, score: doc.score })
  }
  return { documents, included, rendered_chars: rendered, budget }
}

function citationFor(doc, citationId) {
  return {
    citation_id: citationId,
    source: doc.source,
    document_id: doc.id,
    title: doc.title,
    snippet: doc.snippet,
    ...(doc.product_id ? { product_id: doc.product_id } : {}),
    score: doc.score,
    metadata: { score_type: 'mock', ...(doc.metadata || {}) },
  }
}

function composeAnswer({ included, language, productTitle }) {
  const lines = included.map((doc, i) => {
    const id = `c${i + 1}`
    if (doc.source === 'product') {
      const intro = language === 'vi' ? `Theo thông tin sản phẩm ${doc.title}:` : `Based on the product details for ${doc.title}:`
      return `${intro}\n${doc.facts.join('\n')} [${id}]`
    }
    if (doc.source === 'review') return `${language === 'vi' ? 'Người mua nhận xét' : 'Reviewers say'}: "${doc.facts[0]}" [${id}]`
    return `${language === 'vi' ? 'Chính sách (thử nghiệm)' : 'Policy (experimental)'}: ${doc.facts.join(' ')} [${id}]`
  })
  if (!lines.length) {
    return language === 'vi'
      ? `Thông tin hiện có${productTitle ? ` về ${productTitle}` : ''} không đủ để trả lời câu hỏi này.`
      : `The product information${productTitle ? ` for ${productTitle}` : ''} doesn't cover that.`
  }
  return lines.join('\n')
}

function clockFrom(start = 0) {
  let now = start
  return {
    step(duration) {
      const started = round(now, 1)
      now += duration
      return { started_ms: started, duration_ms: round(duration, 1) }
    },
    now: () => round(now, 1),
  }
}

// Runs retrieve -> fuse -> build_context -> generate -> validate_citations and returns
// {answer, sources, insufficient_evidence, metadata, steps, durationMs}.
export function runRag({ question, productIds = [], sources = ['product'], startMs = 0, seed = '' }) {
  const words = questionWords(question)
  const language = detectLanguage(question)
  const clock = clockFrom(startMs)
  const jitter = (min, max) => min + ((hash(`${seed}|${question}|${min}`) % 1000) / 1000) * (max - min)

  const perSource = retrieveSources({ words, productIds, sources })
  const allItems = Object.values(perSource).flat()
  const steps = [{
    id: 'retrieve', step: 'multi_source_retrieve', impl: 'multi_source', params: { sources, per_source_k: 5 },
    ...clock.step(jitter(28, 60)),
    summary: Object.entries(perSource).map(([s, docs]) => `${docs.length} ${s}`).join(', ') || 'no sources',
    details: { per_source: Object.fromEntries(Object.entries(perSource).map(([s, docs]) => [s, { count: docs.length }])) },
    output: {
      items: allItems.map((d) => ({ id: d.id, rank: d.rank, score: d.score, title: d.title, details: { source: d.source, snippet: d.facts.join(' ').slice(0, 160) } })),
      total: allItems.length,
    },
  }]
  const fused = fuseSources(perSource)
  steps.push({
    id: 'fuse', step: 'fuse', impl: 'rrf', params: { k: 60 }, ...clock.step(jitter(0.3, 0.8)),
    summary: `RRF across ${Object.keys(perSource).length} source rankings`,
    output: { items: fused.map((d) => ({ id: d.id, rank: d.fused_rank, score: d.fused, title: d.title, details: { source: d.source, contributions: d.contributions } })), total: fused.length },
  })
  const context = buildContext(fused)
  steps.push({
    id: 'context', step: 'build_context', impl: 'budgeted', params: { budget_chars: CONTEXT_BUDGET, max_documents: MAX_CONTEXT_DOCS },
    ...clock.step(jitter(0.8, 2)),
    summary: `${context.included.length}/${context.documents.length} documents, ${context.rendered_chars}/${CONTEXT_BUDGET} chars`,
    details: { documents: context.documents, rendered_chars: context.rendered_chars, budget: CONTEXT_BUDGET },
  })

  const productTitle = PRODUCTS.find((p) => p.product_id === productIds[0])?.title
  const answer = composeAnswer({ included: context.included, language, productTitle })
  const citations = context.included.map((doc, i) => citationFor(doc, `c${i + 1}`))
  const insufficient = citations.length === 0
  const needsRetry = context.included.some((d) => d.source === 'policy')
  const attempts = insufficient
    ? [{ attempt: 1, valid: true, error: null }]
    : needsRetry
      ? [{ attempt: 1, valid: false, error: `cited id 'c${citations.length + 3}' is not in the context sent to the model` }, { attempt: 2, valid: true, error: null }]
      : [{ attempt: 1, valid: true, error: null }]

  const promptTokens = 380 + Math.round(context.rendered_chars / 4)
  const outputTokens = Math.max(12, Math.round(answer.length / 4))
  steps.push({
    id: 'generate', step: 'generate', impl: 'openai_responses', params: { model: MODEL, temperature: 0.1 },
    ...clock.step(insufficient ? jitter(5, 9) : jitter(600, 1100) * attempts.length),
    summary: insufficient ? 'skipped LLM: no evidence in context (abstain)' : `${MODEL}, ${attempts.length} attempt(s)`,
    details: {
      model: MODEL,
      prompt_id: 'rag.answer',
      prompt_version: 'v3',
      attempt: attempts.length,
      usage: insufficient ? { input_tokens: 0, output_tokens: 0 } : { input_tokens: promptTokens * attempts.length, output_tokens: outputTokens * attempts.length },
      raw_output: JSON.stringify({ answer, citations: citations.map((c) => c.citation_id), insufficient_evidence: insufficient }),
    },
  })
  steps.push({
    id: 'citations', step: 'validate_citations', impl: 'exact_context', params: { max_retries: 1 },
    ...clock.step(jitter(0.2, 0.6)),
    summary: attempts.length > 1 ? 'attempt 1 rejected, retry accepted' : 'all citations found in context',
    details: { attempts },
  })

  const missing = sources.filter((s) => !(perSource[s] || []).length)
  return {
    answer,
    sources: citations,
    insufficient_evidence: insufficient,
    metadata: missing.length ? { missing_sources: missing } : {},
    steps,
    durationMs: clock.now(),
  }
}

function traceFor({ kind, pipeline, input, steps, durationMs, traceId, output }) {
  return { trace_id: traceId, pipeline, kind, created_at: new Date().toISOString(), duration_ms: round(durationMs + 0.5, 1), input, steps, output }
}

export function ragAskEngine({ question = '', product_id: productId, sources = ['product'], explain = false } = {}) {
  const run = runRag({ question, productIds: productId ? [productId] : [], sources })
  const traceId = newTraceId(`rag|${question}`)
  const body = {
    answer: run.answer,
    sources: run.sources,
    insufficient_evidence: run.insufficient_evidence,
    metadata: run.metadata,
    trace_id: traceId,
  }
  if (explain) {
    body.trace = traceFor({
      kind: 'rag', pipeline: 'rag.ask', traceId, steps: run.steps, durationMs: run.durationMs,
      input: { question, product_id: productId ?? null, sources },
      output: { citation_ids: run.sources.map((s) => s.citation_id), insufficient_evidence: run.insufficient_evidence },
    })
  }
  return body
}

// --- compare ---------------------------------------------------------------------------

const COMPARE_ATTRIBUTES = ['Color', 'Material', 'Weight', 'Waterproof']

function parseGrams(value) {
  const match = /([\d.]+)\s*g\b/i.exec(value || '')
  return match ? Number(match[1]) : null
}

export function compareEngine({ product_ids: productIds = [], question = '', explain = false } = {}) {
  const products = productIds.map((id) => PRODUCTS.find((p) => p.product_id === id))
  if (products.some((p) => !p)) throw Object.assign(new Error('product not found'), { status: 404, code: 'product_not_found' })
  const attr = (p, name) => (p.attributes || []).find((a) => a.name === name)?.value ?? null
  const attributes = [
    { name: 'Brand', values: Object.fromEntries(products.map((p) => [p.product_id, p.brand || null])) },
    { name: 'Category', values: Object.fromEntries(products.map((p) => [p.product_id, p.category || null])) },
    { name: 'Price (synthetic)', values: Object.fromEntries(products.map((p) => [p.product_id, p.price ? `${p.price.amount} ${p.price.currency}` : null])) },
    ...COMPARE_ATTRIBUTES.map((name) => ({ name, values: Object.fromEntries(products.map((p) => [p.product_id, attr(p, name)])) })),
  ]

  const sources = []
  const cite = (doc) => {
    const existing = sources.find((s) => s.document_id === doc.document_id && s.snippet === doc.snippet)
    if (existing) return existing.citation_id
    const citation = { citation_id: `c${sources.length + 1}`, metadata: { score_type: 'mock' }, ...doc }
    sources.push(citation)
    return citation.citation_id
  }
  const productCite = (p, name) => cite({ source: 'product', document_id: `product:${p.product_id}`, title: p.title, product_id: p.product_id, snippet: `${name}: ${attr(p, name)}.` })

  const points = []
  const weights = products.map((p) => ({ p, g: parseGrams(attr(p, 'Weight')) })).filter((w) => w.g != null)
  if (weights.length >= 2) {
    weights.sort((a, b) => a.g - b.g)
    const light = weights[0]
    points.push({ text: `${light.p.title} nhẹ nhất (${attr(light.p, 'Weight')}).`, citation_ids: weights.map((w) => productCite(w.p, 'Weight')) })
  }
  const waterproof = products.filter((p) => /^yes/i.test(attr(p, 'Waterproof') || ''))
  if (waterproof.length) {
    points.push({ text: `Chống nước: ${waterproof.map((p) => p.title).join(', ')}.`, citation_ids: waterproof.map((p) => productCite(p, 'Waterproof')) })
  }
  const materials = products.filter((p) => attr(p, 'Material'))
  if (materials.length >= 2) {
    points.push({ text: `Chất liệu khác nhau: ${materials.map((p) => `${p.title} dùng ${attr(p, 'Material')}`).join('; ')}.`, citation_ids: materials.map((p) => productCite(p, 'Material')) })
  }
  for (const p of products) {
    const review = REVIEWS.find((r) => r.product_id === p.product_id)
    if (review) {
      const id = cite({ source: 'review', document_id: `review:${review.id}`, title: review.title, product_id: p.product_id, snippet: review.text, metadata: { rating: review.rating, score_type: 'mock' } })
      points.push({ text: `Review về ${p.title}: “${review.text.split('.')[0]}.”`, citation_ids: [id] })
    }
  }

  let filtered = points
  if (question.trim()) {
    const words = questionWords(question)
    filtered = points.filter((pt) => pt.citation_ids.some((cid) => {
      const s = sources.find((src) => src.citation_id === cid)
      return words.some((w) => `${s.snippet} ${pt.text}`.toLowerCase().includes(w))
    }))
  }
  const used = new Set(filtered.flatMap((pt) => pt.citation_ids))
  const usedSources = sources.filter((s) => used.has(s.citation_id))
  const insufficient = filtered.length === 0
  const missingData = products.filter((p) => !(p.attributes || []).length)
  const summary = insufficient
    ? 'Không đủ bằng chứng trong dữ liệu sản phẩm, review và chính sách để so sánh theo câu hỏi này.'
    : `So sánh ${products.length} sản phẩm dựa trên thuộc tính và review đã lập chỉ mục.${missingData.length ? ` ${missingData.map((p) => p.title).join(', ')} không có dữ liệu thuộc tính.` : ''}`

  const traceId = newTraceId(`compare|${productIds.join(',')}`)
  const body = {
    products: products.map((p) => ({ product_id: p.product_id, title: p.title, brand: p.brand, category: p.category, image_url: productArt(p) })),
    attributes,
    summary,
    points: filtered,
    sources: usedSources,
    insufficient_evidence: insufficient,
    trace_id: traceId,
  }
  if (explain) {
    const run = runRag({ question: question || 'weight material waterproof review', productIds, sources: ['product', 'review'] })
    body.trace = traceFor({
      kind: 'compare', pipeline: 'rag.compare', traceId, steps: run.steps, durationMs: run.durationMs,
      input: { product_ids: productIds, question: question || null },
      output: { citation_ids: usedSources.map((s) => s.citation_id), insufficient_evidence: insufficient },
    })
  }
  return body
}
