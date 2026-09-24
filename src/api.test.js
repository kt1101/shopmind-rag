import assert from 'node:assert/strict'
import test from 'node:test'

import { checkReadiness, getFilterOptions, resolveImageUrl, searchImage, searchText } from './api.js'

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

test('searchText accepts filter-only requests and serializes multi-value filters', async () => {
  let request
  const fetchImpl = async (url, options) => {
    request = { url, options }
    return jsonResponse({ query: null, mode: 'bm25', filter_only: true, results: [] })
  }

  await searchText({
    query: '   ',
    mode: 'bm25',
    topK: 10,
    filters: { brand: [' Acme ', 'Acme', ''], category: ['Shoes'], product_id: '' },
    fetchImpl,
  })

  assert.deepEqual(JSON.parse(request.options.body), {
    query: '',
    mode: 'bm25',
    top_k: 10,
    filters: { brand: ['Acme'], category: ['Shoes'] },
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

test('searchImage repeats multi-value filter query parameters', async () => {
  let requestUrl
  const fetchImpl = async (url) => {
    requestUrl = url
    return jsonResponse({ mode: 'image_dense', results: [] })
  }
  const file = new File(['image'], 'shoe.png', { type: 'image/png' })

  await searchImage({ file, topK: 10, filters: { category: ['Shoes', 'Boots'], brand: ['Acme'] }, fetchImpl })

  assert.equal(requestUrl, '/api/v1/search/image?top_k=10&category=Shoes&category=Boots&brand=Acme')
})

test('getFilterOptions requests a bounded catalog suggestion list', async () => {
  let requestUrl
  const fetchImpl = async (url) => {
    requestUrl = url
    return jsonResponse({ field: 'brand', options: [] })
  }

  await getFilterOptions({ field: 'brand', prefix: ' ama ', limit: 7, fetchImpl })

  assert.equal(requestUrl, '/api/v1/search/filter-options?field=brand&prefix=ama&limit=7')
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
  assert.equal(resolveImageUrl('/media/products/P1.jpg'), '/media/products/P1.jpg')
  assert.equal(resolveImageUrl('data/raw/images/catalog/shoe 1.jpg'), '/media/products/catalog/shoe%201.jpg')
  assert.equal(resolveImageUrl('https://images.example/shoe.jpg'), 'https://images.example/shoe.jpg')
  assert.equal(resolveImageUrl('javascript:alert(1)'), null)
  assert.equal(resolveImageUrl('data/raw/images/'), null)
  assert.equal(resolveImageUrl(null), null)
})
