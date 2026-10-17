// Pure logic for the locally stored shopper lists: compare tray (max 3), wishlist, cart.
// Items are small product snapshots so the header/tray can render without refetching.

export const COMPARE_MAX = 3
export const STORAGE_KEYS = { compare: 'shopmind.compare', wishlist: 'shopmind.wishlist', cart: 'shopmind.cart' }

export function snapshot(product) {
  if (!product?.product_id) return null
  const item = { product_id: String(product.product_id), title: product.title || String(product.product_id) }
  for (const key of ['brand', 'category', 'image_url']) if (product[key]) item[key] = product[key]
  if (product.price && typeof product.price.amount === 'number') item.price = product.price
  return item
}

// Anything read back from storage is untrusted: keep only well-formed, unique entries.
export function sanitizeList(value, { max = Infinity, withQuantity = false } = {}) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const raw of value) {
    const item = snapshot(raw)
    if (!item || seen.has(item.product_id)) continue
    seen.add(item.product_id)
    if (withQuantity) item.quantity = clampQuantity(raw.quantity)
    out.push(item)
    if (out.length >= max) break
  }
  return out
}

export function clampQuantity(value) {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) ? Math.min(99, Math.max(1, n)) : 1
}

export function includesId(list, productId) {
  return list.some((item) => item.product_id === String(productId))
}

// Toggle membership; returns {list, status: added | removed | full | invalid}.
export function toggleItem(list, product, max = Infinity) {
  const item = snapshot(product)
  if (!item) return { list, status: 'invalid' }
  if (includesId(list, item.product_id)) return { list: list.filter((x) => x.product_id !== item.product_id), status: 'removed' }
  if (list.length >= max) return { list, status: 'full' }
  return { list: [...list, item], status: 'added' }
}

export function removeItem(list, productId) {
  return list.filter((x) => x.product_id !== String(productId))
}

export function addToCart(cart, product, quantity = 1) {
  const item = snapshot(product)
  if (!item) return cart
  const existing = cart.find((x) => x.product_id === item.product_id)
  if (existing) return cart.map((x) => (x === existing ? { ...x, quantity: clampQuantity(x.quantity + quantity) } : x))
  return [...cart, { ...item, quantity: clampQuantity(quantity) }]
}

// Adds several products at once (e.g. a whole shopping plan), one each.
export function addAllToCart(cart, products = []) {
  return (Array.isArray(products) ? products : []).reduce((current, product) => addToCart(current, product, 1), cart)
}

export function setCartQuantity(cart, productId, quantity) {
  return cart.map((x) => (x.product_id === String(productId) ? { ...x, quantity: clampQuantity(quantity) } : x))
}

export function cartCount(cart) {
  return cart.reduce((sum, item) => sum + (item.quantity || 1), 0)
}

export function cartTotal(cart) {
  let amount = 0
  let currency = null
  for (const item of cart) {
    if (!item.price) continue
    currency = currency || item.price.currency || 'USD'
    amount += item.price.amount * (item.quantity || 1)
  }
  return currency ? { amount: Math.round(amount * 100) / 100, currency, synthetic: true } : null
}

export function parseCompareIds(value) {
  const ids = String(value || '').split(',').map((id) => id.trim()).filter(Boolean)
  return [...new Set(ids)].slice(0, COMPARE_MAX)
}

export function buildCompareUrl(ids) {
  const clean = parseCompareIds((ids || []).join(','))
  return clean.length ? `/compare?ids=${clean.map(encodeURIComponent).join(',')}` : '/compare'
}
