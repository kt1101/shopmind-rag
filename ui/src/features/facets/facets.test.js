import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeFacet, normalizeFacet } from './facets.js'

test('normalizes facet buckets and filter-option strings', () => {
  assert.deepEqual(normalizeFacet(['a', { value: 'b', count: 2 }, { value: '' }, null, { value: 'c', count: 'x' }]),
    [{ value: 'a', count: null }, { value: 'b', count: 2 }, { value: 'c', count: null }])
  assert.deepEqual(normalizeFacet(undefined), [])
})

test('selected values missing from the facets stay visible', () => {
  assert.deepEqual(mergeFacet([{ value: 'a', count: 3 }], ['z', 'a']), [{ value: 'z', count: 0 }, { value: 'a', count: 3 }])
  assert.deepEqual(mergeFacet(['a'], ['z']), [{ value: 'z', count: null }, { value: 'a', count: null }])
})
