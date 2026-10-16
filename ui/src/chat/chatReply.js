import * as defaultApi from '../api.js'

// The A3 RAG endpoint answers about one product, so the chat asks it only
// when scoped to a product; otherwise it searches the catalog.
export async function fetchReply({ question, scope, signal, api = defaultApi }) {
  if (scope) {
    const { data } = await api.askProduct({ question, productId: scope.product_id, sources: ['product'], debug: true, signal })
    return {
      kind: 'rag',
      answer: data?.answer ?? '',
      sources: data?.sources ?? [],
      evidence: { insufficient_evidence: Boolean(data?.insufficient_evidence), metadata: data?.metadata ?? {} },
    }
  }

  const { data } = await api.searchText({ query: question, mode: 'hybrid', topK: 3, filters: {}, signal })
  const results = data?.results ?? []
  return {
    kind: 'search',
    answer: results.length
      ? `Here are the closest matches for "${question}". Choose "Ask about this" to get answers about one of them.`
      : `I couldn't find products matching "${question}". Try different words.`,
    sources: results,
  }
}
