import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanFilters, normalizeOptions } from './filters.js'

test('filter options accept the contract shape (strings) and the backend shape ({value, count})', () => {
  assert.deepEqual(normalizeOptions(['A', 'B', 'A', '']), [{ value: 'A', count: null }, { value: 'B', count: null }])
  assert.deepEqual(normalizeOptions([{ value: 'SHOES', count: 150 }, { value: 'SHOES', count: 1 }, { count: 3 }, null]), [{ value: 'SHOES', count: 150 }])
  assert.deepEqual(normalizeOptions(undefined), [])
})

test('cleanFilters trims, dedupes and drops blanks', () => {
  assert.deepEqual(cleanFilters({ brand: ' x ', category: ['a', 'a', ' ', 'b'], color: [], empty: '' }), { brand: 'x', category: ['a', 'b'] })
})
