import assert from 'node:assert/strict'
import test from 'node:test'
import { categoryColors, categoryCounts, extent, makeScale, nearestPoint, neighbourhoodRatio, validPoints } from './mapModel.js'
import { embeddingMap, projectQuery } from '../../mocks/embeddingEngine.js'

const PTS = [
  { product_id: 'a', x: 0, y: 0, category: 'shoes' },
  { product_id: 'b', x: 10, y: 5, category: 'bags' },
  { product_id: 'c', x: 5, y: 10, category: 'shoes' },
  { product_id: 'bad', x: NaN, y: 1 },
]

test('extent pads the box and includes extra points', () => {
  assert.equal(validPoints(PTS).length, 3)
  const box = extent(PTS, [{ x: 20, y: -5 }], 0)
  assert.deepEqual(box, { minX: 0, maxX: 20, minY: -5, maxY: 10 })
  assert.deepEqual(extent([]), { minX: -1, maxX: 1, minY: -1, maxY: 1 })
  const flat = extent([{ x: 1, y: 1 }], [], 0)
  assert.ok(flat.maxX > flat.minX && flat.maxY > flat.minY)
})

test('scale keeps aspect ratio and flips y', () => {
  const s = makeScale({ minX: 0, maxX: 10, minY: 0, maxY: 10 }, 220, 120, 10)
  assert.equal(s.x(0), 60)
  assert.equal(s.x(10), 160)
  assert.equal(s.y(10), 10)
  assert.equal(s.y(0), 110)
})

test('colours, counts, nearest point and neighbourhood ratio', () => {
  assert.deepEqual(categoryColors(PTS), { bags: 'var(--viz-series-1)', shoes: 'var(--viz-series-2)' })
  assert.deepEqual(categoryCounts(PTS), [{ category: 'shoes', count: 2 }, { category: 'bags', count: 1 }])
  const projected = [{ sx: 0, sy: 0, id: 1 }, { sx: 10, sy: 0, id: 2 }]
  assert.equal(nearestPoint(projected, 8, 1).id, 2)
  assert.equal(nearestPoint(projected, 50, 50), null)
  assert.equal(neighbourhoodRatio(PTS, { x: 0, y: 0 }, ['a']), 0)
  assert.equal(neighbourhoodRatio(PTS, null, ['a']), null)
})

test('the mock text space separates categories better than the SigLIP text space', () => {
  const ratio = (space) => {
    const map = embeddingMap(space)
    const q = projectQuery({ space, query: 'ba lô' })
    const ids = map.points.filter((p) => p.category === 'backpacks').map((p) => p.product_id)
    return neighbourhoodRatio(map.points, q, ids)
  }
  assert.ok(ratio('text') < ratio('siglip_text'))
})
