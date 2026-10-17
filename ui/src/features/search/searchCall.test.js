import assert from 'node:assert/strict'
import test from 'node:test'
import { applyUnderstood, buildSearchCall, pendingUnderstood } from './searchCall.js'

const filters = { category: [], brand: ['Acme'], color: [] }
const file = { name: 'a.png' }

test('maps text, image and compose searches to API calls', () => {
  assert.deepEqual(buildSearchCall({ type: 'text', query: 'boots', mode: 'bm25', filters }, null, { explain: true }),
    { kind: 'text', args: { query: 'boots', mode: 'bm25', topK: 20, filters, explain: true } })
  assert.equal(buildSearchCall({ type: 'image', filters }, file).kind, 'image')
  assert.deepEqual(buildSearchCall({ type: 'compose', query: 'đen', alpha: 0.3, filters }, file).args, { file, text: 'đen', alpha: 0.3, topK: 20, explain: false })
  assert.equal(buildSearchCall({ type: 'compose', query: 'đen', filters }, null), null, 'needs the image')
  assert.equal(buildSearchCall({ type: null }, file), null)
})

test('understood filters: only the ones not applied yet, merged on apply', () => {
  const pending = pendingUnderstood({ filters: { category: ['hiking_boots'], brand: 'Acme', color: ['brown'] } }, filters)
  assert.deepEqual(pending, [{ field: 'category', values: ['hiking_boots'] }, { field: 'color', values: ['brown'] }])
  assert.deepEqual(applyUnderstood(filters, pending), { category: ['hiking_boots'], brand: ['Acme'], color: ['brown'] })
  assert.deepEqual(pendingUnderstood(null, filters), [])
})
