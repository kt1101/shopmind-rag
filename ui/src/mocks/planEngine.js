// Mock F6 shopping planner (POST /rag/plan) for VITE_MOCK_API=1. Rules mode only (like the
// backend without an LLM): occasion template -> one retrieval per need over the fixture
// catalog -> greedy budget optimizer -> extractive reasons citing product/review evidence and
// policy tips. Deterministic. Contract: docs/API_CONTRACT.md "Shopping planner".

import { PRODUCTS } from './fixtures.js'
import { POLICIES, REVIEWS, productArt, stockFor } from './storefrontFixtures.js'
import { detectLanguage, hash, newTraceId, searchTextEngine } from './searchEngine.js'

const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits
const BY_ID = Object.fromEntries(PRODUCTS.map((p) => [p.product_id, p]))
const CANDIDATES_PER_NEED = 4

// Occasion templates (the backend reads configs/vocab/occasions.yaml). `categories: []` means
// the catalog has nothing for that need, so it comes back as `no_match`.
export const OCCASIONS = [
  {
    id: 'beach_trip', match: /(biển|beach|bãi tắm|seaside|đảo)/i, label: { vi: 'Đi biển', en: 'Beach trip' },
    needs: [
      { label: { vi: 'Ba lô / túi đi biển', en: 'Beach bag / backpack' }, query: 'waterproof roll-top daypack', categories: ['backpacks'], priority: 'must' },
      { label: { vi: 'Giày nhẹ để đi dạo', en: 'Light walking shoes' }, query: 'lightweight breathable shoe', categories: ['running_shoes'], priority: 'must' },
      { label: { vi: 'Áo khoác gió', en: 'Windbreaker' }, query: 'windbreaker light jacket', categories: ['jackets'], priority: 'nice' },
      { label: { vi: 'Kem chống nắng', en: 'Sunscreen' }, query: 'sunscreen', categories: [], priority: 'nice' },
    ],
  },
  {
    id: 'hiking_trip', match: /(leo núi|trekking|hiking|cắm trại|camping|dã ngoại|trek)/i, label: { vi: 'Leo núi / cắm trại', en: 'Hiking / camping' },
    needs: [
      { label: { vi: 'Giày leo núi chống nước', en: 'Waterproof hiking boots' }, query: 'waterproof hiking boot', categories: ['hiking_boots'], priority: 'must' },
      { label: { vi: 'Ba lô trekking', en: 'Trekking backpack' }, query: 'expedition backpack hip belt', categories: ['backpacks'], priority: 'must' },
      { label: { vi: 'Áo khoác giữ ấm', en: 'Warm jacket' }, query: 'warm insulated jacket', categories: ['jackets'], priority: 'must' },
      { label: { vi: 'Giày chạy trail', en: 'Trail runners' }, query: 'trail running shoe', categories: ['running_shoes'], priority: 'nice' },
    ],
  },
  {
    id: 'running', match: /(chạy bộ|marathon|running|\brun\b|jogging)/i, label: { vi: 'Bắt đầu chạy bộ', en: 'Getting into running' },
    needs: [
      { label: { vi: 'Giày chạy bộ', en: 'Running shoes' }, query: 'cushioned running shoe', categories: ['running_shoes'], priority: 'must' },
      { label: { vi: 'Áo khoác chạy bộ', en: 'Running jacket' }, query: 'windbreaker jacket', categories: ['jackets'], priority: 'nice' },
      { label: { vi: 'Ba lô nhỏ', en: 'Small pack' }, query: 'ultralight pack', categories: ['backpacks'], priority: 'nice' },
    ],
  },
  {
    id: 'new_apartment', match: /(căn hộ|nhà mới|studio|chuyển nhà|chuyển vào|apartment|moving)/i, label: { vi: 'Dọn vào nhà mới', en: 'Moving into a new place' },
    needs: [
      { label: { vi: 'Ghế sofa', en: 'Sofa' }, query: 'sofa', categories: [], priority: 'must' },
      { label: { vi: 'Đèn bàn / đèn ngủ', en: 'Lamp' }, query: 'lamp', categories: [], priority: 'nice' },
      { label: { vi: 'Túi lớn để chuyển đồ', en: 'Large bag for moving' }, query: 'weekender bag large', categories: ['backpacks'], priority: 'must' },
      { label: { vi: 'Áo khoác mặc hằng ngày', en: 'Everyday jacket' }, query: 'insulated jacket', categories: ['jackets'], priority: 'nice' },
      { label: { vi: 'Giày đi hằng ngày', en: 'Everyday shoes' }, query: 'comfort everyday jogger', categories: ['running_shoes'], priority: 'nice' },
    ],
  },
  {
    id: 'home_office', match: /(làm việc tại nhà|góc làm việc|home office|work from home|wfh|bàn làm việc)/i, label: { vi: 'Góc làm việc tại nhà', en: 'Home office' },
    needs: [
      { label: { vi: 'Bàn làm việc', en: 'Desk' }, query: 'desk', categories: [], priority: 'must' },
      { label: { vi: 'Ghế công thái học', en: 'Ergonomic chair' }, query: 'office chair', categories: [], priority: 'must' },
      { label: { vi: 'Ba lô đựng laptop', en: 'Laptop backpack' }, query: 'commuter pack laptop', categories: ['backpacks'], priority: 'must' },
      { label: { vi: 'Áo khoác mỏng', en: 'Light jacket' }, query: 'fleece jacket', categories: ['jackets'], priority: 'nice' },
    ],
  },
  {
    id: 'gift', match: /(quà|sinh nhật|gift|birthday|tặng)/i, label: { vi: 'Quà tặng', en: 'Gift' },
    needs: [
      { label: { vi: 'Món quà chính: giày chạy bộ', en: 'Main gift: running shoes' }, query: 'lightweight running shoe', categories: ['running_shoes'], priority: 'must' },
      { label: { vi: 'Quà kèm: áo khoác', en: 'Add-on: jacket' }, query: 'fleece jacket', categories: ['jackets'], priority: 'nice' },
      { label: { vi: 'Quà kèm: ba lô nhỏ', en: 'Add-on: small backpack' }, query: 'daily commuter pack', categories: ['backpacks'], priority: 'nice' },
    ],
  },
  {
    id: 'new_puppy', match: /(chó|cún|puppy|dog|thú cưng|pet)/i, label: { vi: 'Đón cún con về nhà', en: 'New puppy' },
    needs: [
      { label: { vi: 'Thức ăn cho chó con', en: 'Puppy food' }, query: 'puppy food', categories: [], priority: 'must' },
      { label: { vi: 'Dây dắt và vòng cổ', en: 'Leash and collar' }, query: 'leash', categories: [], priority: 'must' },
      { label: { vi: 'Giày để dắt cún đi dạo', en: 'Shoes for dog walks' }, query: 'comfortable walking shoe', categories: ['running_shoes'], priority: 'nice' },
      { label: { vi: 'Áo khoác đi dạo', en: 'Jacket for walks' }, query: 'rain jacket waterproof', categories: ['jackets'], priority: 'nice' },
    ],
  },
]

const FALLBACK = {
  id: 'general', label: { vi: 'Mua sắm chung', en: 'General shopping' },
  needs: [
    { label: { vi: 'Giày', en: 'Shoes' }, query: 'shoe', categories: ['running_shoes'], priority: 'must' },
    { label: { vi: 'Ba lô', en: 'Backpack' }, query: 'backpack', categories: ['backpacks'], priority: 'nice' },
    { label: { vi: 'Áo khoác', en: 'Jacket' }, query: 'jacket', categories: ['jackets'], priority: 'nice' },
  ],
}

// "ngân sách 800 đô", "dưới 300 đô", "khoảng 150$", "under $500", "800 usd".
export function parseBudgetFromText(text = '') {
  const s = String(text).toLowerCase().replace(/(\d)[.,](\d{3})\b/g, '$1$2')
  const patterns = [/\$\s*(\d+(?:\.\d+)?)/, /(\d+(?:\.\d+)?)\s*(?:\$|usd|đô(?: la)?|dollars?|dola)/, /(?:ngân sách|budget|dưới|under|khoảng|tầm|around|max)\s*(\d+(?:\.\d+)?)/]
  for (const re of patterns) {
    const m = re.exec(s)
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return null
}

export function detectOccasion(text = '') {
  return OCCASIONS.find((o) => o.match.test(text)) || FALLBACK
}

function planItem(result) {
  const product = BY_ID[result.product_id]
  return {
    product_id: result.product_id,
    title: result.title,
    brand: result.brand,
    category: result.category,
    image_url: productArt(product),
    price: product?.price ? { amount: product.price.amount, currency: product.price.currency, synthetic: true } : null,
    in_stock: product?.attributes?.length ? stockFor(result.product_id).in_stock : null,
    score: result.score,
    rank: result.rank,
  }
}

// Relevance-ranked candidates in the need's categories, back-filled from the category listing
// when the query matches few products; unpriced items go last (they cannot be budgeted).
function retrieveNeed(need) {
  if (!need.categories.length) return []
  const filters = { category: need.categories }
  const ranked = searchTextEngine({ query: need.query, mode: 'hybrid', top_k: 10, filters }).results
  const seen = new Set(ranked.map((r) => r.product_id))
  const backfill = searchTextEngine({ query: '', top_k: 20, filters }).results.filter((r) => !seen.has(r.product_id))
    .map((r, i) => ({ ...r, score: round(Math.max(0.01, (ranked.at(-1)?.score ?? 0.2) * 0.5 - i * 0.01), 4) }))
  const items = [...ranked, ...backfill].map(planItem)
  return [...items.filter((c) => c.price), ...items.filter((c) => !c.price)].slice(0, CANDIDATES_PER_NEED).map((c, i) => ({ ...c, rank: i + 1 }))
}

// Greedy optimizer: needs in priority order (must first); each takes its most relevant
// candidate that fits the budget left after reserving the cheapest option of every later
// `must` need. Items without a price never count against the budget.
export function optimizeBudget(needs, budget) {
  const price = (item) => item?.price?.amount ?? 0
  const order = needs.map((n, i) => ({ n, i })).sort((a, b) => (a.n.priority === b.n.priority ? a.i - b.i : a.n.priority === 'must' ? -1 : 1))
  let remaining = budget ?? Infinity
  const decisions = []
  for (let k = 0; k < order.length; k += 1) {
    const need = order[k].n
    if (!need.candidates.length) {
      need.status = 'no_match'
      decisions.push({ need_id: need.id, status: 'no_match', reason: 'no catalog product for this need' })
      continue
    }
    const reserve = order.slice(k + 1).filter((o) => o.n.priority === 'must' && o.n.candidates.length)
      .reduce((sum, o) => sum + Math.min(...o.n.candidates.map(price)), 0)
    const fits = need.candidates.find((c) => price(c) <= remaining - reserve)
      || (need.priority === 'must' ? need.candidates.find((c) => price(c) <= remaining) : null)
    if (fits) {
      need.status = 'chosen'
      need.chosen = fits
      remaining -= price(fits)
      decisions.push({ need_id: need.id, status: 'chosen', product_id: fits.product_id, price: price(fits), remaining: Number.isFinite(remaining) ? round(remaining) : null })
    } else {
      need.status = 'skipped_budget'
      decisions.push({ need_id: need.id, status: 'skipped_budget', cheapest: Math.min(...need.candidates.map(price)), remaining: round(remaining) })
    }
    need.alternatives = need.candidates.filter((c) => c.product_id !== need.chosen?.product_id)
  }
  return decisions
}

function firstSentence(text) {
  return String(text || '').split(/(?<=\.)\s+/)[0] || ''
}

function productCitation(product, score) {
  const attrs = (product.attributes || []).map((a) => `${a.name}: ${a.value}.`).join(' ')
  return {
    citation_id: `product:${product.product_id}`, document_id: `product:${product.product_id}`, source: 'product', title: product.title,
    score: round(score ?? 0.8, 4), snippet: `${firstSentence(product.description)} ${attrs}`.trim(), product_id: product.product_id, metadata: { score_type: 'mock' },
  }
}

function reviewCitation(review) {
  return {
    citation_id: `review:${review.id}`, document_id: `review:${review.id}`, source: 'review', title: review.title, score: 0.7,
    snippet: review.text, product_id: review.product_id, metadata: { rating: review.rating, score_type: 'mock' },
  }
}

function policyCitation(policy) {
  const id = `policy:${policy.policy_id}.${policy.section_id}`
  return {
    citation_id: id, document_id: id, source: 'policy', title: policy.title, score: 0.6, snippet: policy.text,
    metadata: { policy_id: policy.policy_id, section_id: policy.section_id, provenance: 'shopmind_curated_experimental', score_type: 'mock' },
  }
}

function money(n) {
  return `${Number.isInteger(n) ? n : n.toFixed(2)} USD`
}

function reasonFor(need, lang, budget) {
  if (need.status === 'no_match') {
    return lang === 'vi' ? `Cửa hàng chưa có sản phẩm cho “${need.label}”.` : `The store has no product for “${need.label}” yet.`
  }
  if (need.status === 'skipped_budget') {
    const cheapest = Math.min(...need.candidates.map((c) => c.price?.amount ?? 0))
    return lang === 'vi'
      ? `Bỏ qua để giữ trong ngân sách ${money(budget)}: lựa chọn rẻ nhất (${money(cheapest)}) vượt phần ngân sách còn lại. Bạn vẫn có thể chọn một món bên dưới.`
      : `Skipped to stay within ${money(budget)}: the cheapest option (${money(cheapest)}) exceeds what is left. You can still pick one below.`
  }
  const product = BY_ID[need.chosen.product_id]
  const fact = firstSentence(product?.description)
  const review = REVIEWS.find((r) => r.product_id === need.chosen.product_id)
  const extra = review ? (lang === 'vi' ? ` Người mua nhận xét: “${review.title}”.` : ` Reviewers say: “${review.title}”.`) : ''
  return lang === 'vi'
    ? `${need.chosen.title} hợp với “${need.label}”: ${fact}${extra}`
    : `${need.chosen.title} fits “${need.label}”: ${fact}${extra}`
}

function step(id, stepName, impl, started, duration, summary, extra = {}) {
  return { id, step: stepName, impl, params: extra.params || {}, started_ms: round(started, 1), duration_ms: round(duration, 1), summary, ...(extra.details ? { details: extra.details } : {}), ...(extra.output ? { output: extra.output } : {}) }
}

export function planEngine({ request = '', budget: budgetIn, language, max_needs: maxNeeds = 6, explain = false } = {}) {
  const text = String(request || '').trim()
  if (text.length < 3 || text.length > 800) throw Object.assign(new Error('request must be 3..800 characters'), { status: 422, code: 'validation_error' })
  const lang = language === 'vi' || language === 'en' ? language : detectLanguage(text)
  const parsedBudget = parseBudgetFromText(text)
  const budget = Number(budgetIn) > 0 ? Number(budgetIn) : parsedBudget
  const occasion = detectOccasion(text)
  const limit = Math.min(8, Math.max(2, Number(maxNeeds) || 6))
  const needs = occasion.needs.slice(0, limit).map((n, i) => ({
    id: `n${i + 1}`, label: n.label[lang] || n.label.vi, query: n.query, categories: n.categories, priority: n.priority,
    status: null, chosen: null, alternatives: [], candidates: [],
  }))

  const jitter = (min, max, seed) => min + ((hash(`${text}|${seed}`) % 1000) / 1000) * (max - min)
  let clock = 0
  const steps = []
  steps.push(step('decompose', 'decompose', 'rules', clock, jitter(0.8, 2.4, 'd'), `${occasion.id}: ${needs.length} needs${budget ? `, budget ${budget}` : ''}`, {
    details: {
      occasion: { id: occasion.id, label: occasion.label[lang] }, budget, budget_source: Number(budgetIn) > 0 ? 'request' : parsedBudget ? 'parsed_from_text' : null, language: lang,
      needs: needs.map(({ id, label, query, categories, priority }) => ({ id, label, query, categories, priority })),
    },
  }))
  clock += steps.at(-1).duration_ms
  const parallel = clock
  for (const need of needs) {
    need.candidates = retrieveNeed(need)
    const s = step(need.id, 'retrieve', need.categories.length ? 'hybrid' : 'skip', parallel, need.categories.length ? jitter(14, 38, need.id) : 0.1,
      need.categories.length ? `${need.candidates.length} candidates for “${need.label}”` : 'no catalog category for this need', {
        params: { query: need.query, categories: need.categories, k: CANDIDATES_PER_NEED },
        output: { items: need.candidates.map((c) => ({ id: c.product_id, rank: c.rank, score: c.score, title: c.title, details: { price: c.price?.amount ?? null } })), total: need.candidates.length },
      })
    steps.push(s)
    clock = Math.max(clock, s.started_ms + s.duration_ms)
  }
  const decisions = optimizeBudget(needs, budget)
  const total = round(needs.filter((n) => n.status === 'chosen').reduce((sum, n) => sum + (n.chosen.price?.amount ?? 0), 0))
  steps.push(step('budget', 'optimize_budget', 'greedy', clock, jitter(0.3, 0.9, 'b'), budget ? `total ${total} / budget ${budget}` : `total ${total} (no budget)`, {
    params: { strategy: 'must_first_reserve_cheapest' }, details: { budget, total, within_budget: budget == null || total <= budget, decisions },
  }))
  clock += steps.at(-1).duration_ms

  // Evidence: chosen products (+ one review each when present) and policy tips.
  const sources = []
  const add = (citation) => {
    if (!sources.some((s) => s.citation_id === citation.citation_id)) sources.push(citation)
    return citation.citation_id
  }
  for (const need of needs) {
    need.citation_ids = []
    if (need.status !== 'chosen') continue
    const product = BY_ID[need.chosen.product_id]
    need.citation_ids.push(add(productCitation(product, need.chosen.score)))
    const review = REVIEWS.find((r) => r.product_id === product.product_id)
    if (review) need.citation_ids.push(add(reviewCitation(review)))
  }
  const tips = []
  const returns = POLICIES.find((p) => p.policy_id === 'returns' && p.section_id === 'window')
  tips.push({ text: lang === 'vi' ? 'Đồ chưa dùng có thể đổi trả trong 30 ngày (chính sách thử nghiệm).' : 'Unused items can be returned within 30 days (experimental policy).', citation_ids: [add(policyCitation(returns))] })
  const shipping = POLICIES.find((p) => p.policy_id === 'shipping')
  if (total > 100) tips.push({ text: lang === 'vi' ? 'Đơn trên 100 USD được miễn phí giao hàng tiêu chuẩn (3–5 ngày).' : 'Orders above 100 USD ship free (standard, 3–5 days).', citation_ids: [add(policyCitation(shipping))] })
  if (needs.some((n) => n.status === 'chosen' && /shoes|boots/.test(n.chosen.category || ''))) {
    const footwear = POLICIES.find((p) => p.section_id === 'footwear')
    tips.push({ text: lang === 'vi' ? 'Giày đã mang ra ngoài trời không được đổi trả, hãy thử trong nhà trước.' : 'Footwear worn outdoors cannot be returned, so try it on indoors first.', citation_ids: [add(policyCitation(footwear))] })
  }
  const documents = sources.map((s) => ({ id: s.citation_id, source: s.source, chars: s.snippet.length + s.title.length + 24, included: true, reason: 'included' }))
  const rendered = documents.reduce((sum, d) => sum + d.chars, 0)
  steps.push(step('context', 'build_context', 'budgeted', clock, jitter(0.6, 1.6, 'c'), `${documents.length} documents, ${rendered} chars`, {
    params: { budget_chars: 4000 }, details: { documents, rendered_chars: rendered, budget: 4000 },
  }))
  clock += steps.at(-1).duration_ms
  for (const need of needs) need.reason = reasonFor(need, lang, budget)
  steps.push(step('justify', 'justify', 'extractive', clock, jitter(0.4, 1.2, 'j'), `${needs.filter((n) => n.status === 'chosen').length} reasons from product/review evidence (no LLM)`, {
    details: { method: 'rules', reasons: needs.map((n) => ({ need_id: n.id, citation_ids: n.citation_ids })) },
  }))
  clock += steps.at(-1).duration_ms

  const chosen = needs.filter((n) => n.status === 'chosen')
  const skipped = needs.filter((n) => n.status === 'skipped_budget').length
  const missing = needs.filter((n) => n.status === 'no_match').length
  const summary = lang === 'vi'
    ? `Kế hoạch “${occasion.label.vi}”: ${chosen.length} món, tổng ${money(total)}${budget ? ` trên ngân sách ${money(budget)}` : ''}.${skipped ? ` ${skipped} nhu cầu tạm bỏ qua để vừa ngân sách.` : ''}${missing ? ` ${missing} nhu cầu chưa có sản phẩm phù hợp trong cửa hàng.` : ''}`
    : `“${occasion.label.en}” plan: ${chosen.length} items, total ${money(total)}${budget ? ` against a ${money(budget)} budget` : ''}.${skipped ? ` ${skipped} need(s) skipped to stay within budget.` : ''}${missing ? ` ${missing} need(s) have no matching product in the store.` : ''}`

  const traceId = newTraceId(`plan|${text}`)
  const body = {
    request: text,
    language: lang,
    method: 'rules',
    occasion: { id: occasion.id, label: occasion.label[lang] },
    budget: budget ?? null,
    currency: 'USD',
    total,
    within_budget: budget == null || total <= budget,
    summary,
    needs: needs.map(({ id, label, query, categories, priority, status, chosen: pick, alternatives, reason, citation_ids: citationIds }) => ({
      id, label, query, categories, priority, status, chosen: pick, alternatives, reason, citation_ids: citationIds,
    })),
    tips,
    sources,
    insufficient_evidence: chosen.length === 0,
    notes: ['prices are synthetic'],
    trace_id: traceId,
  }
  if (explain) {
    body.trace = {
      trace_id: traceId, pipeline: 'rag.plan', kind: 'rag', created_at: new Date().toISOString(), duration_ms: round(clock + 0.4, 1),
      input: { request: text, budget: budget ?? null, language: lang, max_needs: limit }, steps,
      output: { product_ids: chosen.map((n) => n.chosen.product_id), total, within_budget: body.within_budget, citation_ids: sources.map((s) => s.citation_id) },
    }
  }
  return body
}
