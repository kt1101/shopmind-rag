// F6 shopping planner view logic (docs/API_CONTRACT.md "Shopping planner"): URL state, the
// POST /rag/plan response -> view model, client-side swaps with total recomputation, budget
// bar, citations per need, and the items for "add all to cart".

export const PLAN_MIN_CHARS = 3
export const PLAN_MAX_CHARS = 800
export const NEED_STATUSES = ['chosen', 'skipped_budget', 'no_match']

const round2 = (value) => Math.round(value * 100) / 100

// --- URL ---------------------------------------------------------------------------------

export function parseBudget(value) {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/[,\s$]/g, '').trim()
  if (!text) return null
  const n = Number(text)
  return Number.isFinite(n) && n > 0 ? round2(Math.min(n, 1e7)) : null
}

// /plan?q=&budget= -> {query, budget}
export function parsePlanParams(params) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || '')
  return { query: (p.get('q') || '').trim().slice(0, PLAN_MAX_CHARS), budget: parseBudget(p.get('budget')) }
}

export function buildPlanUrl({ query, budget } = {}) {
  const p = new URLSearchParams()
  const q = String(query || '').trim()
  if (q) p.set('q', q.slice(0, PLAN_MAX_CHARS))
  const b = parseBudget(budget)
  if (b != null) p.set('budget', String(b))
  const qs = p.toString()
  return qs ? `/plan?${qs}` : '/plan'
}

export function canPlan(query) {
  const length = String(query || '').trim().length
  return length >= PLAN_MIN_CHARS && length <= PLAN_MAX_CHARS
}

// --- response -> view model ---------------------------------------------------------------

function priceOf(item) {
  const amount = item?.price?.amount
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : null
}

function normalizeItem(item) {
  if (!item || item.product_id == null) return null
  return {
    product_id: String(item.product_id),
    title: item.title || String(item.product_id),
    brand: item.brand ?? null,
    category: item.category ?? null,
    image_url: item.image_url ?? null,
    price: priceOf(item) == null ? null : { amount: item.price.amount, currency: item.price.currency || 'USD', synthetic: item.price.synthetic !== false },
    in_stock: typeof item.in_stock === 'boolean' ? item.in_stock : null,
    score: Number.isFinite(item.score) ? item.score : null,
    rank: Number.isFinite(item.rank) ? item.rank : null,
  }
}

function normalizeNeed(need, index) {
  const chosen = normalizeItem(need?.chosen)
  const seen = new Set(chosen ? [chosen.product_id] : [])
  const alternatives = (Array.isArray(need?.alternatives) ? need.alternatives : []).map(normalizeItem).filter((item) => item && !seen.has(item.product_id) && seen.add(item.product_id))
  let status = NEED_STATUSES.includes(need?.status) ? need.status : chosen ? 'chosen' : alternatives.length ? 'skipped_budget' : 'no_match'
  if (status === 'chosen' && !chosen) status = alternatives.length ? 'skipped_budget' : 'no_match'
  return {
    id: String(need?.id ?? `n${index + 1}`),
    label: need?.label || need?.query || `#${index + 1}`,
    query: need?.query || need?.label || '',
    categories: Array.isArray(need?.categories) ? need.categories : [],
    priority: need?.priority === 'nice' ? 'nice' : 'must',
    status,
    chosen: status === 'chosen' ? chosen : null,
    alternatives,
    reason: need?.reason || '',
    citationIds: Array.isArray(need?.citation_ids) ? need.citation_ids.map(String) : [],
    // the server's original pick, to show "changed by you"
    serverChoice: chosen?.product_id ?? null,
  }
}

export function normalizePlan(data) {
  if (!data || typeof data !== 'object') return null
  const needs = (Array.isArray(data.needs) ? data.needs : []).map(normalizeNeed)
  const budget = parseBudget(data.budget)
  const plan = {
    request: data.request || '',
    language: data.language || null,
    method: data.method || null,
    occasion: data.occasion && typeof data.occasion === 'object' ? { id: data.occasion.id ?? null, label: data.occasion.label || data.occasion.id || '' } : null,
    budget,
    currency: data.currency || 'USD',
    summary: data.summary || '',
    needs,
    tips: (Array.isArray(data.tips) ? data.tips : []).filter((tip) => tip && tip.text).map((tip) => ({ text: tip.text, citationIds: Array.isArray(tip.citation_ids) ? tip.citation_ids.map(String) : [] })),
    sources: Array.isArray(data.sources) ? data.sources : [],
    insufficientEvidence: Boolean(data.insufficient_evidence),
    notes: Array.isArray(data.notes) ? data.notes : [],
    traceId: data.trace_id ?? null,
    trace: data.trace ?? null,
    serverTotal: Number.isFinite(data.total) ? data.total : null,
  }
  return withTotals(plan)
}

// --- totals, budget -----------------------------------------------------------------------

export function planTotal(needs = []) {
  let total = 0
  let priced = 0
  let unpriced = 0
  for (const need of needs) {
    if (need.status !== 'chosen' || !need.chosen) continue
    const amount = priceOf(need.chosen)
    if (amount == null) unpriced += 1
    else {
      total += amount
      priced += 1
    }
  }
  return { total: round2(total), priced, unpriced }
}

export function budgetStatus(total, budget) {
  if (!(budget > 0)) return { hasBudget: false, within: true, over: 0, remaining: null, pct: null }
  const over = round2(Math.max(0, total - budget))
  return {
    hasBudget: true,
    within: total <= budget,
    over,
    remaining: round2(Math.max(0, budget - total)),
    pct: Math.round((total / budget) * 100),
  }
}

export function withTotals(plan) {
  const totals = planTotal(plan.needs)
  return { ...plan, total: totals.total, unpricedCount: totals.unpriced, chosenCount: plan.needs.filter((n) => n.status === 'chosen').length, budgetInfo: budgetStatus(totals.total, plan.budget) }
}

// Picks `productId` (an alternative) for `needId`: the previous pick goes back to the
// alternatives (first position), a skipped need becomes chosen, the total is recomputed.
export function swapChoice(plan, needId, productId) {
  if (!plan) return plan
  let changed = false
  const needs = plan.needs.map((need) => {
    if (need.id !== needId) return need
    const pick = need.alternatives.find((item) => item.product_id === String(productId))
    if (!pick) return need
    changed = true
    const rest = need.alternatives.filter((item) => item.product_id !== pick.product_id)
    return { ...need, status: 'chosen', chosen: pick, alternatives: need.chosen ? [need.chosen, ...rest] : rest }
  })
  return changed ? withTotals({ ...plan, needs }) : plan
}

// Drops the pick of a need (it becomes "skipped" with the pick back among the alternatives).
export function removeChoice(plan, needId) {
  if (!plan) return plan
  let changed = false
  const needs = plan.needs.map((need) => {
    if (need.id !== needId || need.status !== 'chosen' || !need.chosen) return need
    changed = true
    return { ...need, status: 'skipped_budget', chosen: null, alternatives: [need.chosen, ...need.alternatives] }
  })
  return changed ? withTotals({ ...plan, needs }) : plan
}

// --- citations, cart ----------------------------------------------------------------------

export function citationsFor(sources = [], ids = []) {
  const wanted = new Set((ids || []).map(String))
  return (Array.isArray(sources) ? sources : []).filter((s) => wanted.has(String(s?.citation_id ?? s?.document_id)))
}

// Product snapshots of every chosen item (shared/shop-lists `snapshot` shape).
export function chosenProducts(plan) {
  return (plan?.needs || []).filter((n) => n.status === 'chosen' && n.chosen).map((n) => ({
    product_id: n.chosen.product_id,
    title: n.chosen.title,
    ...(n.chosen.brand ? { brand: n.chosen.brand } : {}),
    ...(n.chosen.category ? { category: n.chosen.category } : {}),
    ...(n.chosen.image_url ? { image_url: n.chosen.image_url } : {}),
    ...(n.chosen.price ? { price: n.chosen.price } : {}),
  }))
}

export function priorityOrder(needs = []) {
  return [...needs].sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'must' ? -1 : 1))
}
