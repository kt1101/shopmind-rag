import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPlaygroundParams, crossRanks, formatRatio, overlapAtK, parsePlaygroundParams, pipelinesToRun } from './playground.js'

const r = (...idList) => idList.map((product_id, i) => ({ product_id, rank: i + 1 }))

test('playground URL state round-trips and sanitises', () => {
  const state = { query: ' ba lô ', pipelineA: 'search.bm25', pipelineB: 'search.dense', topK: 20, filters: { category: 'backpacks', brand: '' } }
  const params = buildPlaygroundParams(state)
  assert.equal(params.toString(), 'q=ba+l%C3%B4&a=search.bm25&b=search.dense&k=20&category=backpacks')
  assert.deepEqual(parsePlaygroundParams(params), { query: 'ba lô', pipelineA: 'search.bm25', pipelineB: 'search.dense', topK: 20, filters: { category: 'backpacks', brand: '' } })
  assert.equal(parsePlaygroundParams('k=7').topK, 10, 'unknown top-k falls back')
  assert.equal(parsePlaygroundParams('a=x&b=x').pipelineB, '', 'B equal to A means a single pipeline')
  assert.equal(buildPlaygroundParams({ pipelineA: 'x', pipelineB: 'x', topK: 10 }).toString(), 'a=x')
})

test('pipelines to run: one or two distinct names', () => {
  assert.deepEqual(pipelinesToRun({ pipelineA: 'a', pipelineB: 'b' }), ['a', 'b'])
  assert.deepEqual(pipelinesToRun({ pipelineA: 'a', pipelineB: '' }), ['a'])
  assert.deepEqual(pipelinesToRun({ pipelineA: 'a', pipelineB: 'a' }), ['a'])
  assert.deepEqual(pipelinesToRun({}), [])
})

test('overlap@k counts shared ids in the two top-k lists', () => {
  const a = r('p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11')
  const b = r('p3', 'p1', 'x1', 'x2', 'p5', 'x3', 'x4', 'x5', 'x6', 'x7', 'p11')
  const o = overlapAtK(a, b, 10)
  assert.equal(o.shared, 3, 'p11 is outside both top-10s')
  assert.equal(o.ratio, 0.3)
  assert.deepEqual(o.sharedIds, ['p1', 'p3', 'p5'])
  assert.equal(o.onlyA.length, 7)
  assert.equal(overlapAtK(r('a', 'b', 'c'), r('c', 'b', 'a')).ratio, 1, 'short identical lists overlap fully')
  assert.equal(overlapAtK([], []).ratio, null)
  assert.equal(overlapAtK(r('a'), []).ratio, 0)
  assert.equal(formatRatio(0.3), '30%')
  assert.equal(formatRatio(null), '—')
})

test('cross ranks show where each result sits in the other list', () => {
  assert.deepEqual(crossRanks(r('a', 'b', 'c'), r('c', 'a')), [
    { productId: 'a', rank: 1, otherRank: 2, delta: 1 },
    { productId: 'b', rank: 2, otherRank: null, delta: null },
    { productId: 'c', rank: 3, otherRank: 1, delta: -2 },
  ])
  assert.deepEqual(crossRanks(null, null), [])
})
