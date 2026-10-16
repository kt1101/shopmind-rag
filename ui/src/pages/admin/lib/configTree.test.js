import test from 'node:test'
import assert from 'node:assert/strict'
import {
  coerceInput, diffConfig, fieldErrorsFrom, flattenConfig, getAtPath, inferInputType,
  normalizeHotReloadable, overridesFromDiff, toTree, unflattenConfig,
} from './configTree.js'

const config = {
  retrieval: { default_mode: 'hybrid', top_k: 10 },
  fusion: { rrf_k: 60, weights: { lexical: 0.5 } },
  reranker: { enabled: false },
  rag: { chat: { sources: ['product', 'policy'] } },
  empty: {},
}

test('flattenConfig produces dotted keys with arrays as leaves', () => {
  assert.deepEqual(flattenConfig(config), {
    'retrieval.default_mode': 'hybrid',
    'retrieval.top_k': 10,
    'fusion.rrf_k': 60,
    'fusion.weights.lexical': 0.5,
    'reranker.enabled': false,
    'rag.chat.sources': ['product', 'policy'],
    empty: {},
  })
})

test('unflattenConfig inverts flattenConfig', () => {
  assert.deepEqual(unflattenConfig(flattenConfig(config)), config)
  assert.deepEqual(unflattenConfig({}), {})
})

test('getAtPath reads nested values', () => {
  assert.equal(getAtPath(config, 'fusion.weights.lexical'), 0.5)
  assert.equal(getAtPath(config, 'fusion.nope.x'), undefined)
})

test('diffConfig lists only changed draft keys, sorted', () => {
  const active = flattenConfig(config)
  const draft = { 'retrieval.top_k': 20, 'reranker.enabled': false, 'fusion.rrf_k': 30, 'rag.chat.sources': ['product', 'policy'] }
  const diff = diffConfig(active, draft)
  assert.deepEqual(diff, [
    { key: 'fusion.rrf_k', from: 60, to: 30 },
    { key: 'retrieval.top_k', from: 10, to: 20 },
  ])
  assert.deepEqual(overridesFromDiff(diff), { 'fusion.rrf_k': 30, 'retrieval.top_k': 20 })
  assert.deepEqual(diffConfig(active, {}), [])
  assert.deepEqual(diffConfig(active, { 'rag.chat.sources': ['product'] }), [
    { key: 'rag.chat.sources', from: ['product', 'policy'], to: ['product'] },
  ])
})

test('inferInputType infers from values and hints', () => {
  assert.deepEqual(inferInputType('retrieval.top_k', 10), { type: 'integer', min: undefined, max: undefined, step: 1 })
  assert.equal(inferInputType('fusion.weights.lexical', 0.5).type, 'number')
  assert.equal(inferInputType('fusion.weights.lexical', 1).type, 'number', 'JSON 1.0 weights stay floats')
  assert.equal(inferInputType('rag.llm.temperature', 0).type, 'number')
  assert.equal(inferInputType('reranker.enabled', false).type, 'boolean')
  assert.deepEqual(inferInputType('retrieval.default_mode', 'hybrid').options, ['bm25', 'dense', 'hybrid', 'cross_modal', 'adaptive'])
  assert.equal(inferInputType('search.mode', 'dense').type, 'enum')
  assert.equal(inferInputType('search.mode', 'weird').type, 'string')
  assert.equal(inferInputType('llm.model', 'gpt-4.1-mini').type, 'string')
  assert.equal(inferInputType('rag.chat.sources', ['a']).type, 'json')
  assert.deepEqual(inferInputType('llm.prompt_version', 'v1', { options: ['v1', 'v2'] }), { type: 'enum', options: ['v1', 'v2'] })
  assert.equal(inferInputType('x', 3, { type: 'number', min: 0, max: 1 }).type, 'number')
})

test('normalizeHotReloadable accepts strings and objects', () => {
  assert.deepEqual(normalizeHotReloadable(['a.b', { key: 'c', type: 'enum', options: ['x'] }, null]), [
    { key: 'a.b' }, { key: 'c', type: 'enum', options: ['x'] },
  ])
})

test('coerceInput validates and converts', () => {
  assert.deepEqual(coerceInput({ type: 'integer' }, '12'), { value: 12 })
  assert.deepEqual(coerceInput({ type: 'integer' }, '1.5'), { error: 'Must be an integer' })
  assert.deepEqual(coerceInput({ type: 'number', min: 0, max: 1 }, '2'), { error: 'Must be ≤ 1' })
  assert.deepEqual(coerceInput({ type: 'number' }, ''), { error: 'Required' })
  assert.deepEqual(coerceInput({ type: 'number' }, 'abc'), { error: 'Must be a number' })
  assert.deepEqual(coerceInput({ type: 'boolean' }, 'true'), { value: true })
  assert.deepEqual(coerceInput({ type: 'enum', options: ['a'] }, 'b'), { error: 'Not an allowed value' })
  assert.deepEqual(coerceInput({ type: 'json' }, '["a"]'), { value: ['a'] })
  assert.deepEqual(coerceInput({ type: 'json' }, '[a'), { error: 'Invalid JSON' })
  assert.deepEqual(coerceInput({ type: 'string' }, 'x'), { value: 'x' })
})

test('fieldErrorsFrom maps 422 bodies to dotted keys', () => {
  assert.deepEqual(fieldErrorsFrom({ details: [{ field: 'retrieval.top_k', message: 'too big' }] }), { 'retrieval.top_k': 'too big' })
  assert.deepEqual(fieldErrorsFrom({ body: { detail: [{ loc: ['body', 'overrides', 'fusion', 'rrf_k'], msg: 'bad' }] } }), { 'fusion.rrf_k': 'bad' })
  assert.deepEqual(fieldErrorsFrom({ message: 'retrieval.top_k: must be <= 100' }), { 'retrieval.top_k': 'must be <= 100' })
  assert.deepEqual(fieldErrorsFrom({ message: 'Validation failed' }), {})
})

test('toTree nests children', () => {
  const tree = toTree({ a: { b: 1 }, c: 2 })
  assert.deepEqual(tree, [
    { key: 'a', path: 'a', children: [{ key: 'b', path: 'a.b', value: 1 }] },
    { key: 'c', path: 'c', value: 2 },
  ])
})
