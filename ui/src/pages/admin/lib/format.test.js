import test from 'node:test'
import assert from 'node:assert/strict'
import { formatCount, formatDelta, formatKappa, formatMetric, formatMs, formatPercent, positiveRate } from './format.js'

test('formatKappa labels Landis & Koch bands', () => {
  assert.deepEqual(formatKappa(0.72, 40), { value: '0.72', label: 'Substantial', tone: 'good', detail: '40 paired judgments' })
  assert.equal(formatKappa(0.5).label, 'Moderate')
  assert.equal(formatKappa(0.3).label, 'Fair')
  assert.equal(formatKappa(0.1).label, 'Slight')
  assert.equal(formatKappa(0.95).label, 'Almost perfect')
  assert.equal(formatKappa(1).label, 'Almost perfect')
  assert.equal(formatKappa(-0.2).label, 'Poor')
  assert.equal(formatKappa(-0.2).value, '-0.20')
  assert.equal(formatKappa(1, 1).detail, '1 paired judgment')
})

test('formatKappa handles missing kappa', () => {
  const f = formatKappa(null)
  assert.equal(f.value, '—')
  assert.equal(f.tone, 'neutral')
  assert.equal(formatKappa(undefined, 3).detail, '3 paired judgments')
  assert.equal(formatKappa('nope').value, '—')
})

test('number formatters', () => {
  assert.equal(formatPercent(0.1234), '12.3%')
  assert.equal(formatPercent(null), '—')
  assert.equal(formatCount(12345), '12,345')
  assert.equal(formatMs(5.24), '5.2 ms')
  assert.equal(formatMs(63.4), '63 ms')
  assert.equal(formatMs(1500), '1.50 s')
  assert.equal(formatMetric(0.12345), '0.123')
  assert.equal(formatMetric(undefined), '—')
})

test('formatDelta signs differences', () => {
  assert.deepEqual(formatDelta(0.5, 0.4), { text: '+0.100', sign: 1 })
  assert.deepEqual(formatDelta(0.4, 0.5), { text: '−0.100', sign: -1 })
  assert.deepEqual(formatDelta(0.4, 0.4), { text: '+0.000', sign: 0 })
  assert.deepEqual(formatDelta(undefined, 0.4), { text: '—', sign: 0 })
})

test('positiveRate', () => {
  assert.equal(positiveRate({ feedback_positive: 3, feedback_negative: 1 }), 0.75)
  assert.equal(positiveRate({}), null)
})
