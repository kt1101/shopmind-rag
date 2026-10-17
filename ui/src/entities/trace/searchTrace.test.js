import assert from 'node:assert/strict'
import test from 'node:test'
import { searchComposeEngine, searchTextEngine } from '../../mocks/searchEngine.js'
import {
  composeView, fuseK, highlightSegments, matchedTermsView, queryDslView, queryView, rankMovementLayout, rankingColumns, rankingTable, rrfBreakdown,
} from './searchTrace.js'
import { isSearchTrace, timeTicks, traceSummary, waterfall } from './traceModel.js'

// The example trace from docs/API_CONTRACT.md (trimmed).
const CONTRACT_TRACE = {
  trace_id: '9f2c',
  pipeline: 'search.hybrid',
  kind: 'search',
  duration_ms: 63.1,
  input: { query: 'giày bốt da nâu', filters: {}, mode: 'hybrid' },
  steps: [
    { id: 'lexical', step: 'retrieve', impl: 'bm25', params: { candidate_k: 100 }, started_ms: 1.2, duration_ms: 22.4, summary: '100 candidates from BM25',
      notes: ["alias 'giày bốt' -> category 'boot'"],
      output: { items: [
        { id: 'B07XYZ', rank: 1, score: 12.3, title: 'Leather boot', details: { matched_terms: { title: ['leather', 'boot'] } } },
        { id: 'B08AAA', rank: 2, score: 9.1, title: 'Brown shoe', details: { matched_terms: { description: ['brown'] } } },
      ], total: 100 } },
    { id: 'semantic', step: 'retrieve', impl: 'knn', started_ms: 1.4, duration_ms: 30,
      output: { items: [{ id: 'B08AAA', rank: 1, score: 0.8 }, { id: 'B09CCC', rank: 2, score: 0.7 }, { id: 'B07XYZ', rank: 3, score: 0.6 }] } },
    { id: 'fuse', step: 'fuse', impl: 'rrf', params: { k: 60 }, started_ms: 31.6, duration_ms: 0.4,
      output: { items: [
        { id: 'B07XYZ', rank: 1, score: 0.0325, details: { contributions: { lexical: { rank: 1, score: 0.0164 }, semantic: { rank: 3, score: 0.0159 } } } },
        { id: 'B08AAA', rank: 2, score: 0.0325 },
        { id: 'B09CCC', rank: 3, score: 0.0161 },
      ] } },
  ],
  output: { result_ids: ['B07XYZ', 'B08AAA', 'B09CCC'] },
}

test('summary, kind detection and waterfall', () => {
  assert.deepEqual(traceSummary(CONTRACT_TRACE), { traceId: '9f2c', pipeline: 'search.hybrid', kind: 'search', createdAt: null, durationMs: 63.1, stepCount: 3 })
  assert.equal(isSearchTrace(CONTRACT_TRACE), true)
  assert.equal(isSearchTrace({ kind: 'rag', steps: [] }), false)
  const w = waterfall(CONTRACT_TRACE)
  assert.equal(w.total, 63.1)
  assert.deepEqual(w.rows.map((r) => [r.id, r.start, r.end]), [['lexical', 1.2, 23.6], ['semantic', 1.4, 31.4], ['fuse', 31.6, 32]])
  assert.ok(w.rows[2].widthPct >= 0.4)
  // Steps without timings are laid out one after another.
  const seq = waterfall({ steps: [{ id: 'a', duration_ms: 5 }, { id: 'b', duration_ms: 3 }] })
  assert.deepEqual(seq.rows.map((r) => r.start), [0, 5])
  assert.deepEqual(timeTicks(63.1), [0, 20, 40, 60])
  assert.deepEqual(waterfall(null), { total: 0, rows: [] })
})

test('ranking table aligns each product across retrievers, fusion and final', () => {
  const table = rankingTable(CONTRACT_TRACE)
  assert.deepEqual(table.columns.map((c) => c.id), ['lexical', 'semantic', 'fuse', 'final'])
  assert.deepEqual(table.rows.map((r) => r.id), ['B07XYZ', 'B08AAA', 'B09CCC'])
  assert.deepEqual(table.rows[0].ranks, { lexical: 1, semantic: 3, fuse: 1, final: 1 })
  assert.deepEqual(table.rows[2].ranks, { lexical: null, semantic: 2, fuse: 3, final: 3 })
  assert.equal(table.rows[0].title, 'Leather boot')
  assert.equal(table.rows[2].title, 'B09CCC')
  assert.equal(rankingTable(CONTRACT_TRACE, { titles: { B09CCC: 'Canvas boot' } }).rows[2].title, 'Canvas boot')
})

test('RRF breakdown fills the formula with real numbers', () => {
  const row = rankingTable(CONTRACT_TRACE).rows[0]
  const rrf = rrfBreakdown(row, fuseK(CONTRACT_TRACE))
  assert.equal(rrf.symbolic, '1/(60+1) + 1/(60+3)')
  assert.equal(rrf.denominators, '1/61 + 1/63')
  assert.equal(rrf.values, '0.016400 + 0.015900')
  assert.equal(rrf.total, 0.0323)
  // Without precomputed scores the contribution is 1/(k+rank).
  const computed = rrfBreakdown({ contributions: { a: { rank: 1 } } }, 60)
  assert.equal(computed.total, Number((1 / 61).toFixed(6)))
  assert.equal(rrfBreakdown({ contributions: null }), null)
})

test('rank movement layout places every product on every column', () => {
  const layout = rankMovementLayout(rankingTable(CONTRACT_TRACE), { width: 400, height: 200 })
  assert.equal(layout.columns.length, 4)
  assert.ok(layout.columns[0].x < layout.columns[3].x)
  const first = layout.lines[0].points
  assert.equal(first.length, 4)
  assert.ok(first[0].y < first[1].y, 'rank 1 sits above rank 3')
  const third = layout.lines[2].points[0]
  assert.equal(third.outside, true)
  assert.equal(third.y, layout.outsideY)
  assert.equal(rankMovementLayout({ columns: [], rows: [] }).lines.length, 0)
})

test('matched terms and highlighting', () => {
  const view = matchedTermsView(CONTRACT_TRACE)
  assert.equal(view.stepId, 'lexical')
  assert.deepEqual(view.rows[0].fields, { title: ['leather', 'boot'] })
  assert.deepEqual(highlightSegments('Brown Leather Boots', ['boot', 'leather']), [
    { text: 'Brown ', match: false }, { text: 'Leather', match: true }, { text: ' ', match: false }, { text: 'Boots', match: true },
  ])
  assert.deepEqual(highlightSegments('Reboot', ['boot']), [{ text: 'Reboot', match: false }], 'matches word starts only')
  assert.deepEqual(highlightSegments('Giày bốt (da)', ['bốt', '(']), [{ text: 'Giày ', match: false }, { text: 'bốt', match: true }, { text: ' (da)', match: false }])
  assert.deepEqual(highlightSegments('', ['x']), [])
  assert.deepEqual(matchedTermsView({ steps: [] }), { stepId: null, rows: [] })
})

test('views over a full mock hybrid trace (query understanding, DSL, dense vector)', () => {
  const { trace } = searchTextEngine({ query: 'giày bốt da màu nâu', filters: { brand: ['north'] }, explain: true })
  const q = queryView(trace)
  assert.equal(q.present, true)
  assert.equal(q.language, 'vi')
  assert.equal(q.aliases.length, 2)
  assert.deepEqual(q.filters, [{ field: 'brand', requested: ['north'], resolved: ['Northpeak'], match: 'fallback' }])
  assert.deepEqual(q.dense[0], { id: 'semantic', field: 'text_vector', embedder: 'intfloat/multilingual-e5-base', dims: 768, norm: 1 })
  assert.ok(q.notes.some((n) => n.note.includes('alias')))
  assert.ok(queryDslView(trace).dsl.query.bool.filter)
  const table = rankingTable(trace)
  assert.deepEqual(table.columns.map((c) => c.kind), ['retrieve', 'retrieve', 'fuse', 'final'])
  assert.ok(table.rows[0].rerank && Number.isFinite(table.rows[0].rerank.before))
  assert.equal(rankingColumns({ steps: [] }).length, 0)
})

test('compose view reads alpha and formula; queryView tolerates missing understanding', () => {
  const { trace } = searchComposeEngine({ file: { name: 'M-009.png', size: 1 }, text: 'màu đen', alpha: 0.35, explain: true })
  assert.deepEqual(composeView(trace).alpha, 0.35)
  assert.match(composeView(trace).formula, /normalize/)
  assert.equal(composeView({ steps: [] }), null)
  const empty = queryView({ steps: [] })
  assert.equal(empty.present, false)
  assert.deepEqual(empty.aliases, [])
})
