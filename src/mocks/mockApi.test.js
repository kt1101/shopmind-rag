import assert from 'node:assert/strict'
import test from 'node:test'

import { getProduct, getProducts, sendChatMessage } from './mockApi.js'

test('mock getProducts filters and pages', async () => {
  const all = await getProducts({ limit: 10, offset: 20 })
  assert.equal(all.data.total, 24)
  assert.equal(all.data.items.length, 4)
  const boots = await getProducts({ category: ['hiking_boots'], limit: 24, offset: 0 })
  assert.equal(boots.data.total, 6)
  assert.ok(boots.data.items.every((p) => p.category === 'hiking_boots'))
})

test('mock getProduct returns fixture or 404', async () => {
  assert.equal((await getProduct({ productId: 'M-001' })).data.product_id, 'M-001')
  await assert.rejects(() => getProduct({ productId: 'nope' }), { status: 404 })
})

test('mock chat returns sources matching the question', async () => {
  const r = await sendChatMessage({ messages: [{ role: 'user', content: 'any waterproof boots?' }], delayMs: 0 })
  assert.ok(r.data.answer.includes('any waterproof boots?'))
  assert.ok(r.data.sources.length >= 1 && r.data.sources.length <= 3)
})

test('mock chat fails on demand', async () => {
  await assert.rejects(() => sendChatMessage({ messages: [{ role: 'user', content: 'trigger error' }], delayMs: 0 }))
})

test('mock getProducts items omit description and attributes', async () => {
  const res = await getProducts({ limit: 24 })
  assert.ok(res.data.items.length > 0)
  for (const item of res.data.items) {
    assert.equal(item.description, undefined)
    assert.equal(item.attributes, undefined)
    assert.ok(item.product_id)
    assert.ok(item.title)
    assert.ok(item.brand)
    assert.ok(item.category)
  }
})

test('mock getProducts brand filter works', async () => {
  const res = await getProducts({ brand: ['Café+Co'], limit: 24 })
  assert.ok(res.data.total > 0)
  assert.ok(res.data.items.every((p) => p.brand === 'Café+Co'))
})

test('mock chat rejects with AbortError when signal is aborted', async () => {
  const controller = new AbortController()
  const promise = sendChatMessage({
    messages: [{ role: 'user', content: 'any boots?' }],
    signal: controller.signal,
    delayMs: 200,
  })
  controller.abort()
  await assert.rejects(promise, { name: 'AbortError' })
})

test('mock getProducts rejects when signal is already aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    () => getProducts({ signal: controller.signal }),
    { name: 'AbortError' },
  )
})
