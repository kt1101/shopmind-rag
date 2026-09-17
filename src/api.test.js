import assert from 'node:assert/strict'
import test from 'node:test'

import { checkReadiness, resolveImageUrl, searchImage, searchText } from './api.js'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('searchText sends the public API contract and omits blank filters', async () => {
  let request
  const fetchImpl = async (url, options) => {
    request = { url, options }
    return jsonResponse({ query: 'black runner', mode: 'hybrid', results: [] })
  }

  await searchText({
    query: ' black runner ',
    mode: 'hybrid',
    topK: 5,
    filters: { brand: 'Acme', category: '', product_id: 'P1' },
    fetchImpl,
  })

  assert.equal(request.url, '/api/v1/search/text')
  assert.equal(request.options.method, 'POST')
  assert.deepEqual(JSON.parse(request.options.body), {
    query: 'black runner',
    mode: 'hybrid',
    top_k: 5,
    filters: { brand: 'Acme', product_id: 'P1' },
  })
})

test('searchImage sends multipart data and filters as query parameters', async () => {
  let request
  const fetchImpl = async (url, options) => {
    request = { url, options }
    return jsonResponse({ mode: 'image_dense', results: [] })
  }
  const file = new File(['image'], 'shoe.png', { type: 'image/png' })

  await searchImage({ file, topK: 10, filters: { category: 'Shoes & Gear' }, fetchImpl })

  assert.equal(request.url, '/api/v1/search/image?top_k=10&category=Shoes+%26+Gear')
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.body.get('image'), file)
})

test('API errors expose the backend message', async () => {
  const fetchImpl = async () => jsonResponse({ error: { message: 'search repository is not ready' } }, 503)

  await assert.rejects(
    () => checkReadiness(undefined, fetchImpl),
    { message: 'search repository is not ready' },
  )
})

test('API errors fall back to the HTTP status', async () => {
  const fetchImpl = async () => new Response('bad gateway', { status: 502 })

  await assert.rejects(
    () => checkReadiness(undefined, fetchImpl),
    { message: 'Request failed (502)' },
  )
})

test('resolveImageUrl maps only supported product image paths', () => {
  assert.equal(resolveImageUrl('data/raw/images/catalog/shoe 1.jpg'), '/media/products/catalog/shoe%201.jpg')
  assert.equal(resolveImageUrl('https://images.example/shoe.jpg'), 'https://images.example/shoe.jpg')
  assert.equal(resolveImageUrl('javascript:alert(1)'), null)
  assert.equal(resolveImageUrl('data/raw/images/'), null)
  assert.equal(resolveImageUrl(null), null)
})
