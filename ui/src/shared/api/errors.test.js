import assert from 'node:assert/strict'
import test from 'node:test'
import { describeError, errorKind } from './errors.js'
import { translate } from '../i18n.js'

const err = (props, message = 'x') => Object.assign(new Error(message), props)
const t = (key, vars) => translate('vi', key, vars)

test('errorKind maps backend codes and statuses', () => {
  assert.equal(errorKind(err({ status: 503, code: 'llm_unavailable' })), 'llm_unavailable')
  assert.equal(errorKind(err({ status: 500 })), 'server')
  assert.equal(errorKind(err({ status: 503 })), 'server')
  assert.equal(errorKind(err({ status: 504 })), 'timeout')
  assert.equal(errorKind(err({ status: 429 })), 'rate_limited')
  assert.equal(errorKind(err({ status: 404, code: 'trace_not_found' })), 'not_found')
  assert.equal(errorKind(err({ status: 422, code: 'validation_error' })), 'invalid')
  assert.equal(errorKind(err({ code: 'stream_incomplete' })), 'stream')
  assert.equal(errorKind(Object.assign(new TypeError('Failed to fetch'))), 'network')
  assert.equal(errorKind(new Error('weird')), 'unknown')
  assert.equal(errorKind(null), 'unknown')
})

test('describeError gives plain Vietnamese text and hides raw developer messages from the title', () => {
  const d = describeError(err({ status: 503, code: 'llm_unavailable' }, 'OPENAI_API_KEY is not configured'), t)
  assert.equal(d.kind, 'llm_unavailable')
  assert.equal(d.title, 'Chưa trả lời được câu hỏi này')
  assert.match(d.message, /vẫn tìm sản phẩm/)
  assert.equal(d.retryable, false)
  assert.equal(d.detail, 'OPENAI_API_KEY is not configured')
  assert.ok(!d.title.includes('OPENAI'))
})

test('generic HTTP messages are not repeated as detail; transient errors are retryable', () => {
  const d = describeError(err({ status: 502 }, 'Request failed (502)'), t)
  assert.equal(d.detail, null)
  assert.equal(d.retryable, true)
  assert.equal(describeError(new TypeError('Failed to fetch'), t).retryable, true)
})

test('every error kind has vi and en copy', () => {
  for (const kind of ['llm_unavailable', 'network', 'timeout', 'rate_limited', 'not_found', 'invalid', 'server', 'stream', 'unknown']) {
    for (const lang of ['vi', 'en']) {
      assert.notEqual(translate(lang, `error.${kind}.title`), `error.${kind}.title`)
      assert.notEqual(translate(lang, `error.${kind}.message`), `error.${kind}.message`)
    }
  }
})
