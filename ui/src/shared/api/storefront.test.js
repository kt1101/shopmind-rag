import assert from 'node:assert/strict'
import test from 'node:test'
import {
  askProduct, chatRequestBody, chatStream, getEmbeddingMap, getPipelines, getFacets, getSimilarProducts, projectEmbedding, ragCompare,
  resolveImageUrl, searchCompose, searchImage, searchSuggest, searchText, sendClick, sendFeedback, uploadChatImage,
} from './storefront.js'

function capture(body = {}, status = 200) {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options })
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-request-id': 'req-1' } })
  }
  return { calls, fetchImpl }
}

test('explain is only sent when requested (text and image search)', async () => {
  const { calls, fetchImpl } = capture({ results: [] })
  await searchText({ query: 'boots', mode: 'hybrid', topK: 5, filters: {}, explain: true, fetchImpl })
  assert.equal(JSON.parse(calls[0].options.body).explain, true)
  const file = new File(['x'], 'a.png', { type: 'image/png' })
  await searchImage({ file, topK: 5, filters: { brand: 'Acme' }, explain: true, fetchImpl })
  assert.equal(calls[1].url, '/api/v1/search/image?top_k=5&brand=Acme&explain=true')
})

test('storefront text search sends no mode or pipeline; staff tools may name a pipeline', async () => {
  const { calls, fetchImpl } = capture({ results: [] })
  await searchText({ query: ' boots ', topK: 20, filters: {}, fetchImpl })
  assert.deepEqual(JSON.parse(calls[0].options.body), { query: 'boots', top_k: 20, filters: {} })
  await searchText({ query: 'boots', pipeline: 'search.bm25', topK: 10, filters: {}, explain: true, fetchImpl })
  assert.deepEqual(JSON.parse(calls[1].options.body), { query: 'boots', pipeline: 'search.bm25', top_k: 10, filters: {}, explain: true })
})

test('getPipelines asks for hidden pipelines only when requested', async () => {
  const { calls, fetchImpl } = capture({ pipelines: [] })
  await getPipelines({ fetchImpl })
  await getPipelines({ includeHidden: true, fetchImpl })
  assert.equal(calls[0].url, '/api/v1/meta/pipelines')
  assert.equal(calls[1].url, '/api/v1/meta/pipelines?include_hidden=true')
})

test('searchCompose sends multipart image, text, alpha, top_k and explain', async () => {
  const { calls, fetchImpl } = capture({ results: [], alpha: 0.3 })
  const file = new File(['x'], 'a.png', { type: 'image/png' })
  const res = await searchCompose({ file, text: ' màu đen ', alpha: 0.3, topK: 12, explain: true, fetchImpl })
  assert.equal(calls[0].url, '/api/v1/search/compose')
  const form = calls[0].options.body
  assert.equal(form.get('image'), file)
  assert.equal(form.get('text'), 'màu đen')
  assert.equal(form.get('alpha'), '0.3')
  assert.equal(form.get('top_k'), '12')
  assert.equal(form.get('explain'), 'true')
  assert.equal(res.requestId, 'req-1')
})

test('suggest, facets, similar and compare follow the contract', async () => {
  const { calls, fetchImpl } = capture({})
  await searchSuggest({ q: ' bo ', limit: 6, fetchImpl })
  await getFacets({ query: 'boots', filters: { brand: ['Acme', ''], category: '' }, fetchImpl })
  await getSimilarProducts({ productId: 'A/1', limit: 4, fetchImpl })
  await ragCompare({ productIds: ['A', 'B'], question: '  ', explain: true, fetchImpl })
  assert.equal(calls[0].url, '/api/v1/search/suggest?q=bo&limit=6')
  assert.deepEqual(JSON.parse(calls[1].options.body), { filters: { brand: ['Acme'] }, query: 'boots' })
  assert.equal(calls[2].url, '/api/v1/products/A%2F1/similar?limit=4')
  assert.deepEqual(JSON.parse(calls[3].options.body), { product_ids: ['A', 'B'], explain: true })
})

test('askProduct adds explain without changing the default body', async () => {
  const { calls, fetchImpl } = capture({ answer: '' })
  await askProduct({ question: 'Color?', productId: 'P1', explain: true, fetchImpl })
  assert.deepEqual(JSON.parse(calls[0].options.body), { question: 'Color?', product_id: 'P1', sources: ['product'], explain: true })
})

test('feedback and click payloads', async () => {
  const { calls, fetchImpl } = capture({ id: 'fb1' }, 201)
  await sendFeedback({ target: 'answer', traceId: 't1', rating: -1, comment: '  wrong policy ', fetchImpl })
  assert.deepEqual(JSON.parse(calls[0].options.body), { target: 'answer', trace_id: 't1', rating: -1, comment: 'wrong policy' })
  const click = capture(null, 204)
  const res = await sendClick({ traceId: 't1', productId: 'M-1', rank: 3, fetchImpl: click.fetchImpl })
  assert.equal(click.calls[0].url, '/api/v1/events/click')
  assert.deepEqual(JSON.parse(click.calls[0].options.body), { trace_id: 't1', product_id: 'M-1', rank: 3 })
  assert.equal(res.data, null)
})

test('embedding map endpoints', async () => {
  const { calls, fetchImpl } = capture({ points: [] })
  await getEmbeddingMap({ space: 'siglip_text', fetchImpl })
  await projectEmbedding({ space: 'image', query: ' túi ', fetchImpl })
  assert.equal(calls[0].url, '/api/v1/meta/embedding-map?space=siglip_text')
  assert.deepEqual(JSON.parse(calls[1].options.body), { space: 'image', query: 'túi' })
})

test('chat body only carries optional fields when set', () => {
  assert.deepEqual(chatRequestBody({ message: ' hi ' }), { message: 'hi', history: [] })
  assert.deepEqual(chatRequestBody({ message: 'x', history: [{ role: 'user', content: 'a' }], productId: 'P', sessionId: 's', imageToken: 'img', explain: true }),
    { message: 'x', history: [{ role: 'user', content: 'a' }], product_id: 'P', session_id: 's', image_token: 'img', explain: true })
})

test('uploadChatImage posts multipart image', async () => {
  const { calls, fetchImpl } = capture({ image_token: 'tok', expires_in: 900 })
  const file = new File(['x'], 'a.png', { type: 'image/png' })
  const res = await uploadChatImage({ file, fetchImpl })
  assert.equal(calls[0].url, '/api/v1/chat/image')
  assert.equal(calls[0].options.body.get('image'), file)
  assert.equal(res.data.image_token, 'tok')
})

function streamResponse(text, chunkSize = 7) {
  const encoder = new TextEncoder()
  const chunks = text.match(new RegExp(`[\\s\\S]{1,${chunkSize}}`, 'g'))
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

test('chatStream delivers every event (unknown ones too) and resolves with done', async () => {
  const sse = [
    'event: meta\ndata: {"intent":"product_search","session_id":"s1"}\n\n',
    'event: step\ndata: {"id":"rewrite","step":"rewrite","status":"done"}\n\n',
    'event: brand_new_event\ndata: {"x":1}\n\n',
    'event: delta\ndata: {"text":"Xin "}\n\n',
    'event: done\ndata: {"answer":"Xin chào","session_id":"s1","intent":"chitchat"}\n\n',
  ].join('')
  let sent
  const seen = []
  const res = await chatStream({
    message: 'chào', onEvent: (e) => seen.push(e.event),
    fetchImpl: async (url, options) => { sent = { url, options }; return streamResponse(sse) },
  })
  assert.equal(sent.url, '/api/v1/chat/stream')
  assert.equal(sent.options.headers.accept, 'text/event-stream')
  assert.deepEqual(seen, ['meta', 'step', 'brand_new_event', 'delta', 'done'])
  assert.equal(res.data.answer, 'Xin chào')
})

test('chatStream rejects on an error event or a stream without done', async () => {
  await assert.rejects(
    chatStream({ message: 'x', fetchImpl: async () => streamResponse('event: error\ndata: {"code":"llm_unavailable","message":"LLM down"}\n\n') }),
    { message: 'LLM down', code: 'llm_unavailable' },
  )
  await assert.rejects(chatStream({ message: 'x', fetchImpl: async () => streamResponse('event: delta\ndata: {"text":"a"}\n\n') }), /ended before/)
  await assert.rejects(
    chatStream({ message: 'x', fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'rag_unavailable', message: 'not ready' } }), { status: 503 }) }),
    { status: 503, code: 'rag_unavailable' },
  )
})

test('resolveImageUrl accepts inline image data URIs but not other schemes', () => {
  assert.ok(resolveImageUrl('data:image/svg+xml;charset=utf-8,%3Csvg%3E'))
  assert.ok(resolveImageUrl('data:image/png;base64,AAAA'))
  assert.equal(resolveImageUrl('data:text/html,<script>'), null)
  assert.equal(resolveImageUrl('javascript:alert(1)'), null)
})
