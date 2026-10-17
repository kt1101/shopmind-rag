// Search-trace view models for the Search Inspector (tabs: query, ranking, matched terms,
// performance, ES query). Pure functions; see docs/API_CONTRACT.md "Search-specific step details".

import { findStep, findSteps, itemsOf, stepsOf } from './traceModel.js'

export const DEFAULT_RRF_K = 60

// --- Query tab --------------------------------------------------------------------------

export function queryView(trace) {
  const step = findStep(trace, 'query_understanding')
  const details = step?.details || {}
  const filters = Object.entries(details.filters || {}).map(([field, entry]) => ({
    field,
    requested: toList(entry?.requested),
    resolved: toList(entry?.resolved),
    match: entry?.match === 'fallback' ? 'fallback' : entry?.match === 'exact' ? 'exact' : entry?.match ?? null,
  }))
  const dense = findSteps(trace, 'retrieve')
    .filter((s) => s.details?.query_vector || s.details?.embedder)
    .map((s) => ({
      id: s.id ?? 'retrieve',
      field: s.details?.field ?? s.params?.field ?? null,
      embedder: s.details?.embedder ?? null,
      dims: s.details?.query_vector?.dims ?? null,
      norm: s.details?.query_vector?.norm ?? null,
    }))
  return {
    present: Boolean(step),
    original: details.original_query ?? trace?.input?.query ?? null,
    language: details.language ?? null,
    normalized: details.normalized_query ?? null,
    aliases: Array.isArray(details.aliases) ? details.aliases.filter((a) => a && a.from) : [],
    adaptive: details.adaptive && details.adaptive.mode ? { mode: details.adaptive.mode, reason: details.adaptive.reason ?? '' } : null,
    filters,
    notes: stepsOf(trace).flatMap((s) => (Array.isArray(s.notes) ? s.notes.map((note) => ({ step: s.id ?? s.step, note })) : [])),
    mode: trace?.input?.mode ?? null,
    dense,
  }
}

function toList(value) {
  if (value == null) return []
  return (Array.isArray(value) ? value : [value]).map(String)
}

// --- Ranking tab ------------------------------------------------------------------------

// Columns: every retrieve step, then fuse, then the final ranking (rerank if present,
// otherwise trace.output.result_ids, otherwise the last ranking step).
export function rankingColumns(trace) {
  const columns = []
  for (const step of findSteps(trace, 'retrieve')) {
    if (itemsOf(step).length) columns.push({ id: step.id ?? `retrieve-${columns.length}`, kind: 'retrieve', impl: step.impl ?? null, step })
  }
  const fuse = findStep(trace, 'fuse')
  if (fuse && itemsOf(fuse).length) columns.push({ id: fuse.id ?? 'fuse', kind: 'fuse', impl: fuse.impl ?? null, step: fuse })
  const rerank = findStep(trace, 'rerank')
  if (rerank && itemsOf(rerank).length) {
    columns.push({ id: 'final', kind: 'final', impl: rerank.impl ?? 'rerank', step: rerank })
  } else if (Array.isArray(trace?.output?.result_ids) && trace.output.result_ids.length) {
    columns.push({ id: 'final', kind: 'final', impl: null, step: null, ids: trace.output.result_ids.map(String) })
  }
  return columns
}

function columnRanks(column) {
  const ranks = new Map()
  if (column.ids) {
    column.ids.forEach((id, index) => ranks.set(id, { rank: index + 1, score: null, item: null }))
    return ranks
  }
  itemsOf(column.step).forEach((item, index) => {
    const rank = Number.isFinite(Number(item.rank)) ? Number(item.rank) : index + 1
    ranks.set(String(item.id), { rank, score: Number.isFinite(Number(item.score)) ? Number(item.score) : null, item })
  })
  return ranks
}

export function rankingTable(trace, { limit = 20, titles = {} } = {}) {
  const columns = rankingColumns(trace)
  const byColumn = columns.map(columnRanks)
  const fuseIndex = columns.findIndex((c) => c.kind === 'fuse')
  const finalIndex = columns.findIndex((c) => c.kind === 'final')
  const order = []
  const seen = new Set()
  const push = (id) => {
    if (!seen.has(id)) {
      seen.add(id)
      order.push(id)
    }
  }
  const primary = finalIndex >= 0 ? byColumn[finalIndex] : fuseIndex >= 0 ? byColumn[fuseIndex] : byColumn[0]
  if (primary) [...primary.entries()].sort((a, b) => a[1].rank - b[1].rank).forEach(([id]) => push(id))
  for (const map of byColumn) [...map.entries()].sort((a, b) => a[1].rank - b[1].rank).forEach(([id]) => push(id))

  const rows = order.slice(0, limit).map((id) => {
    const ranks = {}
    const scores = {}
    let title = titles[id] ?? null
    let contributions = null
    let formula = null
    let rerank = null
    columns.forEach((column, i) => {
      const entry = byColumn[i].get(id)
      ranks[column.id] = entry?.rank ?? null
      scores[column.id] = entry?.score ?? null
      if (!title && entry?.item?.title) title = entry.item.title
      if (column.kind === 'fuse' && entry?.item?.details) {
        contributions = entry.item.details.contributions ?? null
        formula = entry.item.details.formula ?? null
      }
      if (column.kind === 'final' && entry?.item?.details && column.step?.step === 'rerank') {
        const d = entry.item.details
        rerank = { before: d.before_rank ?? null, after: d.after_rank ?? entry.rank, score: d.reranker_score ?? entry.score }
      }
    })
    // Retrieve-step item lists are capped for display; the fused item's contributions carry the
    // true per-ranking rank even when that candidate is below the cap.
    columns.forEach((column) => {
      const fromFusion = contributions?.[column.id]
      if (ranks[column.id] == null && column.kind === 'retrieve' && fromFusion && Number.isFinite(Number(fromFusion.rank))) {
        ranks[column.id] = Number(fromFusion.rank)
      }
    })
    return { id, title: title || id, ranks, scores, contributions, formula, rerank }
  })
  return { columns: columns.map(({ id, kind, impl }) => ({ id, kind, impl })), rows }
}

// Reciprocal Rank Fusion with real numbers for one product.
export function rrfBreakdown(row, k = DEFAULT_RRF_K) {
  if (!row?.contributions || typeof row.contributions !== 'object') return null
  const terms = Object.entries(row.contributions)
    .filter(([, c]) => c && Number.isFinite(Number(c.rank)))
    .map(([ranking, c]) => {
      const rank = Number(c.rank)
      const value = Number.isFinite(Number(c.score)) ? Number(c.score) : 1 / (k + rank)
      return { ranking, rank, value }
    })
  if (!terms.length) return null
  const total = terms.reduce((sum, term) => sum + term.value, 0)
  return {
    k,
    terms,
    symbolic: row.formula || terms.map((term) => `1/(${k}+${term.rank})`).join(' + '),
    denominators: terms.map((term) => `1/${k + term.rank}`).join(' + '),
    values: terms.map((term) => term.value.toFixed(6)).join(' + '),
    total: Number(total.toFixed(6)),
  }
}

export function fuseK(trace) {
  const k = Number(findStep(trace, 'fuse')?.params?.k)
  return Number.isFinite(k) && k > 0 ? k : DEFAULT_RRF_K
}

// SVG geometry for the rank-movement chart: one polyline per product across the columns.
// Ranks beyond `maxRank` (or missing) sit on an "outside" band under the last row.
export function rankMovementLayout(table, { width = 640, height = 320, padding = { top: 28, right: 24, bottom: 28, left: 36 }, maxRows = 10 } = {}) {
  const columns = table?.columns || []
  const rows = (table?.rows || []).slice(0, maxRows)
  const ranks = rows.flatMap((row) => Object.values(row.ranks)).filter((r) => Number.isFinite(r))
  const maxRank = Math.max(rows.length, Math.min(20, ranks.length ? Math.max(...ranks) : 1))
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const outsideY = padding.top + innerH
  const yFor = (rank) => padding.top + ((rank - 1) / Math.max(1, maxRank)) * (innerH - innerH / (maxRank + 1))
  const xs = columns.map((_, i) => (columns.length === 1 ? padding.left + innerW / 2 : padding.left + (i / (columns.length - 1)) * innerW))
  const lines = rows.map((row) => ({
    id: row.id,
    title: row.title,
    points: columns.map((column, i) => {
      const rank = row.ranks[column.id]
      const inside = Number.isFinite(rank) && rank <= maxRank
      return { x: Math.round(xs[i] * 10) / 10, y: Math.round((inside ? yFor(rank) : outsideY) * 10) / 10, rank: Number.isFinite(rank) ? rank : null, outside: !inside }
    }),
  }))
  const ticks = Array.from({ length: Math.min(maxRank, 10) }, (_, i) => {
    const rank = maxRank <= 10 ? i + 1 : Math.round(1 + (i * (maxRank - 1)) / 9)
    return { rank, y: Math.round(yFor(rank) * 10) / 10 }
  })
  return {
    width,
    height,
    maxRank,
    outsideY,
    columns: columns.map((column, i) => ({ ...column, x: Math.round(xs[i] * 10) / 10 })),
    lines,
    ticks,
  }
}

// --- Matched terms tab ------------------------------------------------------------------

export function matchedTermsView(trace, { titles = {} } = {}) {
  const lexical = findSteps(trace, 'retrieve').find((s) => itemsOf(s).some((item) => item.details?.matched_terms))
  if (!lexical) return { stepId: null, rows: [] }
  const rows = itemsOf(lexical).map((item) => {
    const fields = Object.entries(item.details?.matched_terms || {})
      .map(([field, terms]) => [field, toList(terms)])
      .filter(([, terms]) => terms.length)
    return {
      id: String(item.id),
      title: item.title ?? titles[item.id] ?? String(item.id),
      rank: item.rank ?? null,
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
      fields: Object.fromEntries(fields),
      allTerms: [...new Set(fields.flatMap(([, terms]) => terms))],
    }
  })
  return { stepId: lexical.id ?? 'lexical', impl: lexical.impl ?? null, rows }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Splits `text` into [{text, match}] highlighting words that start with any term
// (so the stemmed term "boot" highlights "Boots"). Case-insensitive, Unicode-aware.
export function highlightSegments(text, terms = []) {
  const source = String(text ?? '')
  const clean = [...new Set((terms || []).map((t) => String(t).trim()).filter((t) => /[\p{L}\p{N}]/u.test(t)))].sort((a, b) => b.length - a.length)
  if (!source || !clean.length) return source ? [{ text: source, match: false }] : []
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${clean.map(escapeRegExp).join('|')})[\\p{L}\\p{N}]*`, 'giu')
  const segments = []
  let last = 0
  for (const match of source.matchAll(pattern)) {
    if (match.index > last) segments.push({ text: source.slice(last, match.index), match: false })
    segments.push({ text: match[0], match: true })
    last = match.index + match[0].length
  }
  if (last < source.length) segments.push({ text: source.slice(last), match: false })
  return segments
}

// --- ES query tab -----------------------------------------------------------------------

export function queryDslView(trace) {
  const step = findSteps(trace, 'retrieve').find((s) => s.details?.query_dsl)
  return step ? { stepId: step.id ?? 'lexical', impl: step.impl ?? null, dsl: step.details.query_dsl } : null
}

// --- Compose (F1) ---------------------------------------------------------------------

export function composeView(trace) {
  const step = findStep(trace, 'compose_query')
  if (!step) return null
  const d = step.details || {}
  const alpha = Number.isFinite(Number(d.alpha)) ? Number(d.alpha) : Number(step.params?.alpha)
  return {
    alpha: Number.isFinite(alpha) ? alpha : null,
    formula: d.formula ?? 'q = normalize(α·e_img + (1−α)·e_text)',
    image: d.image_vector ?? null,
    text: d.text_vector ?? null,
    query: d.query_vector ?? null,
    summary: step.summary ?? '',
  }
}
