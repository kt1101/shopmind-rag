import test from 'node:test'
import assert from 'node:assert/strict'
import { bandScale, barPath, formatTick, labelIndexes, linePath, linearScale, niceStep, niceTicks, zeroBasedTicks } from './scale.js'

test('linearScale maps domain to range (inverted y ok)', () => {
  const y = linearScale([0, 100], [200, 0])
  assert.equal(y(0), 200)
  assert.equal(y(50), 100)
  assert.equal(y(100), 0)
  assert.equal(linearScale([5, 5], [0, 10])(5), 5)
})

test('niceStep snaps to 1/2/2.5/5 x 10^n', () => {
  assert.equal(niceStep(0.7), 1)
  assert.equal(niceStep(1.3), 2)
  assert.equal(niceStep(2.2), 2.5)
  assert.equal(niceStep(3), 5)
  assert.equal(niceStep(7), 10)
  assert.equal(niceStep(23), 25)
  assert.equal(niceStep(0.013), 0.02)
  assert.equal(niceStep(0), 1)
})

test('niceTicks covers the data with round ticks', () => {
  assert.deepEqual(niceTicks(0, 97, 5), { min: 0, max: 100, step: 25, ticks: [0, 25, 50, 75, 100] })
  const t = niceTicks(0, 0.83, 5)
  assert.equal(t.min, 0)
  assert.ok(t.max >= 0.83)
  assert.deepEqual(t.ticks, [0, 0.25, 0.5, 0.75, 1])
  assert.deepEqual(niceTicks(0, 0).ticks, [0, 0.25, 0.5, 0.75, 1])
  assert.deepEqual(niceTicks(10, 0).ticks, niceTicks(0, 10).ticks)
  assert.deepEqual(niceTicks(NaN, 1).ticks, [0, 1])
  const flat = niceTicks(50, 50)
  assert.ok(flat.min <= 50 && flat.max >= 50 && flat.ticks.length > 1)
})

test('zeroBasedTicks always includes zero', () => {
  assert.equal(zeroBasedTicks([12, 40, 33]).min, 0)
  assert.equal(zeroBasedTicks([12, 40, 33]).max, 40)
  assert.deepEqual(zeroBasedTicks([]).ticks, [0, 0.25, 0.5, 0.75, 1])
})

test('bandScale spaces categories evenly', () => {
  const x = bandScale(['a', 'b'], [0, 100], 0.2)
  assert.equal(x.step, 50)
  assert.equal(x.bandwidth, 40)
  assert.equal(x('a'), 5)
  assert.equal(x('b'), 55)
})

test('formatTick abbreviates', () => {
  assert.equal(formatTick(1500), '1.5k')
  assert.equal(formatTick(2_000_000), '2M')
  assert.equal(formatTick(0.12345), '0.123')
  assert.equal(formatTick(12), '12')
  assert.equal(formatTick(NaN), '')
})

test('labelIndexes thins long axes', () => {
  assert.deepEqual(labelIndexes(3, 7), [0, 1, 2])
  const idx = labelIndexes(30, 7)
  assert.equal(idx[0], 0)
  assert.equal(idx[idx.length - 1], 29)
  assert.ok(idx.length <= 7)
})

test('linePath and barPath build SVG paths', () => {
  assert.equal(linePath([[0, 0], [10, 5], [NaN, 1]]), 'M0.0,0.0 L10.0,5.0')
  assert.equal(barPath(0, 0, 10, 0), '')
  assert.match(barPath(0, 10, 20, 50), /^M0,60 V14/)
})
