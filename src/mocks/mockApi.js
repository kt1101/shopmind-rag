import { cleanFilters } from '../api.js'
import { humanizeCategory } from '../lib/format.js'
import { PRODUCTS } from './fixtures.js'

function toListItem(product) {
  const item = {
    product_id: product.product_id,
    title: product.title,
    brand: product.brand,
    category: product.category,
    image_url: product.image_url,
  }
  if (product.price !== undefined) {
    item.price = product.price
  }
  return item
}

export async function getProducts({ category = [], brand = [], limit = 24, offset = 0, signal } = {}) {
  const started = performance.now()
  signal?.throwIfAborted()

  const cleaned = cleanFilters({ category, brand })
  const categories = cleaned.category ? (Array.isArray(cleaned.category) ? cleaned.category : [cleaned.category]) : []
  const brands = cleaned.brand ? (Array.isArray(cleaned.brand) ? cleaned.brand : [cleaned.brand]) : []

  let filtered = PRODUCTS
  if (categories.length > 0) {
    filtered = filtered.filter((p) => categories.includes(p.category))
  }
  if (brands.length > 0) {
    filtered = filtered.filter((p) => brands.includes(p.brand))
  }

  const total = filtered.length
  const numLimit = Number(limit ?? 24)
  const numOffset = Number(offset ?? 0)
  const items = filtered.slice(numOffset, numOffset + numLimit).map(toListItem)

  return {
    data: { total, items },
    durationMs: Math.round(performance.now() - started),
  }
}

export async function getProduct({ productId, signal } = {}) {
  const started = performance.now()
  signal?.throwIfAborted()

  const product = PRODUCTS.find((p) => p.product_id === productId)
  if (!product) {
    throw Object.assign(new Error('product not found'), { status: 404 })
  }

  return {
    data: product,
    durationMs: Math.round(performance.now() - started),
  }
}

export async function sendChatMessage({ messages = [], signal, delayMs = 600 } = {}) {
  const started = performance.now()
  signal?.throwIfAborted()

  if (delayMs > 0) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, delayMs)
      const onAbort = () => {
        clearTimeout(timer)
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  signal?.throwIfAborted()

  const userMessages = messages.filter((m) => m?.role === 'user')
  const lastUser = userMessages[userMessages.length - 1]
  const question = lastUser?.content || (messages[messages.length - 1]?.content || '')

  if (question.toLowerCase().includes('error')) {
    throw new Error('Mock assistant error')
  }

  const words = [...new Set((question.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= 3))]

  const scored = PRODUCTS.map((product) => {
    const title = (product.title || '').toLowerCase()
    const cat = humanizeCategory(product.category || '').toLowerCase()
    let score = 0
    for (const word of words) {
      if (title.includes(word)) score++
      if (cat.includes(word)) score++
    }
    return { product, score }
  }).filter((item) => item.score > 0)

  scored.sort((a, b) => b.score - a.score)
  const topProducts = scored.slice(0, 3).map((item) => item.product)

  const sources = topProducts.map((p) => ({
    product_id: p.product_id,
    title: p.title,
    brand: p.brand,
    category: p.category,
    image_url: p.image_url,
  }))

  let answer
  if (sources.length > 0) {
    answer = `Here's what I found for "${question}":\n` + sources.map((s) => `• ${s.title} (${s.brand})`).join('\n')
  } else {
    answer = `I couldn't find any products matching "${question}".`
  }

  return {
    data: { answer, sources },
    durationMs: Math.round(performance.now() - started),
  }
}
