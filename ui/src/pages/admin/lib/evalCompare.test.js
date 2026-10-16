import test from 'node:test'
import assert from 'node:assert/strict'
import { compareChartData, compareMetricKeys, normalizeMetricKey, numericMetrics, toggleSelection } from './evalCompare.js'

test('normalizeMetricKey', () => {
  assert.equal(normalizeMetricKey('Recall@10'), 'recall@10')
  assert.equal(normalizeMetricKey('ndcg_at_10'), 'ndcg@10')
})

test('numericMetrics keeps numbers and prefers overall', () => {
  assert.deepEqual(numericMetrics({ 'Recall@10': 0.5, note: 'x', n: NaN }), { 'recall@10': 0.5 })
  assert.deepEqual(numericMetrics({ overall: { mrr_at_10: 0.3 }, by_lang: {} }), { 'mrr@10': 0.3 })
  assert.deepEqual(numericMetrics(null), {})
})

test('compareMetricKeys puts A1 metrics first', () => {
  const runs = [
    { metrics: { faithfulness: 0.8, 'mrr@10': 0.4 } },
    { metrics: { 'recall@10': 0.6, citation_precision: 0.7 } },
  ]
  assert.deepEqual(compareMetricKeys(runs), ['recall@10', 'mrr@10', 'faithfulness', 'citation_precision'])
})

test('compareChartData builds series per run with nulls for missing', () => {
  const data = compareChartData([
    { id: 'a', name: 'bm25', metrics: { 'recall@10': 0.5, 'ndcg@10': 0.4 } },
    { id: 'b', metrics: { 'recall@10': 0.6 } },
  ])
  assert.deepEqual(data.categories, ['Recall@10', 'nDCG@10'])
  assert.deepEqual(data.series, [
    { name: 'bm25', values: [0.5, 0.4] },
    { name: 'b', values: [0.6, null] },
  ])
})

test('toggleSelection caps at 4', () => {
  assert.deepEqual(toggleSelection([], 'a'), ['a'])
  assert.deepEqual(toggleSelection(['a', 'b'], 'a'), ['b'])
  assert.deepEqual(toggleSelection(['a', 'b', 'c', 'd'], 'e'), ['b', 'c', 'd', 'e'])
})
