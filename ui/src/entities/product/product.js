// Product presentation helpers (product detail contract: attributes is an object; older
// payloads used a [{name, value}] list, both are accepted).

const HIDDEN_ATTRIBUTES = new Set(['color_normalized'])

export function normalizeAttributes(attributes) {
  if (Array.isArray(attributes)) {
    return attributes
      .filter((a) => a && a.name != null && a.value != null && String(a.value).trim() !== '')
      .map((a) => ({ name: String(a.name), value: String(a.value) }))
  }
  if (attributes && typeof attributes === 'object') {
    return Object.entries(attributes)
      .filter(([name, value]) => !HIDDEN_ATTRIBUTES.has(name) && value != null && !(typeof value === 'object' && !Array.isArray(value)) && String(value).trim() !== '')
      .map(([name, value]) => ({ name: humanizeKey(name), value: Array.isArray(value) ? value.join(', ') : String(value) }))
  }
  return []
}

function humanizeKey(key) {
  return /[A-Z\s]/.test(key) ? key : key.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase())
}

// Some catalog titles still carry HTML entities from the source data ("Grey &amp; Black").
// Decode the common ones for display (text only, never injected as HTML).
const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }
export function displayTitle(title) {
  if (typeof title !== 'string' || !title.includes('&')) return title ?? ''
  return title.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match
    }
    return ENTITIES[code.toLowerCase()] ?? match
  })
}

// Gallery: image_url first, then `images`, deduped; resolver maps backend paths to URLs.
export function galleryImages(product, resolve = (u) => u) {
  const urls = [product?.image_url, ...(Array.isArray(product?.images) ? product.images : [])]
    .map((u) => resolve(u))
    .filter(Boolean)
  return [...new Set(urls)]
}

export function stockBadge(stock) {
  if (!stock || typeof stock !== 'object' || typeof stock.in_stock !== 'boolean') return null
  return {
    inStock: stock.in_stock,
    quantity: Number.isFinite(stock.quantity) ? stock.quantity : null,
    synthetic: stock.synthetic !== false,
  }
}

export function isSyntheticPrice(price) {
  return Boolean(price && typeof price === 'object' && price.synthetic !== false)
}
