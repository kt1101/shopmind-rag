// View model for POST /rag/compare: attribute table (null -> "no data"), cited points.
import { formatPrice } from '../../lib/format.js'

// The backend writes price and stock cells as English text ("692.99 USD (synthetic)",
// "in stock (80, synthetic)"). Re-render the ones we recognise in the shopper's language;
// anything else is shown as sent. `labels` = {inStock(qty), outOfStock, synthetic}.
export function localizeCompareValue(name, raw, labels = {}) {
  const text = String(raw ?? '').trim()
  const key = String(name || '').toLowerCase()
  if (key === 'price') {
    const m = text.match(/^(\d+(?:\.\d+)?)\s*([A-Z]{3})\b(.*)$/)
    if (m) {
      const price = formatPrice({ amount: Number(m[1]), currency: m[2] })
      if (price) return /synthetic/i.test(m[3]) && labels.synthetic ? `${price} (${labels.synthetic})` : price
    }
  }
  if (key === 'category' && labels.category) return labels.category(text)
  if (key === 'stock') {
    const inStock = text.match(/^in stock(?:\s*\((\d+))?/i)
    if (inStock && labels.inStock) return labels.inStock(inStock[1] ?? '?')
    if (/^out of stock/i.test(text) && labels.outOfStock) return labels.outOfStock
  }
  return text
}

export function compareTable(data, noDataLabel = 'Không có dữ liệu', formatCell = (name, raw) => String(raw)) {
  const products = Array.isArray(data?.products) ? data.products : []
  const attributes = Array.isArray(data?.attributes) ? data.attributes : []
  const rows = attributes
    .filter((attr) => attr && attr.name)
    .map((attr) => {
      const cells = products.map((p) => {
        const raw = attr.values?.[p.product_id]
        const missing = raw === null || raw === undefined || String(raw).trim() === ''
        return { productId: p.product_id, value: missing ? noDataLabel : formatCell(attr.name, raw), missing }
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
