import assert from 'node:assert/strict'
import test from 'node:test'
import { didYouMean, fallbackTerms, moveHighlight, orderSuggestions, shouldSuggest, suggestionHref } from './suggest.js'
import { buildFeedback, feedbackReducer, initialFeedback } from '../feedback/feedback.js'
import { galleryImages, isSyntheticPrice, normalizeAttributes, stockBadge } from '../../entities/product/product.js'

const S = [
  { type: 'product', value: 'Acme Runner', label: 'Acme Runner', product_id: 'M-1' },
  { type: 'brand', value: 'Acme' },
  { type: 'category', value: 'running_shoes', label: 'Giày chạy bộ' },
  { type: 'product', value: 'Acme Runner', label: 'Acme Runner', product_id: 'M-1' },
  { type: 'weird', value: 'x' },
]

test('suggestions are grouped category, brand, product and deduped', () => {
  assert.deepEqual(orderSuggestions(S).map((s) => `${s.type}:${s.label}`), ['category:Giày chạy bộ', 'brand:Acme', 'product:Acme Runner'])
  assert.deepEqual(orderSuggestions(null), [])
})

test('keyboard highlight moves and wraps through "nothing selected"', () => {
  assert.equal(moveHighlight(-1, 1, 3), 0)
  assert.equal(moveHighlight(-1, -1, 3), 2)
  assert.equal(moveHighlight(2, 1, 3), -1)
  assert.equal(moveHighlight(0, -1, 3), -1)
  assert.equal(moveHighlight(1, 1, 3), 2)
  assert.equal(moveHighlight(0, 1, 0), -1)
})

test('suggestion targets', () => {
  assert.equal(suggestionHref(S[0]), '/products/M-1')
  assert.equal(suggestionHref(S[1]), '/?brand=Acme')
  assert.equal(suggestionHref(S[2]), '/?category=running_shoes')
  assert.equal(shouldSuggest(' a '), false)
  assert.equal(shouldSuggest('ba'), true)
  assert.deepEqual(fallbackTerms('hikng boots of x hikng'), ['hikng', 'boots'])
})

test('did-you-mean builds search links and skips the current query', () => {
  const out = didYouMean('acme', S)
  assert.deepEqual(out.map((o) => o.label), ['Giày chạy bộ', 'Acme Runner'])
  assert.equal(out[1].href, '/search?q=Acme+Runner')
})

test('feedback payload validation and state machine', () => {
  assert.equal(buildFeedback({ target: 'x', traceId: 't', rating: 1 }), null)
  assert.equal(buildFeedback({ target: 'search', traceId: '', rating: 1 }), null)
  assert.deepEqual(buildFeedback({ target: 'search', traceId: 't', rating: -1, query: ' boots ', comment: '  ' }), { target: 'search', traceId: 't', rating: -1, query: 'boots' })
  let s = feedbackReducer(initialFeedback, { type: 'send' })
  assert.equal(s.status, 'idle', 'cannot send before rating')
  s = feedbackReducer(s, { type: 'rate', rating: 1 })
  s = feedbackReducer(s, { type: 'comment', comment: 'x'.repeat(900) })
  assert.equal(s.comment.length, 500)
  s = feedbackReducer(feedbackReducer(s, { type: 'send' }), { type: 'sent' })
  assert.equal(s.status, 'sent')
  assert.equal(feedbackReducer(s, { type: 'rate', rating: -1 }).rating, 1, 'locked after sending')
})

test('product attributes, gallery and stock badge', () => {
  assert.deepEqual(normalizeAttributes({ Color: 'Black', weight_g: 240, empty: '', color_normalized: 'black', nested: { a: 1 }, tags: ['a', 'b'] }),
    [{ name: 'Color', value: 'Black' }, { name: 'Weight g', value: '240' }, { name: 'Tags', value: 'a, b' }])
  assert.deepEqual(normalizeAttributes([{ name: 'Color', value: 'Blue' }, { name: 'X', value: null }]), [{ name: 'Color', value: 'Blue' }])
  assert.deepEqual(normalizeAttributes(null), [])
  assert.deepEqual(galleryImages({ image_url: 'a', images: ['a', 'b', null] }), ['a', 'b'])
  assert.deepEqual(galleryImages({ image_url: 'bad', images: ['ok'] }, (u) => (u === 'bad' ? null : u)), ['ok'])
  assert.deepEqual(stockBadge({ in_stock: true, quantity: 4, synthetic: true }), { inStock: true, quantity: 4, synthetic: true })
  assert.equal(stockBadge({ quantity: 4 }), null)
  assert.equal(isSyntheticPrice({ amount: 1, currency: 'USD', synthetic: true }), true)
  assert.equal(isSyntheticPrice(null), false)
})
