import assert from 'node:assert/strict'
import test from 'node:test'
import { ragPlan, setMockDelay } from './mockApi.js'
import { detectOccasion, optimizeBudget, parseBudgetFromText } from './planEngine.js'

setMockDelay(0)

test('budget parsing from the request text', () => {
  assert.equal(parseBudgetFromText('Mình mới chuyển vào căn hộ studio, ngân sách 800 đô'), 800)
  assert.equal(parseBudgetFromText('đi biển dưới 300 đô'), 300)
  assert.equal(parseBudgetFromText('quà khoảng 150$'), 150)
  assert.equal(parseBudgetFromText('home office under $500'), 500)
  assert.equal(parseBudgetFromText('budget 1,200 usd'), 1200)
  assert.equal(parseBudgetFromText('đồ cho chó con'), null)
  assert.equal(detectOccasion('Chuẩn bị đi biển 5 ngày').id, 'beach_trip')
  assert.equal(detectOccasion('something else').id, 'general')
})

test('greedy optimizer reserves money for later must-haves', () => {
  const item = (id, amount) => ({ product_id: id, price: { amount } })
  const needs = [
    { id: 'a', priority: 'nice', candidates: [item('x', 60)] },
    { id: 'b', priority: 'must', candidates: [item('y', 80), item('z', 40)] },
    { id: 'c', priority: 'must', candidates: [item('w', 50)] },
    { id: 'd', priority: 'nice', candidates: [] },
  ]
  optimizeBudget(needs, 100)
  assert.deepEqual(needs.map((n) => [n.id, n.status, n.chosen?.product_id ?? null]), [['a', 'skipped_budget', null], ['b', 'chosen', 'z'], ['c', 'chosen', 'w'], ['d', 'no_match', null]])
})

test('POST /rag/plan mock: respects the budget, has skipped/no_match needs, alternatives and cited reasons', async () => {
  const { data } = await ragPlan({ request: 'Chuẩn bị đi biển 5 ngày cho 2 người, dưới 300 đô', explain: true })
  assert.equal(data.method, 'rules')
  assert.equal(data.language, 'vi')
  assert.equal(data.budget, 300)
  assert.ok(data.total <= 300 && data.within_budget)
  const chosenTotal = data.needs.filter((n) => n.status === 'chosen').reduce((s, n) => s + n.chosen.price.amount, 0)
  assert.equal(data.total, chosenTotal)
  assert.ok(data.needs.some((n) => n.status === 'skipped_budget' && n.chosen === null && n.alternatives.length > 0))
  assert.ok(data.needs.some((n) => n.status === 'no_match' && n.alternatives.length === 0))
  const ids = new Set(data.sources.map((s) => s.citation_id))
  for (const need of data.needs.filter((n) => n.status === 'chosen')) {
    assert.ok(need.alternatives.length > 0)
    assert.ok(need.citation_ids.length > 0 && need.citation_ids.every((id) => ids.has(id)), 'reasons cite evidence that was returned')
    assert.deepEqual(Object.keys(need.chosen).sort(), ['brand', 'category', 'image_url', 'in_stock', 'price', 'product_id', 'rank', 'score', 'title'])
    assert.equal(need.chosen.price.synthetic, true)
  }
  assert.ok(data.tips.length > 0 && data.tips.every((t) => t.citation_ids.every((id) => ids.has(id))))
  assert.deepEqual([...new Set(data.trace.steps.map((s) => s.step))], ['decompose', 'retrieve', 'optimize_budget', 'build_context', 'justify'])
  assert.equal(data.trace.steps.filter((s) => s.step === 'retrieve').length, data.needs.length, 'one retrieve step per need')
  assert.equal(data.trace.pipeline, 'rag.plan')
})

test('planner mock: explicit budget wins, no budget means no limit, short requests fail', async () => {
  const { data } = await ragPlan({ request: 'Quà sinh nhật cho bạn gái khoảng 150 đô', budget: 400, language: 'en' })
  assert.equal(data.budget, 400)
  assert.equal(data.language, 'en')
  assert.equal(data.trace, undefined, 'trace only with explain')
  const free = await ragPlan({ request: 'Đồ dùng cho chó con mới về nhà' })
  assert.equal(free.data.budget, null)
  assert.equal(free.data.within_budget, true)
  await assert.rejects(ragPlan({ request: 'ab' }), { status: 422 })
})
