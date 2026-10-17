import assert from 'node:assert/strict'
import test from 'node:test'
import {
  budgetStatus, buildPlanUrl, canPlan, chosenProducts, citationsFor, normalizePlan, parseBudget, parsePlanParams, planTotal, priorityOrder,
  removeChoice, swapChoice,
} from './plan.js'

const item = (id, amount, extra = {}) => ({ product_id: id, title: `T ${id}`, brand: 'B', category: 'backpacks', image_url: null, price: amount == null ? null : { amount, currency: 'USD', synthetic: true }, in_stock: true, score: 1, rank: 1, ...extra })

const RESPONSE = {
  request: 'đi biển dưới 300 đô',
  language: 'vi',
  method: 'rules',
  occasion: { id: 'beach_trip', label: 'Đi biển' },
  budget: 300,
  currency: 'USD',
  total: 245,
  within_budget: true,
  summary: 'Kế hoạch đi biển',
  needs: [
    { id: 'n1', label: 'Ba lô', query: 'backpack', categories: ['backpacks'], priority: 'must', status: 'chosen', chosen: item('M-013', 115), alternatives: [item('M-017', 80), item('M-013', 115)], reason: 'Chống nước', citation_ids: ['product:M-013'] },
    { id: 'n2', label: 'Giày', priority: 'must', status: 'chosen', chosen: item('M-001', 130), alternatives: [item('M-004', 110)], reason: 'Nhẹ', citation_ids: ['product:M-001', 'review:rv_001_1'] },
    { id: 'n3', label: 'Áo gió', priority: 'nice', status: 'skipped_budget', chosen: null, alternatives: [item('M-021', 90), item('M-023', 105)], reason: 'Vượt ngân sách' },
    { id: 'n4', label: 'Kem chống nắng', priority: 'nice', status: 'no_match', chosen: null, alternatives: [] },
  ],
  tips: [{ text: 'Đổi trả 30 ngày', citation_ids: ['policy:returns.window'] }, { text: '' }],
  sources: [
    { citation_id: 'product:M-013', source: 'product', title: 'T M-013' },
    { citation_id: 'product:M-001', source: 'product', title: 'T M-001' },
    { citation_id: 'review:rv_001_1', source: 'review', title: 'r' },
    { citation_id: 'policy:returns.window', source: 'policy', title: 'p' },
  ],
  insufficient_evidence: false,
  notes: ['prices are synthetic'],
  trace_id: 'tr_1',
}

test('plan URL state', () => {
  assert.equal(buildPlanUrl({ query: ' đi biển ', budget: '300' }), '/plan?q=%C4%91i+bi%E1%BB%83n&budget=300')
  assert.deepEqual(parsePlanParams('q=%C4%91i+bi%E1%BB%83n&budget=300'), { query: 'đi biển', budget: 300 })
  assert.deepEqual(parsePlanParams('budget=-2'), { query: '', budget: null })
  assert.equal(buildPlanUrl({}), '/plan')
  assert.equal(parseBudget('$1,250'), 1250)
  assert.equal(parseBudget('abc'), null)
  assert.equal(parseBudget(0), null)
  assert.equal(canPlan('ab'), false)
  assert.equal(canPlan('quà sinh nhật'), true)
  assert.equal(canPlan('x'.repeat(801)), false)
})

test('normalizePlan builds the view model and recomputes the total', () => {
  const plan = normalizePlan(RESPONSE)
  assert.equal(plan.total, 245)
  assert.equal(plan.chosenCount, 2)
  assert.deepEqual(plan.budgetInfo, { hasBudget: true, within: true, over: 0, remaining: 55, pct: 82 })
  assert.deepEqual(plan.needs[0].alternatives.map((a) => a.product_id), ['M-017'], 'chosen item and duplicates are not alternatives')
  assert.equal(plan.needs[2].status, 'skipped_budget')
  assert.equal(plan.needs[3].status, 'no_match')
  assert.equal(plan.tips.length, 1)
  assert.equal(normalizePlan(null), null)
  const weird = normalizePlan({ needs: [{ status: 'chosen', chosen: null, alternatives: [] }, { chosen: item('X', null) }] })
  assert.equal(weird.needs[0].status, 'no_match', 'chosen without an item is not chosen')
  assert.equal(weird.needs[1].status, 'chosen')
  assert.equal(weird.unpricedCount, 1)
  assert.equal(weird.budgetInfo.hasBudget, false)
})

test('swapping an alternative recomputes the total client-side', () => {
  const plan = normalizePlan(RESPONSE)
  const cheaper = swapChoice(plan, 'n1', 'M-017')
  assert.equal(cheaper.needs[0].chosen.product_id, 'M-017')
  assert.deepEqual(cheaper.needs[0].alternatives.map((a) => a.product_id), ['M-013'], 'previous pick becomes an alternative')
  assert.equal(cheaper.total, 210)
  const withJacket = swapChoice(cheaper, 'n3', 'M-021')
  assert.equal(withJacket.needs[2].status, 'chosen', 'a skipped need can be picked')
  assert.equal(withJacket.total, 300)
  assert.equal(withJacket.budgetInfo.within, true)
  const over = swapChoice(withJacket, 'n3', 'M-023')
  assert.equal(over.total, 315)
  assert.deepEqual([over.budgetInfo.within, over.budgetInfo.over], [false, 15])
  assert.equal(swapChoice(plan, 'n1', 'nope'), plan, 'unknown ids leave the plan untouched')
  assert.equal(swapChoice(plan, 'n9', 'M-017'), plan)
  const removed = removeChoice(over, 'n3')
  assert.equal(removed.total, 210)
  assert.equal(removed.needs[2].status, 'skipped_budget')
  assert.equal(removed.needs[2].alternatives[0].product_id, 'M-023')
})

test('budget bar, totals, citations, cart items, priority order', () => {
  assert.deepEqual(budgetStatus(120, null), { hasBudget: false, within: true, over: 0, remaining: null, pct: null })
  assert.deepEqual(budgetStatus(330, 300), { hasBudget: true, within: false, over: 30, remaining: 0, pct: 110 })
  assert.deepEqual(planTotal([{ status: 'chosen', chosen: item('a', 10.105) }, { status: 'skipped_budget', chosen: item('b', 99) }]), { total: 10.11, priced: 1, unpriced: 0 })
  const plan = normalizePlan(RESPONSE)
  assert.deepEqual(citationsFor(plan.sources, plan.needs[1].citationIds).map((c) => c.citation_id), ['product:M-001', 'review:rv_001_1'])
  assert.deepEqual(citationsFor(null, ['x']), [])
  assert.deepEqual(chosenProducts(plan).map((p) => [p.product_id, p.price.amount]), [['M-013', 115], ['M-001', 130]])
  assert.deepEqual(priorityOrder([{ id: 1, priority: 'nice' }, { id: 2, priority: 'must' }]).map((n) => n.id), [2, 1])
})
