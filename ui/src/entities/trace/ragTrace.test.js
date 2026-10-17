import assert from 'node:assert/strict'
import test from 'node:test'
import { ragAskEngine } from '../../mocks/ragEngine.js'
import { candidatesBySource, citationAttempts, contextView, generateView, rewriteView } from './ragTrace.js'
import { splitAnswer, unreferencedSources, citationNumber } from '../citation/citations.js'

const TRACE = {
  kind: 'rag',
  steps: [
    { id: 'rewrite', step: 'rewrite', details: { original: 'is it waterproof', standalone_question: 'Is M-7 waterproof?' } },
    { id: 'route', step: 'route_intent', details: { intent: 'product_question', reason: 'question' } },
    { id: 'retrieve', step: 'multi_source_retrieve', output: { items: [
      { id: 'policy:p1', rank: 1, score: 0.5, title: 'Returns' },
      { id: 'review:r1', rank: 1, score: 0.7, title: 'Dry feet', details: { source: 'review', snippet: 'held up' } },
      { id: 'product:M-7', rank: 1, score: 0.9, title: 'Boot', details: { source: 'product' } },
    ] } },
    { id: 'ctx', step: 'build_context', details: { documents: [
      { id: 'product:M-7', source: 'product', chars: 300, included: true, reason: 'included' },
      { id: 'policy:p1', source: 'policy', chars: 700, included: false, reason: 'over_budget' },
    ], rendered_chars: 300, budget: 900 } },
    { id: 'gen', step: 'generate', details: { model: 'gpt-4.1-mini', prompt_id: 'rag.answer', prompt_version: 'v3', attempt: 2, usage: { input_tokens: 500, output_tokens: 40 }, raw_output: '{"answer":"Yes [c1]"}' } },
    { id: 'val', step: 'validate_citations', details: { attempts: [{ attempt: 1, valid: false, error: 'c9 not in context' }, { attempt: 2, valid: true }] } },
  ],
}

test('candidates are grouped per source in product, review, policy order', () => {
  const groups = candidatesBySource(TRACE)
  assert.deepEqual(groups.map((g) => g.source), ['product', 'review', 'policy'])
  assert.equal(groups[1].items[0].snippet, 'held up')
  assert.deepEqual(candidatesBySource({ steps: [] }), [])
})

test('context view lists included and excluded documents with reasons and budget use', () => {
  const ctx = contextView(TRACE)
  assert.equal(ctx.includedCount, 1)
  assert.equal(ctx.usedPct, 33)
  assert.deepEqual(ctx.documents[1], { id: 'policy:p1', source: 'policy', title: 'Returns', chars: 700, included: false, reason: 'over_budget' })
  assert.equal(contextView({ steps: [] }), null)
})

test('generate details, citation attempts and rewrite', () => {
  const gen = generateView(TRACE)
  assert.equal(gen.model, 'gpt-4.1-mini')
  assert.equal(gen.inputTokens, 500)
  assert.match(gen.rawOutput, /"answer": "Yes \[c1\]"/)
  assert.deepEqual(citationAttempts(TRACE), [{ attempt: 1, valid: false, error: 'c9 not in context' }, { attempt: 2, valid: true, error: null }])
  assert.deepEqual(rewriteView(TRACE), { original: 'is it waterproof', standalone: 'Is M-7 waterproof?', fallback: false, intent: 'product_question', intentReason: 'question' })
  assert.equal(rewriteView({ steps: [] }), null)
})

test('views work on a full mock RAG trace', () => {
  const body = ragAskEngine({ question: 'Có chống nước không? Đổi trả?', product_id: 'M-007', sources: ['product', 'review', 'policy'], explain: true })
  assert.ok(candidatesBySource(body.trace).length >= 2)
  assert.ok(contextView(body.trace).documents.length > 0)
  assert.ok(generateView(body.trace).promptVersion)
  assert.ok(citationAttempts(body.trace).length >= 1)
})

test('splitAnswer turns known [id] markers into citation segments', () => {
  const sources = [{ citation_id: 'c1', title: 'A' }, { citation_id: 'c2', title: 'B' }]
  assert.deepEqual(splitAnswer('Yes [c1]. Also [c1, c2] and [x9].', sources).map((s) => (s.type === 'cite' ? `<${s.id}>` : s.text)), ['Yes ', '<c1>', '. Also ', '<c1>', '<c2>', ' and [x9].'])
  assert.deepEqual(splitAnswer('[c2][c1]', sources).map((s) => s.id), ['c2', 'c1'])
  assert.deepEqual(splitAnswer('plain', []), [{ type: 'text', text: 'plain' }])
  assert.deepEqual(splitAnswer(null, sources), [])
  assert.deepEqual(unreferencedSources('Yes [c1]', sources).map((s) => s.citation_id), ['c2'])
  assert.equal(citationNumber(sources, 'c2'), 2)
  // Legacy sources without citation_id fall back to document_id.
  assert.deepEqual(splitAnswer('ok [product:M-1]', [{ document_id: 'product:M-1' }]).at(-1).type, 'cite')
})
