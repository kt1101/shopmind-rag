import assert from 'node:assert/strict'
import test from 'node:test'
import { budgetView, decomposeView, isPlanTrace, planMethod, retrievalsByNeed } from './planTrace.js'

const TRACE = {
  trace_id: 't', pipeline: 'rag.plan', kind: 'rag', duration_ms: 60,
  steps: [
    { id: 'decompose', step: 'decompose', impl: 'rules', details: { occasion: { id: 'beach_trip', label: 'Đi biển' }, budget: 300, budget_source: 'parsed_from_text', needs: [{ id: 'n1', label: 'Ba lô', query: 'backpack', categories: ['backpacks'], priority: 'must' }, { id: 'n2', label: 'Kem' }] } },
    { id: 'n1', step: 'retrieve', impl: 'hybrid', duration_ms: 20, output: { items: [{ id: 'M-013', title: 'Roll-top', rank: 1, score: 0.9, details: { price: 115 } }, { id: 'M-017', rank: 2, score: 0.5 }] } },
    { id: 'n2', step: 'retrieve', impl: 'skip', params: { query: 'sunscreen' } },
    { id: 'budget', step: 'optimize_budget', impl: 'greedy', details: { budget: 300, total: 115, within_budget: true, decisions: [{ need_id: 'n1', status: 'chosen', product_id: 'M-013', price: 115 }, { need_id: 'n2', status: 'no_match' }] } },
    { id: 'justify', step: 'justify', impl: 'extractive' },
  ],
}

test('planner traces are recognised by pipeline, kind or steps', () => {
  assert.equal(isPlanTrace(TRACE), true)
  assert.equal(isPlanTrace({ kind: 'plan', steps: [] }), true)
  assert.equal(isPlanTrace({ pipeline: 'x', steps: [{ step: 'optimize_budget' }] }), true)
  assert.equal(isPlanTrace({ pipeline: 'rag.answer', kind: 'rag', steps: [{ step: 'generate' }] }), false)
  assert.equal(isPlanTrace(null), false)
})

test('flattened inner search steps are ignored; a choices map becomes decisions', () => {
  const trace = {
    pipeline: 'rag.plan', kind: 'plan',
    steps: [
      { id: 'decompose', step: 'decompose', impl: 'rules', details: { budget: 300, needs: [{ id: 'n1', label: 'Vali' }, { id: 'n2', label: 'Dép' }] } },
      { id: 'n1', step: 'retrieve', impl: 'search', output: { items: [{ id: 'A', details: { price: 98.99 } }] } },
      { id: 'lexical', step: 'retrieve', impl: 'bm25' },
      { id: 'semantic', step: 'retrieve', impl: 'dense' },
      { id: 'n2', step: 'retrieve', impl: 'search' },
      { id: 'lexical', step: 'retrieve', impl: 'bm25' },
      { id: 'optimize_budget', step: 'optimize_budget', impl: 'dp', details: { choices: { n1: 'A', n2: null }, total: 98.99 } },
    ],
  }
  assert.deepEqual(retrievalsByNeed(trace).map((x) => x.key), ['n1', 'n2'])
  const b = budgetView(trace)
  assert.deepEqual([b.budget, b.total, b.withinBudget, b.impl], [300, 98.99, true, 'dp'])
  assert.deepEqual(b.decisions.map((x) => [x.needId, x.status, x.productId]), [['n1', 'chosen', 'A'], ['n2', 'skipped_budget', null]])
  const noDecompose = { steps: [{ id: 'lexical', step: 'retrieve' }, { id: 'lexical', step: 'retrieve' }] }
  assert.deepEqual(retrievalsByNeed(noDecompose).map((x) => x.key), ['lexical', 'lexical#2'])
})

test('decompose, per-need retrieval and budget views', () => {
  const d = decomposeView(TRACE)
  assert.equal(d.occasion, 'Đi biển')
  assert.equal(d.budget, 300)
  assert.deepEqual(d.needs.map((n) => [n.id, n.label, n.priority]), [['n1', 'Ba lô', 'must'], ['n2', 'Kem', null]])
  const r = retrievalsByNeed(TRACE)
  assert.deepEqual(r.map((x) => [x.needId, x.label, x.items.length]), [['n1', 'Ba lô', 2], ['n2', 'Kem', 0]])
  assert.deepEqual(r[0].items[0], { id: 'M-013', title: 'Roll-top', rank: 1, score: 0.9, price: 115 })
  assert.equal(r[0].items[1].price, null)
  const b = budgetView(TRACE)
  assert.deepEqual([b.budget, b.total, b.withinBudget], [300, 115, true])
  assert.deepEqual(b.decisions[1], { needId: 'n2', status: 'no_match', productId: null, price: null, reason: null })
  assert.equal(planMethod(TRACE), 'rules')
  assert.ok(r.every((x) => x.key === x.needId))
  assert.equal(planMethod({ steps: [{ step: 'generate' }] }), 'llm')
  assert.equal(decomposeView({ steps: [] }), null)
  assert.equal(budgetView(null), null)
})
