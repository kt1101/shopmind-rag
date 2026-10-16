import test from 'node:test'
import assert from 'node:assert/strict'
import { humanizeCategory, formatPrice } from './format.js'

test('humanizeCategory title-cases snake_case', () => {
  assert.equal(humanizeCategory('running_shoes'), 'Running Shoes')
  assert.equal(humanizeCategory('boots'), 'Boots')
  assert.equal(humanizeCategory(''), '')
})

test('formatPrice formats currency amounts', () => {
  assert.equal(formatPrice({ amount: 89, currency: 'USD' }), '$89.00')
  assert.equal(formatPrice({ amount: 1200, currency: 'EUR' }), '€1,200.00')
  assert.equal(formatPrice({ amount: 5 }), '$5.00')
})

test('formatPrice returns null for missing or invalid prices', () => {
  assert.equal(formatPrice(undefined), null)
  assert.equal(formatPrice({ amount: 'x', currency: 'USD' }), null)
  assert.equal(formatPrice({ amount: 10, currency: 'NOT_A_CODE' }), null)
})
