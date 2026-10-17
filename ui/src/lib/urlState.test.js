import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ALPHA,
  hasActiveFilters,
  parseAlpha,
  parseFilters,
  parseSearch,
  buildCatalogUrl,
  buildSearchUrl,
  productPath,
} from './urlState.js'

test('parseFilters reads repeated params, trims and dedupes', () => {
  const p = new URLSearchParams('category=shoes&category=%20shoes%20&category=&brand=Acme&x=1')
  assert.deepEqual(parseFilters(p), { category: ['shoes'], brand: ['Acme'], color: [] })
})

test('parseSearch detects text, image and empty searches', () => {
  assert.deepEqual(parseSearch(new URLSearchParams('q=%20boots%20')),
    { type: 'text', query: 'boots', filters: { category: [], brand: [], color: [] } })
  assert.equal(parseSearch(new URLSearchParams('type=image&q=ignored')).type, 'image')
  assert.equal(parseSearch(new URLSearchParams('q=%20%20')).type, null)
})

test('storefront URLs carry no search algorithm; legacy ?mode= links are ignored', () => {
  assert.equal('mode' in parseSearch(new URLSearchParams('q=a&mode=bm25')), false)
  assert.deepEqual(parseSearch(new URLSearchParams('q=a&mode=dense')), parseSearch(new URLSearchParams('q=a')))
  assert.equal(buildSearchUrl({ type: 'text', query: 'boots', mode: 'bm25' }), '/search?q=boots')
  assert.doesNotMatch(buildSearchUrl({ type: 'compose', query: 'đen', alpha: 0.5 }), /mode=/)
})

test('buildCatalogUrl serializes filters or returns root', () => {
  assert.equal(buildCatalogUrl({ category: [], brand: [] }), '/')
  assert.equal(buildCatalogUrl({ category: ['a', 'b'], brand: ['X'] }), '/?category=a&category=b&brand=X')
})

test('buildSearchUrl builds text and image URLs', () => {
  assert.equal(buildSearchUrl({ type: 'text', query: 'black shoes', filters: { category: ['shoes'], brand: [] } }),
    '/search?q=black+shoes&category=shoes')
  assert.equal(buildSearchUrl({ type: 'image', filters: { category: [], brand: ['Acme'] } }), '/search?type=image&brand=Acme')
})

test('filter values with reserved characters round-trip', () => {
  const filters = { category: ['Shoes & Gear'], brand: ['Café+Co'], color: ['black'] }
  const url = buildSearchUrl({ type: 'text', query: 'a', filters })
  assert.deepEqual(parseFilters(new URLSearchParams(url.split('?')[1])), filters)
})

test('productPath encodes ids', () => {
  assert.equal(productPath('P1'), '/products/P1')
  assert.equal(productPath('A/B #1?'), '/products/A%2FB%20%231%3F')
})

test('compose searches carry the query and a clamped alpha', () => {
  const url = buildSearchUrl({ type: 'compose', query: ' màu đen ', alpha: 0.35, filters: { color: ['black'] } })
  assert.equal(url, '/search?type=compose&q=m%C3%A0u+%C4%91en&alpha=0.35&color=black')
  assert.deepEqual(parseSearch(new URLSearchParams(url.split('?')[1])),
    { type: 'compose', query: 'màu đen', filters: { category: [], brand: [], color: ['black'] }, alpha: 0.35 })
  assert.equal(parseSearch(new URLSearchParams('type=compose&q=')).type, 'image', 'no text degrades to image search')
  assert.equal(parseAlpha('7'), 1)
  assert.equal(parseAlpha('-1'), 0)
  assert.equal(parseAlpha('abc'), DEFAULT_ALPHA)
  assert.equal(parseAlpha(null), DEFAULT_ALPHA)
})

test('catalog URLs drop the search-only colour filter; hasActiveFilters sees every field', () => {
  assert.equal(buildCatalogUrl({ category: ['a'], color: ['black'] }), '/?category=a')
  assert.equal(hasActiveFilters({ category: [], brand: [], color: ['red'] }), true)
  assert.equal(hasActiveFilters({ category: [], brand: [] }), false)
})
