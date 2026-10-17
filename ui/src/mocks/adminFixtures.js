// Fixtures for the Admin Console mock API (VITE_MOCK_API=1). All numbers are synthetic demo
// data, not measurements: never quote them in reports.

export const MOCK_USERS = {
  admin: { password: 'admin', role: 'admin' },
  annotator: { password: 'annotator', role: 'annotator' },
}

export const EFFECTIVE_CONFIG = {
  elasticsearch: { url: 'http://elasticsearch:9200', index_alias: 'products' },
  embedding: {
    provider: 'siglip2',
    model_name: 'google/siglip2-base-patch16-224',
    batch_size: 32,
  },
  retrieval: { default_mode: 'hybrid', top_k: 10, candidate_k: 100 },
  fusion: { method: 'rrf', lexical_preserving: true, rrf_k: 60, weights: { lexical: 1.0, semantic: 1.0 } },
  reranker: { enabled: false, model: 'cross-encoder/ms-marco-MiniLM-L-6-v2', top_n: 20 },
  api: { max_image_bytes: 5242880 },
  rag: {
    enabled: true,
    fusion: 'rrf',
    retrieval_mode: 'hybrid',
    context: { max_chars: 6000, per_source_max: 4 },
    llm: { model: 'gpt-4.1-mini', temperature: 0.2, prompt_version: 'v2' },
    chat: { sources: ['product', 'policy'], include_reviews_when_available: true },
  },
  auth: { enabled: true, token_ttl_minutes: 120 },
  // Pipeline the storefront runs when a request names no mode/pipeline (hot-reloadable).
  defaults: { search: 'search.hybrid', rag: 'rag.ask' },
}

export const HOT_RELOADABLE = [
  'retrieval.default_mode',
  'retrieval.top_k',
  'retrieval.candidate_k',
  'fusion.rrf_k',
  'fusion.weights.lexical',
  'fusion.weights.semantic',
  'reranker.enabled',
  'reranker.top_n',
  'rag.fusion',
  'rag.retrieval_mode',
  'rag.context.max_chars',
  'rag.llm.model',
  'rag.llm.temperature',
  { key: 'rag.llm.prompt_version', type: 'enum', options: ['v1', 'v2', 'v3-experimental'] },
  'defaults.search',
]

// Validation rules the mock applies on PUT /admin/config (mirrors what Pydantic would enforce).
export const CONFIG_RULES = {
  'retrieval.top_k': { min: 1, max: 100, integer: true },
  'retrieval.candidate_k': { min: 10, max: 1000, integer: true },
  'fusion.rrf_k': { min: 1, max: 1000, integer: true },
  'fusion.weights.lexical': { min: 0, max: 5 },
  'fusion.weights.semantic': { min: 0, max: 5 },
  'reranker.top_n': { min: 1, max: 100, integer: true },
  'rag.context.max_chars': { min: 500, max: 32000, integer: true },
  'rag.llm.temperature': { min: 0, max: 2 },
}

export const INITIAL_PROFILES = [
  { id: 'p1', name: 'baseline', created_at: '2026-10-10T08:00:00Z', created_by: 'admin', overrides: {}, active: true },
  { id: 'p2', name: 'rrf-k30-rerank', created_at: '2026-10-12T14:22:00Z', created_by: 'admin', overrides: { 'fusion.rrf_k': 30, 'reranker.enabled': true }, active: false },
]

export const PIPELINES = ['search.bm25', 'search.dense', 'search.hybrid', 'search.image', 'search.compose', 'rag.ask', 'chat']

export const QUERIES = [
  'giày bốt da nâu', 'black leather handbag', 'running shoes', 'sofa xám', 'office chair ergonomic',
  'wireless earbuds', 'túi xách đen', 'standing desk', 'summer dress', 'B07XYZ1234',
  'kids backpack', 'ceramic mug', 'đèn ngủ', 'yoga mat', 'mechanical keyboard',
]

export const ZERO_RESULT_QUERIES = ['dép tổ ong', 'áo dài cách tân', 'airfryer 5l', 'nồi cơm điện', 'quần jean ống loe']

export const PRODUCTS = [
  { product_id: 'B07BOOT001', title: 'Men\'s Leather Chelsea Boot, Brown', brand: 'Amazon Essentials', category: 'boot' },
  { product_id: 'B07BOOT002', title: 'Women\'s Ankle Boot with Side Zip', brand: 'The Drop', category: 'boot' },
  { product_id: 'B07BAG0003', title: 'Black Leather Tote Handbag', brand: 'Find.', category: 'handbag' },
  { product_id: 'B07BAG0004', title: 'Crossbody Bag, Faux Leather', brand: 'Amazon Essentials', category: 'handbag' },
  { product_id: 'B07SHOE005', title: 'Lightweight Running Shoe', brand: 'Amazon Essentials', category: 'shoes' },
  { product_id: 'B07SOFA006', title: '3-Seat Sofa, Grey Fabric', brand: 'Rivet', category: 'sofa' },
  { product_id: 'B07CHAI007', title: 'Ergonomic Mesh Office Chair', brand: 'AmazonBasics', category: 'office_chair' },
  { product_id: 'B07DESK008', title: 'Electric Standing Desk 120cm', brand: 'Rivet', category: 'desk' },
  { product_id: 'B07MUG0009', title: 'Stoneware Coffee Mug Set of 4', brand: 'Stone & Beam', category: 'mug' },
  { product_id: 'B07LAMP010', title: 'Bedside Table Lamp, Linen Shade', brand: 'Rivet', category: 'lamp' },
  { product_id: 'B07MAT0011', title: 'Non-slip Yoga Mat 6mm', brand: 'AmazonBasics', category: 'yoga_mat' },
  { product_id: 'B07KEYB012', title: 'Mechanical Keyboard, Brown Switches', brand: 'AmazonBasics', category: 'keyboard' },
]

export const INDEXES = [
  { alias: 'products', index: 'products_a1_1500_v2', doc_count: 1500, vector_fields: { text_vector: 768, image_vector: 768, e5_vector: 1024 }, embedder_ids: ['siglip2-base-patch16-224@75de2d5', 'multilingual-e5-base'] },
  { alias: 'reviews', index: 'reviews_a3_v1', doc_count: 8420, vector_fields: { text_vector: 768 }, embedder_ids: ['siglip2-base-patch16-224@75de2d5'] },
  { alias: 'policies', index: 'policies_a3_v3', doc_count: 24, vector_fields: { text_vector: 768 }, embedder_ids: ['siglip2-base-patch16-224@75de2d5'] },
]

export const INITIAL_JOBS = [
  { id: 'job_0003', type: 'run_eval', status: 'succeeded', params: { config: 'configs/experiments/hybrid.yaml' }, log: 'Loaded 150 queries\nRecall@10=0.612 nDCG@10=0.488 MRR@10=0.455 (mock)\nWrote runs/20261014_hybrid', created_at: '2026-10-14T09:12:00Z', finished_at: '2026-10-14T09:15:41Z' },
  { id: 'job_0002', type: 'reindex_policies', status: 'failed', params: {}, log: 'Building policies_a3_v3\nValidation failed: kNN smoke search returned 0 hits\nAlias not switched', created_at: '2026-10-13T16:40:00Z', finished_at: '2026-10-13T16:41:02Z' },
  { id: 'job_0001', type: 'build_embedding_map', status: 'succeeded', params: { space: 'text' }, log: 'PCA on 1500 x 768\nWrote embedding_map/text.json', created_at: '2026-10-12T11:00:00Z', finished_at: '2026-10-12T11:00:37Z' },
]

export const INITIAL_POLICIES = [
  { id: 'pol_1', policy_id: 'returns', section_id: 'returns.window', title: 'Return window', content: 'Most items can be returned within 30 days of delivery for a full refund. Items must be unused and in original packaging.', policy_type: 'returns', version: 3, status: 'published', updated_at: '2026-10-10T08:00:00Z' },
  { id: 'pol_2', policy_id: 'returns', section_id: 'returns.exceptions', title: 'Non-returnable items', content: 'Personal care items, gift cards and final-sale products cannot be returned.', policy_type: 'returns', version: 2, status: 'published', updated_at: '2026-10-09T08:00:00Z' },
  { id: 'pol_3', policy_id: 'shipping', section_id: 'shipping.standard', title: 'Standard shipping', content: 'Standard shipping takes 3–5 business days. Orders over $35 ship free.', policy_type: 'shipping', version: 1, status: 'published', updated_at: '2026-10-08T08:00:00Z' },
  { id: 'pol_4', policy_id: 'warranty', section_id: 'warranty.electronics', title: 'Electronics warranty', content: 'Electronics carry a 12-month limited warranty against manufacturing defects.', policy_type: 'warranty', version: 1, status: 'draft', updated_at: '2026-10-15T10:30:00Z' },
]

export const POLICY_TYPES = ['returns', 'shipping', 'warranty', 'payment', 'privacy', 'other']

// Placeholder metrics so the compare view has something to draw. Not measured results.
export const EVAL_RUNS = [
  { id: 'run_bm25', name: 'bm25', kind: 'a1', created_at: '2026-10-11T10:00:00Z', metrics: { 'recall@10': 0.512, 'ndcg@10': 0.401, 'mrr@10': 0.377 }, config: { retrieval: { mode: 'bm25', top_k: 10 }, benchmark: 'evaluation/benchmarks/a1', seed: 42 } },
  { id: 'run_dense', name: 'dense_siglip_text', kind: 'a1', created_at: '2026-10-11T10:20:00Z', metrics: { 'recall@10': 0.338, 'ndcg@10': 0.251, 'mrr@10': 0.236 }, config: { retrieval: { mode: 'dense', top_k: 10 }, embedder: 'siglip2', seed: 42 } },
  { id: 'run_hybrid', name: 'hybrid_rrf60', kind: 'a1', created_at: '2026-10-11T10:40:00Z', metrics: { 'recall@10': 0.574, 'ndcg@10': 0.452, 'mrr@10': 0.421 }, config: { retrieval: { mode: 'hybrid', top_k: 10 }, fusion: { method: 'rrf', rrf_k: 60 }, seed: 42 } },
  { id: 'run_hybrid_rr', name: 'hybrid_rrf30_rerank', kind: 'a1', created_at: '2026-10-14T09:15:00Z', metrics: { 'recall@10': 0.612, 'ndcg@10': 0.488, 'mrr@10': 0.455 }, config: { retrieval: { mode: 'hybrid', top_k: 10 }, fusion: { method: 'rrf', rrf_k: 30 }, reranker: { enabled: true }, seed: 42 } },
  { id: 'run_s3', name: 's3_hybrid_rerank', kind: 'a3', created_at: '2026-10-14T12:00:00Z', metrics: { 'recall@10': 0.66, 'ndcg@10': 0.52, 'mrr@10': 0.49, context_recall: 0.71 }, config: { experiment: { name: 's3' }, rag: { fusion: 'rrf', rerank: true } } },
  { id: 'run_s4', name: 's4_generation', kind: 'a3', created_at: '2026-10-14T12:30:00Z', metrics: { 'recall@10': 0.66, 'ndcg@10': 0.52, 'mrr@10': 0.49, context_recall: 0.71, citation_precision: 0.83, faithfulness: 0.78 }, config: { experiment: { name: 's4' }, rag: { fusion: 'rrf', rerank: true, generate: true } } },
]

const TRACE_KINDS = ['search', 'search', 'search', 'image_search', 'compose_search', 'rag', 'chat', 'compare']
const KIND_PIPELINE = { search: 'search.hybrid', image_search: 'search.image', compose_search: 'search.compose', rag: 'rag.ask', chat: 'chat', compare: 'rag.compare' }

// Small deterministic PRNG so the mock looks the same on every load.
export function seeded(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

export function buildTraces(count = 57, now = Date.parse('2026-10-16T12:00:00Z')) {
  const rand = seeded(7)
  return Array.from({ length: count }, (_, i) => {
    const kind = TRACE_KINDS[Math.floor(rand() * TRACE_KINDS.length)]
    const query = QUERIES[Math.floor(rand() * QUERIES.length)]
    return {
      trace_id: `tr_${(0x9f2c00 + i * 37).toString(16)}${i.toString().padStart(3, '0')}`,
      kind,
      pipeline: KIND_PIPELINE[kind],
      created_at: new Date(now - i * 47 * 60 * 1000).toISOString(),
      duration_ms: Math.round((kind === 'rag' || kind === 'chat' ? 900 + rand() * 1800 : 30 + rand() * 120) * 10) / 10,
      input_summary: kind === 'image_search' ? '[image upload]' : kind === 'compose_search' ? `[image] + "${query}"` : query,
    }
  })
}

export function buildTrace(summary) {
  return {
    trace_id: summary.trace_id,
    pipeline: summary.pipeline,
    kind: summary.kind,
    created_at: summary.created_at,
    duration_ms: summary.duration_ms,
    input: { query: summary.input_summary, filters: {}, mode: 'hybrid' },
    steps: [
      { id: 'lexical', step: 'retrieve', impl: 'bm25', params: { candidate_k: 100 }, started_ms: 1.2, duration_ms: 22.4, summary: '100 candidates from BM25', output: { items: PRODUCTS.slice(0, 3).map((p, i) => ({ id: p.product_id, rank: i + 1, score: 12.3 - i, title: p.title })), total: 100 } },
      { id: 'semantic', step: 'retrieve', impl: 'knn', params: { field: 'text_vector', k: 100 }, started_ms: 1.4, duration_ms: 31.0, summary: '100 candidates from kNN', output: { items: PRODUCTS.slice(1, 4).map((p, i) => ({ id: p.product_id, rank: i + 1, score: 0.82 - i * 0.03, title: p.title })), total: 100 } },
      { id: 'fuse', step: 'fuse', impl: 'rrf', params: { k: 60 }, started_ms: 33, duration_ms: 0.4, summary: 'RRF over 2 rankings' },
    ],
    output: { result_ids: PRODUCTS.slice(0, 5).map((p) => p.product_id) },
  }
}

export function buildFeedback(count = 43, now = Date.parse('2026-10-16T12:00:00Z')) {
  const rand = seeded(11)
  const comments = ['', '', 'Exactly what I wanted', 'Wrong category', 'Answer cited the wrong policy', '', 'Images do not match', 'Great results']
  return Array.from({ length: count }, (_, i) => {
    const target = rand() < 0.65 ? 'search' : 'answer'
    const product = PRODUCTS[Math.floor(rand() * PRODUCTS.length)]
    return {
      id: `fb_${1000 + i}`,
      target,
      trace_id: `tr_fb${i}`,
      rating: rand() < 0.7 ? 1 : -1,
      query: QUERIES[Math.floor(rand() * QUERIES.length)],
      product_id: target === 'search' ? product.product_id : null,
      comment: comments[Math.floor(rand() * comments.length)],
      created_at: new Date(now - i * 95 * 60 * 1000).toISOString(),
    }
  })
}

// Two annotators' judgments on overlapping items, for the agreement card.
export function buildJudgments() {
  const rand = seeded(23)
  const items = []
  for (const query of QUERIES.slice(0, 5)) {
    for (const product of PRODUCTS.slice(0, 6)) {
      const grade = Math.floor(rand() * 3)
      items.push({ query, product_id: product.product_id, grade, annotator: 'admin' })
      const disagree = rand() < 0.25
      items.push({ query, product_id: product.product_id, grade: disagree ? (grade + 1) % 3 : grade, annotator: 'annotator' })
    }
  }
  return items
}
