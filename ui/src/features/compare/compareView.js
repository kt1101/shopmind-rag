// View model for POST /rag/compare: attribute table (null -> "no data"), cited points.

export function compareTable(data, noDataLabel = 'Không có dữ liệu') {
  const products = Array.isArray(data?.products) ? data.products : []
  const attributes = Array.isArray(data?.attributes) ? data.attributes : []
  const rows = attributes
    .filter((attr) => attr && attr.name)
    .map((attr) => {
      const cells = products.map((p) => {
        const raw = attr.values?.[p.product_id]
        const missing = raw === null || raw === undefined || String(raw).trim() === ''
        return { productId: p.product_id, value: missing ? noDataLabel : String(raw), missing }
      })
      const present = cells.filter((c) => !c.missing).map((c) => c.value.toLowerCase())
      return { name: attr.name, cells, differs: new Set(present).size > 1, allMissing: present.length === 0 }
    })
  return { products, rows }
}

// A point rendered as answer text with [citation_id] markers so AnswerText can chip them.
export function pointAsAnswer(point) {
  const ids = Array.isArray(point?.citation_ids) ? point.citation_ids.filter(Boolean) : []
  return `${String(point?.text ?? '').trim()}${ids.length ? ` ${ids.map((id) => `[${id}]`).join('')}` : ''}`
}

export function withoutId(ids, id) {
  return (ids || []).filter((x) => x !== id)
}
