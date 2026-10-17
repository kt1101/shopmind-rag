// Search Playground (admin): URL state, overlap between two result lists, rank cross-reference.

export const TOP_K_CHOICES = [5, 10, 20, 50]
export const DEFAULT_TOP_K = 10
export const OVERLAP_K = 10

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

// ?q=&a=&b=&k=&category=&brand= -> state. `b` may be empty (one pipeline only).
export function parsePlaygroundParams(params) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || '')
  const k = Number(p.get('k'))
  const a = clean(p.get('a'))
  const b = clean(p.get('b'))
  return {
    query: clean(p.get('q')),
    pipelineA: a,
    pipelineB: b && b !== a ? b : '',
    topK: TOP_K_CHOICES.includes(k) ? k : DEFAULT_TOP_K,
    filters: { category: clean(p.get('category')), brand: clean(p.get('brand')) },
  }
}

export function buildPlaygroundParams({ query, pipelineA, pipelineB, topK, filters } = {}) {
  const p = new URLSearchParams()
  if (clean(query)) p.set('q', clean(query))
  if (clean(pipelineA)) p.set('a', clean(pipelineA))
  if (clean(pipelineB) && clean(pipelineB) !== clean(pipelineA)) p.set('b', clean(pipelineB))
  if (TOP_K_CHOICES.includes(Number(topK)) && Number(topK) !== DEFAULT_TOP_K) p.set('k', String(topK))
  for (const field of ['category', 'brand']) if (clean(filters?.[field])) p.set(field, clean(filters[field]))
  return p
}

// Pipelines to run: A, then B when it is set and different.
export function pipelinesToRun({ pipelineA, pipelineB } = {}) {
  return [pipelineA, pipelineB].filter((name, index, all) => clean(name) && all.indexOf(name) === index)
}

function ids(list, k) {
  return (Array.isArray(list) ? list : []).slice(0, k).map((r) => String(r?.product_id ?? r?.id ?? '')).filter(Boolean)
}

// Overlap@k between two ranked lists: |top-k(A) ∩ top-k(B)| / k (k = the shorter list when
// both are shorter than k, so two identical 3-item lists overlap 100%).
export function overlapAtK(listA, listB, k = OVERLAP_K) {
  const a = ids(listA, k)
  const b = ids(listB, k)
  const denominator = Math.max(1, Math.min(k, Math.max(a.length, b.length)))
  const setB = new Set(b)
  const shared = a.filter((id) => setB.has(id))
  return {
    k,
    shared: shared.length,
    denominator,
    ratio: a.length || b.length ? shared.length / denominator : null,
    sharedIds: shared,
    onlyA: a.filter((id) => !setB.has(id)),
    onlyB: b.filter((id) => !new Set(a).has(id)),
  }
}

// For each result of `list`, its rank in `other` (null when absent) and the movement
// (positive = ranked higher in this list than in the other).
export function crossRanks(list, other) {
  const otherRanks = new Map((Array.isArray(other) ? other : []).map((r, i) => [String(r?.product_id), r?.rank ?? i + 1]))
  return (Array.isArray(list) ? list : []).map((r, i) => {
    const rank = r?.rank ?? i + 1
    const otherRank = otherRanks.get(String(r?.product_id)) ?? null
    return { productId: String(r?.product_id), rank, otherRank, delta: otherRank == null ? null : otherRank - rank }
  })
}

export function formatRatio(ratio) {
  return Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : '—'
}
