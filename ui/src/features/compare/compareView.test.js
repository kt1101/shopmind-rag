import assert from 'node:assert/strict'
import test from 'node:test'
import { compareTable, pointAsAnswer, withoutId } from './compareView.js'
import { compareEngine } from '../../mocks/ragEngine.js'

test('null, empty and missing values render as "no data"', () => {
  const data = {
    products: [{ product_id: 'A' }, { product_id: 'B' }],
    attributes: [
      { name: 'Color', values: { A: 'Black', B: null } },
      { name: 'Weight', values: { A: '200g', B: '200G' } },
      { name: 'Size', values: { A: '', B: undefined } },
      { values: {} },
    ],
  }
  const { rows } = compareTable(data, 'N/A')
  assert.deepEqual(rows.map((r) => r.name), ['Color', 'Weight', 'Size'])
  assert.deepEqual(rows[0].cells, [{ productId: 'A', value: 'Black', missing: false }, { productId: 'B', value: 'N/A', missing: true }])
  assert.equal(rows[1].differs, false, 'case-insensitive equality')
  assert.equal(rows[2].allMissing, true)
  assert.deepEqual(compareTable(null), { products: [], rows: [] })
})

test('points become answer text with citation markers', () => {
  assert.equal(pointAsAnswer({ text: 'A is lighter.', citation_ids: ['c1', 'c2'] }), 'A is lighter. [c1][c2]')
  assert.equal(pointAsAnswer({ text: 'x' }), 'x')
  assert.deepEqual(withoutId(['a', 'b'], 'a'), ['b'])
})

test('works on the mock compare response', () => {
  const data = compareEngine({ product_ids: ['M-001', 'M-024'] })
  const { rows } = compareTable(data)
  assert.ok(rows.find((r) => r.name === 'Color').cells.some((c) => c.missing && c.value === 'Không có dữ liệu'))
})
