// Helpers for the Evaluation Center compare view.

export const A1_METRICS = ['recall@10', 'ndcg@10', 'mrr@10']
export const METRIC_LABELS = {
  'recall@10': 'Recall@10',
  'ndcg@10': 'nDCG@10',
  'mrr@10': 'MRR@10',
  context_recall: 'Context recall',
  citation_precision: 'Citation precision',
  citation_recall: 'Citation recall',
  faithfulness: 'Faithfulness',
  answer_relevance: 'Answer relevance',
  abstain_accuracy: 'Abstain accuracy',
}
export const MAX_COMPARE = 4
export const MIN_COMPARE = 2

// Accepts "Recall@10", "recall_at_10", "recall@10" -> "recall@10".
export function normalizeMetricKey(key) {
  return String(key).trim().toLowerCase().replace(/_at_(\d+)$/, '@$1')
}

// Flattens metrics; supports {recall@10: x} and nested {overall: {...}} by taking `overall` if present.
export function numericMetrics(metrics) {
  const source = metrics && typeof metrics.overall === 'object' && metrics.overall ? metrics.overall : metrics || {}
  const out = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[normalizeMetricKey(key)] = value
  }
  return out
}

// Metric keys to compare: A1 metrics first (when any run has them), then others present in
// any selected run, in first-seen order.
export function compareMetricKeys(runs) {
  const seen = []
  for (const run of runs) {
    for (const key of Object.keys(numericMetrics(run.metrics))) if (!seen.includes(key)) seen.push(key)
  }
  const a1 = A1_METRICS.filter((k) => seen.includes(k))
  return [...a1, ...seen.filter((k) => !A1_METRICS.includes(k))]
}

export function metricLabel(key) {
  return METRIC_LABELS[key] || key
}

// Grouped-bar data: categories = metrics, series = runs.
export function compareChartData(runs) {
  const keys = compareMetricKeys(runs)
  return {
    categories: keys.map(metricLabel),
    series: runs.map((run) => {
      const metrics = numericMetrics(run.metrics)
      return { name: run.name || run.id, values: keys.map((k) => metrics[k] ?? null) }
    }),
  }
}

// Toggling selection keeps order and caps at MAX_COMPARE (oldest pick is dropped).
export function toggleSelection(selected, id, max = MAX_COMPARE) {
  if (selected.includes(id)) return selected.filter((s) => s !== id)
  const next = [...selected, id]
  return next.length > max ? next.slice(next.length - max) : next
}
