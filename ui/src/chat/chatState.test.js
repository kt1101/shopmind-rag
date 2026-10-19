import test from 'node:test'
import assert from 'node:assert/strict'
import { initialChatState, chatReducer } from './chatState.js'

test('send appends a trimmed user message and sets pending', () => {
  const s = chatReducer(initialChatState, { type: 'send', content: '  hi  ' })
  assert.equal(s.pending, true)
  assert.deepEqual(s.messages.map((m) => [m.role, m.content]), [['user', 'hi']])
})

test('send is ignored when blank or while pending', () => {
  assert.equal(chatReducer(initialChatState, { type: 'send', content: '   ' }), initialChatState)
  const pending = chatReducer(initialChatState, { type: 'send', content: 'a' })
  assert.equal(chatReducer(pending, { type: 'send', content: 'b' }), pending)
})

test('receive appends assistant message with sources', () => {
  let s = chatReducer(initialChatState, { type: 'send', content: 'a' })
  s = chatReducer(s, { type: 'receive', answer: 'b', sources: [{ product_id: 'P1' }] })
  assert.equal(s.pending, false)
  assert.deepEqual(s.messages[1].sources, [{ product_id: 'P1' }])
})

test('fail appends an error message; retry removes it and re-pends', () => {
  let s = chatReducer(initialChatState, { type: 'send', content: 'a' })
  s = chatReducer(s, { type: 'fail', message: 'down' })
  assert.equal(s.messages.at(-1).role, 'error')
  assert.equal(s.pending, false)
  s = chatReducer(s, { type: 'retry' })
  assert.equal(s.pending, true)
  assert.deepEqual(s.messages.map((m) => m.role), ['user'])
})

test('fail keeps the error code and status so the widget can explain llm_unavailable', () => {
  let s = chatReducer(initialChatState, { type: 'send', content: 'a' })
  s = chatReducer(s, { type: 'fail', message: 'OPENAI_API_KEY is not configured', code: 'llm_unavailable', status: 503 })
  assert.deepEqual(s.messages.at(-1).error, { code: 'llm_unavailable', status: 503, name: null })
  assert.equal(s.messages.at(-1).content, 'OPENAI_API_KEY is not configured')
})

test('retry is ignored unless the last message is an error', () => {
  assert.equal(chatReducer(initialChatState, { type: 'retry' }), initialChatState)
})

test('message ids are unique and increasing', () => {
  let s = chatReducer(initialChatState, { type: 'send', content: 'first' })
  s = chatReducer(s, { type: 'receive', answer: 'reply', sources: [] })
  s = chatReducer(s, { type: 'send', content: 'second' })
  assert.deepEqual(s.messages.map((m) => m.id), [1, 2, 3])
})

test('open and close toggle open state', () => {
  assert.equal(initialChatState.open, false)
  const opened = chatReducer(initialChatState, { type: 'open' })
  assert.equal(opened.open, true)
  assert.equal(chatReducer(opened, { type: 'open' }), opened)

  const closed = chatReducer(opened, { type: 'close' })
  assert.equal(closed.open, false)
  assert.equal(chatReducer(closed, { type: 'close' }), closed)
})

test('receive and fail are ignored when not pending', () => {
  assert.equal(initialChatState.pending, false)
  assert.equal(chatReducer(initialChatState, { type: 'receive', answer: 'hi' }), initialChatState)
  assert.equal(chatReducer(initialChatState, { type: 'fail', message: 'err' }), initialChatState)
})

test('retry while pending is ignored', () => {
  const pending = chatReducer(initialChatState, { type: 'send', content: 'hello' })
  assert.equal(pending.pending, true)
  assert.equal(chatReducer(pending, { type: 'retry' }), pending)
})

test('receive with missing sources stores sources: []', () => {
  let s = chatReducer(initialChatState, { type: 'send', content: 'q' })
  s = chatReducer(s, { type: 'receive', answer: 'a' })
  assert.deepEqual(s.messages[1].sources, [])
})

test('unknown action types return state unchanged', () => {
  assert.equal(chatReducer(initialChatState, { type: 'unknown' }), initialChatState)
})

test('rapid double send produces exactly one user message and remains pending', () => {
  let s = chatReducer(initialChatState, { type: 'send', content: 'first' })
  assert.equal(s.pending, true)
  assert.equal(s.messages.length, 1)

  // Second send while pending is ignored
  const s2 = chatReducer(s, { type: 'send', content: 'second' })
  assert.equal(s2, s)
  assert.equal(s2.messages.length, 1)
  assert.equal(s2.messages[0].content, 'first')
})

test('user content with HTML / script tags is preserved literally without mutation', () => {
  const xss = '<img src=x onerror=alert(1)> waterproof'
  const s = chatReducer(initialChatState, { type: 'send', content: xss })
  assert.equal(s.messages[0].content, xss)
})

const SHOE = { product_id: 'M-001', title: 'Acme Velocity Road Runner' }
const PACK = { product_id: 'M-013', title: 'Strider Black Roll-Top 30L' }

test('chat starts unscoped', () => {
  assert.equal(initialChatState.scope, null)
})

test('send records the scope the question was asked in', () => {
  let s = chatReducer(initialChatState, { type: 'send', content: 'boots' })
  assert.equal(s.messages[0].scope, null)
  s = chatReducer(s, { type: 'receive', answer: 'a', sources: [] })
  s = chatReducer(s, { type: 'setScope', product: SHOE })
  s = chatReducer(s, { type: 'send', content: 'Is it waterproof?' })
  assert.deepEqual(s.messages.at(-1).scope, SHOE)
})

test('setScope keeps only product_id and title', () => {
  const s = chatReducer(initialChatState, { type: 'setScope', product: { ...SHOE, price: { amount: 1 } } })
  assert.deepEqual(s.scope, SHOE)
})

test('setScope on an empty conversation adds no divider', () => {
  const s = chatReducer(initialChatState, { type: 'setScope', product: SHOE })
  assert.deepEqual(s.messages, [])
})

test('setScope adds a divider when the scope changes mid-conversation', () => {
  let s = chatReducer(initialChatState, { type: 'send', content: 'q' })
  s = chatReducer(s, { type: 'receive', answer: 'a', sources: [] })
  s = chatReducer(s, { type: 'setScope', product: SHOE })
  s = chatReducer(s, { type: 'setScope', product: PACK })
  s = chatReducer(s, { type: 'setScope', product: null })
  assert.deepEqual(s.messages.slice(2).map((m) => [m.role, m.product]), [['scope', SHOE], ['scope', PACK], ['scope', null]])
})

test('setScope to the current scope returns the same state', () => {
  const scoped = chatReducer(initialChatState, { type: 'setScope', product: SHOE })
  assert.equal(chatReducer(scoped, { type: 'setScope', product: { ...SHOE } }), scoped)
  assert.equal(chatReducer(initialChatState, { type: 'setScope', product: null }), initialChatState)
})

test('receive stores the reply kind and evidence', () => {
  let s = chatReducer(initialChatState, { type: 'send', content: 'q' })
  const evidence = { insufficient_evidence: true, metadata: { missing_sources: ['review'] } }
  s = chatReducer(s, { type: 'receive', answer: 'a', sources: [], kind: 'rag', evidence })
  assert.equal(s.messages[1].kind, 'rag')
  assert.deepEqual(s.messages[1].evidence, evidence)
})

test('retry keeps the scope of the failed question', () => {
  let s = chatReducer(initialChatState, { type: 'setScope', product: SHOE })
  s = chatReducer(s, { type: 'send', content: 'Is it waterproof?' })
  s = chatReducer(s, { type: 'fail', message: 'down' })
  s = chatReducer(s, { type: 'setScope', product: null })
  s = chatReducer(s, { type: 'retry' })
  assert.equal(s.pending, true)
  assert.deepEqual(s.messages.map((m) => m.role), ['user', 'scope'])
  assert.deepEqual(s.messages.findLast((m) => m.role === 'user').scope, SHOE)
})
