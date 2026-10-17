import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchReply } from './chatReply.js'

function fakeApi({ askData, searchResults = [] } = {}) {
  const calls = []
  return {
    calls,
    askProduct: async (args) => { calls.push(['askProduct', args]); return { data: askData } },
    searchText: async (args) => { calls.push(['searchText', args]); return { data: { results: searchResults } } },
  }
}

const SHOE = { product_id: 'M-001', title: 'Acme Velocity Road Runner' }

test('scoped questions are answered by askProduct for that product', async () => {
  const askData = {
    answer: 'It is Cobalt Blue.',
    sources: [{ source: 'product', document_id: 'product:M-001', title: SHOE.title, score: 0.9 }],
    insufficient_evidence: false,
    metadata: { truncated_ids: ['x'] },
  }
  const api = fakeApi({ askData })
  const reply = await fetchReply({ question: 'What color?', scope: SHOE, api })
  assert.deepEqual(api.calls[0], ['askProduct', { question: 'What color?', productId: 'M-001', sources: ['product'], debug: true, signal: undefined }])
  assert.deepEqual(reply, {
    kind: 'rag',
    answer: 'It is Cobalt Blue.',
    sources: askData.sources,
    evidence: { insufficient_evidence: false, metadata: { truncated_ids: ['x'] } },
  })
})

test('unscoped questions run a hybrid catalog search for the top 3', async () => {
  const results = [{ product_id: 'P1', title: 'Boot' }, { product_id: 'P2', title: 'Hiker' }]
  const api = fakeApi({ searchResults: results })
  const reply = await fetchReply({ question: 'waterproof boots', scope: null, api })
  assert.deepEqual(api.calls[0], ['searchText', { query: 'waterproof boots', topK: 3, filters: {}, signal: undefined }])
  assert.equal(reply.kind, 'search')
  assert.deepEqual(reply.sources, results)
  assert.ok(reply.answer.includes('waterproof boots'))
})

test('an empty search gives a "couldn\'t find" reply with no sources', async () => {
  const reply = await fetchReply({ question: 'unicorn saddle', scope: null, api: fakeApi() })
  assert.equal(reply.kind, 'search')
  assert.deepEqual(reply.sources, [])
  assert.match(reply.answer, /couldn't find/i)
})

test('missing fields in a RAG response fall back safely', async () => {
  const reply = await fetchReply({ question: 'q', scope: SHOE, api: fakeApi({ askData: { answer: 'a' } }) })
  assert.deepEqual(reply.sources, [])
  assert.deepEqual(reply.evidence, { insufficient_evidence: false, metadata: {} })
})
