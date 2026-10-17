import assert from 'node:assert/strict'
import test from 'node:test'
import { createSSEParser, parseSSEText } from './sse.js'

test('parses named events with JSON data', () => {
  const events = parseSSEText('event: meta\ndata: {"intent":"product_search"}\n\nevent: delta\ndata: {"text":"Hi"}\n\n')
  assert.deepEqual(events, [
    { event: 'meta', data: { intent: 'product_search' } },
    { event: 'delta', data: { text: 'Hi' } },
  ])
})

test('joins multi-line data, keeps raw text when not JSON, defaults to message', () => {
  const events = parseSSEText('data: line one\ndata: line two\n\n')
  assert.deepEqual(events, [{ event: 'message', data: 'line one\nline two' }])
})

test('ignores comments, retry and unknown fields; passes unknown events through', () => {
  const events = parseSSEText(': keep-alive\nretry: 1000\nfoo: bar\nevent: telemetry\nid: 7\ndata: {"x":1}\n\n')
  assert.deepEqual(events, [{ event: 'telemetry', data: { x: 1 }, id: '7' }])
})

test('handles chunks split anywhere, including inside CRLF', () => {
  const events = []
  const parser = createSSEParser((e) => events.push(e))
  const text = 'event: step\r\ndata: {"id":"rewrite","status":"done"}\r\n\r\nevent: done\r\ndata: {"answer":"ok"}\r\n\r\n'
  for (const chunk of text.match(/[\s\S]{1,5}/g)) parser.push(chunk)
  parser.flush()
  assert.deepEqual(events.map((e) => e.event), ['step', 'done'])
  assert.equal(events[1].data.answer, 'ok')
})

test('flush emits a trailing event without the final blank line', () => {
  assert.deepEqual(parseSSEText('event: done\ndata: {"a":1}'), [{ event: 'done', data: { a: 1 } }])
})
