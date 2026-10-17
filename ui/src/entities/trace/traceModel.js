// Trace -> view-model helpers shared by the Search and RAG inspectors.
// Input: the Trace schema of docs/API_CONTRACT.md. Every helper tolerates missing fields,
// because the Inspector renders whatever the backend chose to record.

const round = (value, digits = 1) => (Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null)

export function stepsOf(trace) {
  return Array.isArray(trace?.steps) ? trace.steps.filter((s) => s && typeof s === 'object') : []
}

export function findStep(trace, stepName) {
  return stepsOf(trace).find((s) => s.step === stepName) || null
}

export function findSteps(trace, stepName) {
  return stepsOf(trace).filter((s) => s.step === stepName)
}

export function itemsOf(step) {
  return Array.isArray(step?.output?.items) ? step.output.items.filter((i) => i && i.id != null) : []
}

export function traceSummary(trace) {
  if (!trace) return null
  return {
    traceId: trace.trace_id ?? null,
    pipeline: trace.pipeline ?? null,
    kind: trace.kind ?? null,
    createdAt: trace.created_at ?? null,
    durationMs: round(Number(trace.duration_ms)),
    stepCount: stepsOf(trace).length,
  }
}

export const SEARCH_KINDS = new Set(['search', 'image_search', 'compose_search'])
export function isSearchTrace(trace) {
  return SEARCH_KINDS.has(trace?.kind) || (!trace?.kind && stepsOf(trace).some((s) => s.step === 'retrieve'))
}

// Waterfall of step timings. Steps without started_ms are laid out sequentially.
export function waterfall(trace) {
  let cursor = 0
  const rows = stepsOf(trace).map((s, index) => {
    const duration = Math.max(0, Number(s.duration_ms) || 0)
    const start = Number.isFinite(Number(s.started_ms)) && s.started_ms !== null ? Number(s.started_ms) : cursor
    cursor = Math.max(cursor, start + duration)
    return {
      key: `${s.id ?? s.step}-${index}`,
      id: s.id ?? s.step ?? `step-${index}`,
      step: s.step ?? 'step',
      impl: s.impl ?? null,
      summary: s.summary ?? '',
      start: round(start),
      duration: round(duration),
      end: round(start + duration),
    }
  })
  const total = Math.max(Number(trace?.duration_ms) || 0, ...rows.map((r) => r.end), 0)
  for (const row of rows) {
    row.offsetPct = total ? round((row.start / total) * 100, 2) : 0
    row.widthPct = total ? Math.max(round((row.duration / total) * 100, 2), 0.4) : 0
  }
  return { total: round(total), rows }
}

// Evenly spaced axis ticks for the waterfall.
export function timeTicks(total, count = 4) {
  if (!(total > 0)) return [0]
  const raw = total / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) || raw
  const ticks = []
  for (let v = 0; v <= total + 1e-9; v += step) ticks.push(round(v, 2))
  return ticks
}
