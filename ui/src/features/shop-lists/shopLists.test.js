import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMPARE_MAX, addToCart, buildCompareUrl, cartCount, cartTotal, clampQuantity, parseCompareIds, removeItem, sanitizeList, setCartQuantity, snapshot, toggleItem,
} from './shopLists.js'

const p = (id, extra = {}) => ({ product_id: id, title: `T${id}`, description: 'long text', ...extra })

test('snapshot keeps only the card fields', () => {
  assert.deepEqual(snapshot(p('A', { brand: 'X', price: { amount: 3, currency: 'USD' } })), { product_id: 'A', title: 'TA', brand: 'X', price: { amount: 3, currency: 'USD' } })
  assert.equal(snapshot({ title: 'no id' }), null)
})

test('compare toggles and stops at 3', () => {
  let list = []
  for (const id of ['A', 'B', 'C']) list = toggleItem(list, p(id), COMPARE_MAX).list
  const full = toggleItem(list, p('D'), COMPARE_MAX)
  assert.equal(full.status, 'full')
  assert.equal(full.list.length, 3)
  const removed = toggleItem(list, p('B'), COMPARE_MAX)
  assert.equal(removed.status, 'removed')
  assert.deepEqual(removed.list.map((x) => x.product_id), ['A', 'C'])
  assert.equal(toggleItem(list, null).status, 'invalid')
  assert.deepEqual(removeItem(list, 'A').map((x) => x.product_id), ['B', 'C'])
})

test('sanitizeList drops junk, duplicates and enforces max', () => {
  const raw = [p('A'), 'x', null, { foo: 1 }, p('A'), p('B'), p('C'), p('D')]
  assert.deepEqual(sanitizeList(raw, { max: 3 }).map((x) => x.product_id), ['A', 'B', 'C'])
  assert.deepEqual(sanitizeList('not a list'), [])
  assert.equal(sanitizeList([{ ...p('A'), quantity: 500 }], { withQuantity: true })[0].quantity, 99)
})

test('cart adds, merges quantity, counts and totals', () => {
  let cart = addToCart([], p('A', { price: { amount: 10, currency: 'USD' } }))
  cart = addToCart(cart, p('A', { price: { amount: 10, currency: 'USD' } }), 2)
  cart = addToCart(cart, p('B'))
  assert.equal(cart.length, 2)
  assert.equal(cart[0].quantity, 3)
  assert.equal(cartCount(cart), 4)
  assert.deepEqual(cartTotal(cart), { amount: 30, currency: 'USD', synthetic: true })
  assert.equal(setCartQuantity(cart, 'A', 0)[0].quantity, 1)
  assert.equal(cartTotal([]), null)
  assert.equal(clampQuantity('abc'), 1)
})

test('compare ids round-trip through the URL', () => {
  assert.deepEqual(parseCompareIds(' A, B ,A,,C,D'), ['A', 'B', 'C'])
  assert.equal(buildCompareUrl(['A/1', 'B']), '/compare?ids=A%2F1,B')
  assert.equal(buildCompareUrl([]), '/compare')
})
