import assert from 'node:assert/strict'
import test from 'node:test'
import {
  askProduct, chat, chatStream, getChatSession, getEmbeddingMap, getFacets, getFilterOptions, getPipelines, getProduct,
  getRecordedEvents, getSimilarProducts, projectEmbedding, ragCompare, searchCompose, searchImage, searchSuggest, searchText,
  resolveSearchPipeline, sendClick, sendFeedback, setMockDelay, understandQuery, uploadChatImage,
} from './mockApi.js'

setMockDelay(0)

const STEP_VOCAB = new Set(['query_understanding', 'rewrite', 'retrieve', 'multi_source_retrieve', 'fuse', 'rerank', 'compose_query', 'filter',
  'build_context', 'generate', 'validate_citations', 'route_intent'])

function assertTrace(trace, kind) {
  assert.ok(trace.trace_id)
  assert.equal(trace.kind, kind)
  assert.ok(trace.pipeline)
  assert.ok(Number.isFinite(trace.duration_ms))
  assert.ok(Array.isArray(trace.steps) && trace.steps.length > 0)
  for (const step of trace.steps) {
    assert.ok(STEP_VOCAB.has(step.step), `unknown step ${step.step}`)
    assert.ok(Number.isFinite(step.started_ms) && Number.isFinite(step.duration_ms), `timing for ${step.id}`)
    assert.ok((step.output?.items?.length ?? 0) <= 20)
  }
  // Vectors and image bytes are never included.
  assert.ok(!/"query_vector":\s*\[/.test(JSON.stringify(trace)))
}

const file = (name) => new File(['img'], name, { type: 'image/png' })
const byStep = (trace, id) => trace.steps.find((s) => s.id === id)

test('hybrid text search returns a full search trace with every Inspector detail', async () => {
  const { data } = await searchText({ query: 'giày bốt da màu nâu', mode: 'hybrid', topK: 10, explain: true })
  assert.ok(data.results.length > 0)
  assert.deepEqual(Object.keys(data.results[0]).sort(), ['brand', 'category', 'image_url', 'product_id', 'rank', 'score', 'title'])
  assert.equal(data.trace.trace_id, data.trace_id)
  assertTrace(data.trace, 'search')
  const qu = byStep(data.trace, 'understand').details
  assert.equal(qu.language, 'vi')
  assert.deepEqual(qu.aliases.map((a) => a.to), ['hiking_boots', 'brown'])
  assert.match(qu.normalized_query, /leather/)
  const lexical = byStep(data.trace, 'lexical')
  assert.ok(lexical.details.query_dsl.query.bool.must[0].multi_match)
  assert.ok(lexical.output.items[0].details.matched_terms.title.includes('boot'))
  assert.deepEqual(byStep(data.trace, 'semantic').details.query_vector, { dims: 768, norm: 1 })
  const fused = byStep(data.trace, 'fuse').output.items[0].details
  assert.ok(fused.contributions.lexical && fused.formula.startsWith('1/(60+'))
  const reranked = byStep(data.trace, 'rerank').output.items[0].details
  assert.ok(Number.isInteger(reranked.before_rank) && reranked.after_rank === 1)
  assert.deepEqual(data.trace.output.result_ids, data.results.map((r) => r.product_id))
  assert.deepEqual(data.understood.filters, { category: ['hiking_boots'], color: ['brown'] })
})

test('trace is omitted without explain; filters resolve exact vs fallback', async () => {
  const plain = await searchText({ query: 'boots' })
  assert.equal(plain.data.trace, undefined)
  assert.ok(plain.data.trace_id)
  const { data } = await searchText({ query: 'boots', filters: { brand: ['Acme', 'north'] }, explain: true })
  const filters = byStep(data.trace, 'understand').details.filters
  assert.deepEqual(filters.brand, { requested: ['Acme', 'north'], resolved: ['Acme', 'Northpeak'], match: 'fallback' })
  assert.ok(data.results.every((r) => ['Acme', 'Northpeak'].includes(r.brand)))
})

test('adaptive mode records its choice and reason; nonsense queries return zero results', async () => {
  const { data } = await searchText({ query: 'M-007', mode: 'adaptive', explain: true })
  assert.equal(byStep(data.trace, 'understand').details.adaptive.mode, 'bm25')
  assert.equal((await searchText({ query: 'qwzx flurb' })).data.results.length, 0)
})

test('image and compose search; alpha moves the results', async () => {
  const image = await searchImage({ file: file('M-009.png'), topK: 5, explain: true })
  assert.equal(image.data.results[0].product_id, 'M-009')
  assertTrace(image.data.trace, 'image_search')
  const heavyImage = await searchCompose({ file: file('M-009.png'), text: 'màu đen', alpha: 1, topK: 4 })
  const heavyText = await searchCompose({ file: file('M-009.png'), text: 'màu đen', alpha: 0.1, topK: 4, explain: true })
  assert.notDeepEqual(heavyImage.data.results.map((r) => r.product_id), heavyText.data.results.map((r) => r.product_id))
  assert.equal(heavyText.data.alpha, 0.1)
  assertTrace(heavyText.data.trace, 'compose_search')
  assert.equal(byStep(heavyText.data.trace, 'compose').details.alpha, 0.1)
  await assert.rejects(searchCompose({ file: file('a.png'), text: ' ' }), { status: 422 })
})

test('suggest, facets, understand, filter options', async () => {
  const s = await searchSuggest({ q: 'nor' })
  assert.ok(s.data.suggestions.some((x) => x.type === 'brand' && x.value === 'Northpeak'))
  assert.ok(s.data.suggestions.every((x) => ['product', 'brand', 'category'].includes(x.type)))
  assert.ok((await searchSuggest({ q: 'ba lô' })).data.suggestions.some((x) => x.type === 'category' && x.value === 'backpacks'))
  assert.ok((await searchSuggest({ q: 'hikng' })).data.suggestions.length > 0, 'typo tolerant')
  const f = await getFacets({ filters: { category: ['jackets'] } })
  assert.equal(f.data.facets.category.find((c) => c.value === 'backpacks').count, 6, 'own field is disjunctive')
  assert.ok(f.data.facets.brand.every((b) => b.count <= 6))
  assert.deepEqual((await understandQuery({ query: 'áo khoác đen Northpeak' })).data.filters, { category: ['jackets'], color: ['black'], brand: ['Northpeak'] })
  assert.deepEqual((await getFilterOptions({ field: 'brand', prefix: 'st' })).data, { field: 'brand', options: ['Strider'] })
})

test('product detail follows the contract; similar excludes self', async () => {
  const { data } = await getProduct({ productId: 'M-007' })
  assert.equal(typeof data.attributes, 'object')
  assert.ok(!Array.isArray(data.attributes))
  assert.equal(data.attributes.Color, 'Dark Olive')
  assert.equal(data.price.synthetic, true)
  assert.equal(data.stock.synthetic, true)
  assert.ok(data.images.length >= 1)
  const similar = await getSimilarProducts({ productId: 'M-007', limit: 4 })
  assert.equal(similar.data.items.length, 4)
  assert.ok(similar.data.items.every((i) => i.product_id !== 'M-007'))
  await assert.rejects(getSimilarProducts({ productId: 'nope' }), { status: 404 })
})

test('RAG ask with explain returns build_context / generate / validate_citations details', async () => {
  const { data } = await askProduct({ question: 'Có chống nước không? Đổi trả thế nào?', productId: 'M-007', sources: ['product', 'review', 'policy'], explain: true, delayMs: 0 })
  assertTrace(data.trace, 'rag')
  const ctx = byStep(data.trace, 'context').details
  assert.ok(ctx.documents.some((d) => d.included) && Number.isFinite(ctx.rendered_chars) && ctx.budget > 0)
  assert.ok(ctx.documents.every((d) => d.reason))
  const gen = byStep(data.trace, 'generate').details
  assert.ok(gen.model && gen.prompt_id && gen.prompt_version && gen.usage.input_tokens > 0)
  const attempts = byStep(data.trace, 'citations').details.attempts
  assert.equal(attempts.at(-1).valid, true)
  assert.equal(attempts[0].valid, false, 'policy evidence triggers a visible retry')
  for (const source of data.sources) {
    assert.ok(source.citation_id && source.snippet)
    assert.ok(data.answer.includes(`[${source.citation_id}]`))
  }
})

test('compare: attribute table with nulls, cited points, insufficient evidence', async () => {
  const { data } = await ragCompare({ productIds: ['M-001', 'M-024'], explain: true })
  const color = data.attributes.find((a) => a.name === 'Color')
  assert.equal(color.values['M-024'], null)
  assert.equal(color.values['M-001'], 'Cobalt Blue')
  for (const point of data.points) for (const id of point.citation_ids) assert.ok(data.sources.some((s) => s.citation_id === id))
  assertTrace(data.trace, 'compare')
  const good = await ragCompare({ productIds: ['M-001', 'M-003', 'M-005'] })
  assert.ok(good.data.points.length > 0)
  assert.equal(good.data.insufficient_evidence, false)
  const none = await ragCompare({ productIds: ['M-001', 'M-003'], question: 'warranty length?' })
  assert.equal(none.data.insufficient_evidence, true)
  await assert.rejects(ragCompare({ productIds: ['M-001'] }), { status: 422 })
})

test('chat: product search, then a follow-up resolved from the session, then the session history', async () => {
  const first = await chat({ message: 'ba lô đen', explain: true })
  assert.equal(first.data.intent, 'product_search')
  assert.ok(first.data.products.length > 0)
  assertTrace(first.data.trace, 'chat')
  const sessionId = first.data.session_id
  const second = first.data.products[1]
  const follow = await chat({ message: 'Cái thứ hai có chống nước không?', sessionId, history: [{ role: 'user', content: 'ba lô đen' }] })
  assert.equal(follow.data.intent, 'product_question')
  assert.ok(follow.data.standalone_question.includes(second.title))
  const policy = await chat({ message: 'Đổi trả trong bao lâu?', sessionId })
  assert.equal(policy.data.intent, 'policy_question')
  assert.ok(policy.data.sources.some((s) => s.source === 'policy'))
  const hello = await chat({ message: 'xin chào' })
  assert.equal(hello.data.intent, 'chitchat')
  const session = await getChatSession({ sessionId })
  assert.equal(session.data.messages.length, 6)
  assert.ok(session.data.messages[1].products.length > 0)
  await assert.rejects(getChatSession({ sessionId: 'missing' }), { status: 404 })
})

test('chatStream emits meta, steps, products, deltas and done in order', async () => {
  const events = []
  const res = await chatStream({ message: 'giày chạy bộ xanh', explain: true, eventDelayMs: 0, onEvent: (e) => events.push(e) })
  const names = events.map((e) => e.event)
  assert.equal(names[0], 'meta')
  assert.equal(names.at(-1), 'done')
  assert.ok(names.includes('step') && names.includes('products') && names.includes('delta'))
  assert.ok(names.indexOf('products') < names.indexOf('delta'))
  const text = events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('')
  assert.equal(text, res.data.answer)
  assert.ok(events.filter((e) => e.event === 'step').every((e) => ['started', 'done'].includes(e.data.status)))
})

test('chat with an uploaded image routes to image or compose search', async () => {
  const { data: upload } = await uploadChatImage({ file: file('M-013.png') })
  assert.ok(upload.image_token && upload.expires_in > 0)
  const imageOnly = await chat({ message: '', imageToken: upload.image_token })
  assert.equal(imageOnly.data.intent, 'product_search')
  assert.equal(imageOnly.data.products[0].product_id, 'M-013')
  const composed = await chat({ message: 'màu xanh', imageToken: upload.image_token, explain: true })
  assert.ok(composed.data.trace.steps.some((s) => s.step === 'compose_query'))
  await assert.rejects(chat({ message: 'x', imageToken: 'expired' }), { status: 422 })
})

test('feedback and clicks are recorded; invalid feedback is rejected', async () => {
  const fb = await sendFeedback({ target: 'search', traceId: 't1', rating: 1, query: 'boots' })
  assert.ok(fb.data.id)
  await assert.rejects(sendFeedback({ target: 'nope', traceId: 't1', rating: 1 }), { status: 422 })
  await sendClick({ traceId: 't1', productId: 'M-001', rank: 2 })
  const recorded = getRecordedEvents()
  assert.equal(recorded.feedback.at(-1).query, 'boots')
  assert.deepEqual(recorded.clicks.at(-1), { trace_id: 't1', product_id: 'M-001', rank: 2 })
})

test('storefront search without mode runs the admin default pipeline; staff can name one', async () => {
  assert.deepEqual(resolveSearchPipeline({ query: 'boots', defaultPipeline: 'search.bm25' }), { pipeline: 'search.bm25', engineMode: 'bm25', mode: 'default' })
  assert.equal(resolveSearchPipeline({ query: '', pipeline: 'search.dense' }).pipeline, 'search.bm25', 'filter-only is always BM25')
  assert.equal(resolveSearchPipeline({ query: 'x', mode: 'dense' }).pipeline, 'search.dense')
  assert.equal(resolveSearchPipeline({ query: 'x', pipeline: 'search.unknown' }).engineMode, 'hybrid')

  const shopper = await searchText({ query: 'ba lô đen', topK: 5, explain: true })
  assert.equal(shopper.data.mode, 'default')
  assert.equal(shopper.data.pipeline, 'search.hybrid')
  assert.equal(shopper.data.trace.pipeline, 'search.hybrid')
  const staff = await searchText({ query: 'ba lô đen', pipeline: 'search.bm25', topK: 5, explain: true })
  assert.equal(staff.data.pipeline, 'search.bm25')
  assert.ok(!staff.data.trace.steps.some((s) => s.id === 'semantic'), 'bm25 pipeline has no dense step')
})

test('meta: pipelines and embedding maps', async () => {
  const p = await getPipelines()
  assert.ok(p.data.pipelines.some((x) => x.name === p.data.defaults.search))
  assert.ok(p.data.pipelines.every((x) => x.public !== false), 'hidden pipelines only with includeHidden')
  const all = await getPipelines({ includeHidden: true })
  assert.ok(all.data.pipelines.some((x) => x.public === false))
  for (const space of ['text', 'siglip_text', 'image']) {
    const map = await getEmbeddingMap({ space })
    assert.equal(map.data.space, space)
    assert.ok(map.data.points.length > 200)
    assert.ok(map.data.points.every((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y) && pt.category && pt.title))
  }
  const proj = await projectEmbedding({ space: 'text', query: 'ba lô' })
  assert.ok(Number.isFinite(proj.data.x) && Number.isFinite(proj.data.y))
  await assert.rejects(getEmbeddingMap({ space: 'audio' }), { status: 422 })
})
