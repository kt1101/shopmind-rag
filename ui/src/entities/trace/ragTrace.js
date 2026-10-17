// RAG / chat / compare trace view models for the RAG Inspector: candidates per source,
// the context actually sent, generation details, citation validation attempts.
// See docs/API_CONTRACT.md "RAG-specific step details".

import { findStep, itemsOf } from './traceModel.js'

const SOURCE_ORDER = ['product', 'review', 'policy']

function sourceOf(item) {
  if (item?.details?.source) return String(item.details.source)
  if (item?.source) return String(item.source)
  const prefix = String(item?.id ?? '').split(':')[0]
  return prefix && prefix !== String(item?.id) ? prefix : 'other'
}

export function candidatesBySource(trace) {
  const step = findStep(trace, 'multi_source_retrieve') || findStep(trace, 'retrieve')
  const groups = new Map()
  for (const item of itemsOf(step)) {
    const source = sourceOf(item)
    if (!groups.has(source)) groups.set(source, [])
    groups.get(source).push({
      id: String(item.id),
      title: item.title ?? String(item.id),
      rank: item.rank ?? null,
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
      snippet: item.details?.snippet ?? item.details?.text ?? null,
    })
  }
  return [...groups.entries()]
    .sort((a, b) => rankSource(a[0]) - rankSource(b[0]))
    .map(([source, items]) => ({ source, items: items.sort((x, y) => (x.rank ?? 1e9) - (y.rank ?? 1e9)) }))
}

function rankSource(source) {
  const index = SOURCE_ORDER.indexOf(source)
  return index === -1 ? SOURCE_ORDER.length : index
}

export function contextView(trace) {
  const step = findStep(trace, 'build_context')
  if (!step) return null
  const d = step.details || {}
  const titles = new Map(candidatesBySource(trace).flatMap((g) => g.items.map((i) => [i.id, i.title])))
  const documents = (Array.isArray(d.documents) ? d.documents : []).map((doc) => ({
    id: String(doc.id),
    source: doc.source ?? sourceOf(doc),
    title: titles.get(String(doc.id)) ?? String(doc.id),
    chars: Number(doc.chars) || 0,
    included: Boolean(doc.included),
    reason: doc.reason ?? (doc.included ? 'included' : null),
  }))
  const budget = Number(d.budget) || null
  const rendered = Number(d.rendered_chars) || documents.filter((x) => x.included).reduce((s, x) => s + x.chars, 0)
  return {
    documents,
    includedCount: documents.filter((x) => x.included).length,
    renderedChars: rendered,
    budget,
    usedPct: budget ? Math.min(100, Math.round((rendered / budget) * 100)) : null,
  }
}

export function generateView(trace) {
  const step = findStep(trace, 'generate')
  if (!step) return null
  const d = step.details || {}
  let raw = d.raw_output ?? null
  if (typeof raw === 'string') {
    try {
      raw = JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      // keep the raw string
    }
  } else if (raw && typeof raw === 'object') {
    raw = JSON.stringify(raw, null, 2)
  }
  return {
    model: d.model ?? step.params?.model ?? null,
    promptId: d.prompt_id ?? null,
    promptVersion: d.prompt_version ?? null,
    attempt: d.attempt ?? null,
    inputTokens: d.usage?.input_tokens ?? null,
    outputTokens: d.usage?.output_tokens ?? null,
    rawOutput: raw,
    summary: step.summary ?? '',
  }
}

export function citationAttempts(trace) {
  const step = findStep(trace, 'validate_citations')
  const attempts = Array.isArray(step?.details?.attempts) ? step.details.attempts : []
  return attempts.map((a, index) => ({ attempt: a.attempt ?? index + 1, valid: Boolean(a.valid), error: a.error ?? null }))
}

export function rewriteView(trace) {
  const step = findStep(trace, 'rewrite')
  const route = findStep(trace, 'route_intent')
  if (!step && !route) return null
  return {
    original: step?.details?.original ?? trace?.input?.message ?? null,
    standalone: step?.details?.standalone_question ?? null,
    fallback: Boolean(step?.details?.fallback),
    intent: route?.details?.intent ?? trace?.output?.intent ?? null,
    intentReason: route?.details?.reason ?? null,
  }
}
