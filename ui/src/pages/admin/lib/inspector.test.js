import test from 'node:test'
import assert from 'node:assert/strict'
import { INSPECTOR_EVENT, isInspectorMounted, openInspector } from './inspector.js'

test('openInspector dispatches the event with the trace id', () => {
  const target = new EventTarget()
  let received = null
  target.addEventListener(INSPECTOR_EVENT, (e) => { received = e.detail })
  assert.deepEqual(openInspector('tr_1', target), { acknowledged: false })
  assert.deepEqual(received, { traceId: 'tr_1' })
})

test('openInspector is acknowledged by preventDefault', () => {
  const target = new EventTarget()
  target.addEventListener(INSPECTOR_EVENT, (e) => e.preventDefault())
  assert.deepEqual(openInspector('tr_1', target), { acknowledged: true })
})

test('openInspector is acknowledged by a mounted inspector element', () => {
  const target = new EventTarget()
  target.document = { querySelector: () => ({}) }
  assert.equal(openInspector('tr_1', target).acknowledged, true)
  assert.equal(isInspectorMounted({ querySelector: () => null }), false)
  assert.equal(isInspectorMounted(null), false)
  assert.equal(openInspector('x', null).acknowledged, false)
})
