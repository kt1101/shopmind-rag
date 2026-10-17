import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchReply, normalizeChatPayload, progressItems, sourceCount } from './chatReply.js'
import { applyStep, chatReducer, historyFor, initialChatState } from './chatState.js'

test('fetchReply streams through /chat when available and normalizes the done payload', async () => {
  const seen = []
  const api = {
    chatStream: async (args) => {
      args.onEvent({ event: 'meta', data: { intent: 'product_search' } })
      return { data: { answer: 'Found 2', sources: [], products: [{ product_id: 'P1' }], intent: 'product_search', session_id: 's1', trace_id: 't1', standalone_question: 'x' } }
    },
  }
  const reply = await fetchReply({ question: 'x', scope: { product_id: 'P9' }, history: [{ role: 'user', content: 'a' }], sessionId: 's0', imageToken: 'img', explain: true, onEvent: (e) => seen.push(e.event), api })
  assert.deepEqual(seen, ['meta'])
  assert.equal(reply.kind, 'chat')
  assert.deepEqual(reply.products, [{ product_id: 'P1' }])
  assert.equal(reply.sessionId, 's1')
  assert.equal(reply.standalone, null, 'unchanged question is not repeated')
})

test('fetchReply passes chat args and falls back to legacy endpoints on 404', async () => {
  let args
  const api = {
    chatStream: async (a) => { args = a; throw Object.assign(new Error('nope'), { status: 404 }) },
    searchText: async () => ({ data: { results: [{ product_id: 'P1' }] } }),
  }
  const reply = await fetchReply({ question: 'boots', scope: null, sessionId: 's', imageToken: 'tok', explain: true, api })
  assert.equal(args.message, 'boots')
  assert.equal(args.imageToken, 'tok')
  assert.equal(args.explain, true)
  assert.equal(reply.kind, 'search')
  await assert.rejects(fetchReply({ question: 'x', api: { chatStream: async () => { throw Object.assign(new Error('boom'), { status: 500 }) } } }), /boom/)
})

test('normalizeChatPayload tolerates missing fields', () => {
  const r = normalizeChatPayload(null, 'q')
  assert.deepEqual(r.sources, [])
  assert.equal(r.products, null)
  assert.deepEqual(r.evidence, { insufficient_evidence: false, metadata: {} })
})

test('streaming events build live progress; receive finalizes the message', () => {
  let s = chatReducer(initialChatState, { type: 'send', content: 'ba lô đen' })
  s = chatReducer(s, { type: 'meta', intent: 'product_search', session_id: 's1' })
  s = chatReducer(s, { type: 'step', event: { id: 'rewrite', step: 'rewrite', status: 'started' } })
  s = chatReducer(s, { type: 'step', event: { id: 'rewrite', step: 'rewrite', status: 'done', duration_ms: 3 } })
  s = chatReducer(s, { type: 'products', items: [{ product_id: 'P1' }] })
  s = chatReducer(s, { type: 'delta', text: 'Mình ' })
  s = chatReducer(s, { type: 'delta', text: 'tìm được' })
  assert.equal(s.sessionId, 's1')
  assert.equal(s.live.intent, 'product_search')
  assert.deepEqual(s.live.steps, [{ id: 'rewrite', step: 'rewrite', status: 'done', summary: '', durationMs: 3 }])
  assert.equal(s.live.text, 'Mình tìm được')
  assert.equal(chatReducer(s, { type: 'reset' }).live.text, '')
  s = chatReducer(s, { type: 'receive', answer: 'Mình tìm được 1', sources: [], kind: 'chat', products: [{ product_id: 'P1' }], intent: 'product_search', traceId: 't1' })
  assert.equal(s.live, null)
  assert.equal(s.messages[1].intent, 'product_search')
  assert.deepEqual(s.messages[1].products, [{ product_id: 'P1' }])
  // Stray events after the reply are ignored.
  assert.equal(chatReducer(s, { type: 'delta', text: 'x' }), s)
  assert.equal(chatReducer(s, { type: 'unknown_event' }), s)
})

test('an image-only message is allowed; history excludes non-chat messages', () => {
  const s = chatReducer(initialChatState, { type: 'send', content: '', image: { token: 'img_1', url: 'blob:x' } })
  assert.equal(s.pending, true)
  assert.equal(s.messages[0].image.token, 'img_1')
  assert.deepEqual(historyFor([{ role: 'user', content: 'a' }, { role: 'scope' }, { role: 'error', content: 'x' }, { role: 'assistant', content: 'b' }]), [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }])
})

test('hydrate restores a server session into an empty chat; newChat clears it', () => {
  const s = chatReducer(initialChatState, { type: 'hydrate', sessionId: 's1', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo', products: [{ product_id: 'P' }] }, { role: 'system', content: 'x' }] })
  assert.equal(s.messages.length, 2)
  assert.equal(s.sessionId, 's1')
  assert.equal(chatReducer(s, { type: 'hydrate', messages: [] }), s, 'never overwrites a live conversation')
  assert.deepEqual(chatReducer(s, { type: 'newChat' }).messages, [])
})

test('progress items merge consecutive steps of the same type', () => {
  const steps = [
    { id: 'rewrite', step: 'rewrite', status: 'done' },
    { id: 'lexical', step: 'retrieve', status: 'done' },
    { id: 'semantic', step: 'retrieve', status: 'started' },
    { id: 'fuse', step: 'fuse', status: 'started' },
  ]
  assert.deepEqual(progressItems(steps).map((i) => [i.step, i.status, i.count]), [['rewrite', 'done', 1], ['retrieve', 'started', 2], ['fuse', 'started', 1]])
  assert.equal(sourceCount('2 product, 3 review, 0 policy'), 3)
  assert.equal(sourceCount(''), null)
  assert.deepEqual(applyStep([], {}), [])
})
