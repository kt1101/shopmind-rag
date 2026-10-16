import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SEARCH_MODES,
  parseFilters,
  parseSearch,
  buildCatalogUrl,
  buildSearchUrl,
  productPath,
} from './urlState.js'

test('SEARCH_MODES keys, labels, and order match constraints', () => {
  assert.deepEqual(Object.keys(SEARCH_MODES), ['hybrid', 'bm25', 'dense', 'cross_modal'])
  assert.deepEqual(SEARCH_MODES, {
    hybrid: 'Hybrid',
    bm25: 'BM25',
    dense: 'Dense text',
    cross_modal: 'Cross-modal',
  })
})

test('parseFilters reads repeated params, trims and dedupes', () => {
  const p = new URLSearchParams('category=shoes&category=%20shoes%20&category=&brand=Acme&x=1')
  assert.deepEqual(parseFilters(p), { category: ['shoes'], brand: ['Acme'] })
})

test('parseSearch detects text, image and empty searches', () => {
  assert.deepEqual(parseSearch(new URLSearchParams('q=%20boots%20&mode=bm25')),
    { type: 'text', query: 'boots', mode: 'bm25', filters: { category: [], brand: [] } })
  assert.equal(parseSearch(new URLSearchParams('type=image&q=ignored')).type, 'image')
  assert.equal(parseSearch(new URLSearchParams('q=%20%20')).type, null)
})

test('parseSearch falls back to hybrid for unknown modes', () => {
  assert.equal(parseSearch(new URLSearchParams('q=a&mode=image_dense')).mode, 'hybrid')
  assert.equal(parseSearch(new URLSearchParams('q=a')).mode, 'hybrid')
})

test('buildCatalogUrl serializes filters or returns root', () => {
  assert.equal(buildCatalogUrl({ category: [], brand: [] }), '/')
  assert.equal(buildCatalogUrl({ category: ['a', 'b'], brand: ['X'] }), '/?category=a&category=b&brand=X')
})

test('buildSearchUrl builds text and image URLs', () => {
  assert.equal(buildSearchUrl({ type: 'text', query: 'black shoes', mode: 'dense', filters: { category: ['shoes'], brand: [] } }),
    '/search?q=black+shoes&mode=dense&category=shoes')
  assert.equal(buildSearchUrl({ type: 'image', filters: { category: [], brand: ['Acme'] } }), '/search?type=image&brand=Acme')
})

test('filter values with reserved characters round-trip', () => {
  const filters = { category: ['Shoes & Gear'], brand: ['Café+Co'] }
  const url = buildSearchUrl({ type: 'text', query: 'a', mode: 'hybrid', filters })
  assert.deepEqual(parseFilters(new URLSearchParams(url.split('?')[1])), filters)
})

test('productPath encodes ids', () => {
  assert.equal(productPath('P1'), '/products/P1')
  assert.equal(productPath('A/B #1?'), '/products/A%2FB%20%231%3F')
})
