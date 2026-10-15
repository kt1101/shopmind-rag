import test from 'node:test'
import assert from 'node:assert/strict'
import { initialChatState, chatReducer, toApiMessages } from './chatState.js'

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

test('retry is ignored unless the last message is an error', () => {
  assert.equal(chatReducer(initialChatState, { type: 'retry' }), initialChatState)
})

test('message ids are unique and increasing', () => {
  let s = chatReducer(initialChatState, { type: 'send', content: 'first' })
  s = chatReducer(s, { type: 'receive', answer: 'reply', sources: [] })
  s = chatReducer(s, { type: 'send', content: 'second' })
  assert.deepEqual(s.messages.map((m) => m.id), [1, 2, 3])
})

test('toApiMessages drops errors and keeps the last 10 turns', () => {
  const messages = Array.from({ length: 12 }, (_, i) => ({ id: i, role: i % 2 ? 'assistant' : 'user', content: String(i) }))
  messages.splice(5, 0, { id: 99, role: 'error', content: 'x' })
  const out = toApiMessages(messages)
  assert.equal(out.length, 10)
  assert.deepEqual(out[0], { role: 'user', content: '2' })
  assert.ok(out.every((m) => Object.keys(m).join() === 'role,content'))
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
