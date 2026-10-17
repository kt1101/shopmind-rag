import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultSearchHistory, defaultSearchProfileName, isPublicPipeline, searchPipelineOptions, storefrontPipelineChoices } from './pipelines.js'

const PIPELINES = [
  { name: 'search.hybrid_rerank', kind: 'search', public: false, description: 'eval only' },
  { name: 'search.bm25', kind: 'search', public: true, description: 'BM25' },
  { name: 'search.hybrid_linear', kind: 'search', description: 'no flag = public' },
  { name: 'search.image', kind: 'image_search', public: true },
  { name: 'rag.answer', kind: 'rag' },
  { name: 'search.bm25', kind: 'search', public: true, description: 'duplicate' },
  null,
]

test('public flag: missing counts as public', () => {
  assert.equal(isPublicPipeline({}), true)
  assert.equal(isPublicPipeline({ public: false }), false)
})

test('playground options: text-search only, default first, hidden last, deduped', () => {
  const options = searchPipelineOptions(PIPELINES, { defaultName: 'search.hybrid_linear' })
  assert.deepEqual(options.map((p) => [p.name, p.hidden, p.isDefault]), [
    ['search.hybrid_linear', false, true],
    ['search.bm25', false, false],
    ['search.hybrid_rerank', true, false],
  ])
  assert.deepEqual(searchPipelineOptions(PIPELINES, { includeHidden: false }).map((p) => p.name), ['search.bm25', 'search.hybrid_linear'])
  assert.deepEqual(searchPipelineOptions(null), [])
})

test('storefront choices are public only but keep the active value visible', () => {
  assert.deepEqual(storefrontPipelineChoices(PIPELINES, 'search.bm25').map((p) => p.name), ['search.bm25', 'search.hybrid_linear'])
  const withHiddenActive = storefrontPipelineChoices(PIPELINES, 'search.hybrid_rerank')
  assert.equal(withHiddenActive[0].name, 'search.hybrid_rerank')
  assert.equal(withHiddenActive[0].hidden, true)
  assert.equal(withHiddenActive[0].description, 'eval only')
})

test('profile names and the defaults.search history', () => {
  assert.equal(defaultSearchProfileName('search.hybrid_linear'), 'search-default-hybrid_linear')
  assert.equal(defaultSearchProfileName('search.bm25'), 'search-default-bm25')
  assert.equal(defaultSearchProfileName(''), 'search-default-pipeline')
  const history = defaultSearchHistory([
    { id: 3, name: 'search-default-bm25', overrides: { 'defaults.search': 'search.bm25' }, active: true, created_at: 't3', created_by: 'admin' },
    { id: 2, name: 'rrf', overrides: { 'fusion.rrf_k': 30 } },
    { id: 1, name: 'baseline', overrides: {} },
  ])
  assert.deepEqual(history, [{ id: 3, name: 'search-default-bm25', pipeline: 'search.bm25', createdAt: 't3', createdBy: 'admin', active: true }])
})
