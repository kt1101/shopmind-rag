import test from 'node:test'
import assert from 'node:assert/strict'
import { setAuthToken } from '../shared/api/http.js'
import * as mock from './adminMock.js'

mock.setMockDelay(0)

async function signIn() {
  const { data } = await mock.login({ username: 'admin', password: 'admin' })
  setAuthToken(data.access_token)
  return data
}

test('login rejects bad credentials and protected calls need a token', async () => {
  mock.resetAdminMock()
  setAuthToken(null)
  await assert.rejects(mock.login({ username: 'admin', password: 'nope' }), { status: 401 })
  await assert.rejects(mock.getStats(), { status: 401 })
  const data = await signIn()
  assert.equal(data.user.role, 'admin')
  const { data: stats } = await mock.getStats({ days: 14 })
  assert.equal(stats.daily.length, 14)
  assert.ok(stats.latency['search.hybrid'].p95 >= stats.latency['search.hybrid'].p50)
})

test('config save validates and activates a new profile', async () => {
  mock.resetAdminMock()
  await signIn()
  await assert.rejects(mock.saveConfigProfile({ name: 'x', overrides: { 'retrieval.top_k': 0 } }), (err) => {
    assert.equal(err.status, 422)
    assert.equal(err.details[0].field, 'retrieval.top_k')
    return true
  })
  const { data } = await mock.saveConfigProfile({ name: 'k20', overrides: { 'retrieval.top_k': 20 } })
  assert.equal(data.effective.retrieval.top_k, 20)
  const { data: profiles } = await mock.listConfigProfiles()
  assert.equal(profiles.items.filter((p) => p.active).length, 1)
  await mock.activateConfigProfile({ id: 'p1' })
  const { data: cfg } = await mock.getConfig()
  assert.equal(cfg.effective.retrieval.top_k, 10)
  assert.equal(cfg.active_profile.id, 'p1')
})

test('saving defaults.search switches what the mock storefront search runs; rollback restores it', async () => {
  mock.resetAdminMock()
  await signIn()
  const { searchText, setMockDelay } = await import('./mockApi.js')
  setMockDelay(0)
  assert.equal(mock.mockConfigValue('defaults.search'), 'search.hybrid')
  const { data } = await mock.saveConfigProfile({ name: 'search-default-bm25', overrides: { 'defaults.search': 'search.bm25' } })
  assert.equal(data.effective.defaults.search, 'search.bm25')
  assert.equal((await searchText({ query: 'ba lô' })).data.pipeline, 'search.bm25')
  await mock.activateConfigProfile({ id: 'p1' })
  assert.equal((await searchText({ query: 'ba lô' })).data.pipeline, 'search.hybrid')
  mock.resetAdminMock()
})

test('publishing policies starts a reindex job', async () => {
  mock.resetAdminMock()
  await signIn()
  await assert.rejects(mock.createPolicy({ policy: { title: '', content: '', section_id: '', version: 1 } }), { status: 422 })
  const { data: created } = await mock.createPolicy({ policy: { title: 'T', content: 'C', section_id: 'returns.x', policy_type: 'returns', version: 1 } })
  assert.equal(created.status, 'draft')
  const { data } = await mock.publishPolicies({ ids: [created.id] })
  const { data: job } = await mock.getJob({ id: data.job_id })
  assert.equal(job.type, 'reindex_policies')
  assert.ok(['queued', 'running'].includes(job.status))
})

test('cohensKappa', () => {
  assert.deepEqual(mock.cohensKappa([]), { kappa: null, pairs: 0 })
  const perfect = [
    { query: 'q', product_id: 'a', grade: 2, annotator: 'x' }, { query: 'q', product_id: 'a', grade: 2, annotator: 'y' },
    { query: 'q', product_id: 'b', grade: 0, annotator: 'x' }, { query: 'q', product_id: 'b', grade: 0, annotator: 'y' },
  ]
  assert.equal(mock.cohensKappa(perfect).kappa, 1)
  assert.equal(mock.cohensKappa(perfect).pairs, 2)
})

test('traces paginate and filter by kind', async () => {
  mock.resetAdminMock()
  await signIn()
  const { data } = await mock.listTraces({ kind: 'rag', limit: 5 })
  assert.ok(data.items.every((t) => t.kind === 'rag'))
  assert.ok(data.items.length <= 5)
  const { data: trace } = await mock.getTrace({ traceId: data.items[0].trace_id })
  assert.ok(Array.isArray(trace.steps))
})
