import { cleanFilters } from '../api.js'
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

function wait(delayMs, signal) {
  if (delayMs <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  }).then(() => signal?.throwIfAborted())
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

const QUESTION_STOPWORDS = new Set(['what', 'does', 'with', 'this', 'that', 'there', 'have', 'from', 'about', 'which', 'will', 'your', 'they', 'them', 'much', 'many', 'come', 'comes', 'good', 'like'])

export async function askProduct({ question = '', productId, sources = ['product'], signal, delayMs = 600 } = {}) {
  const started = performance.now()
  signal?.throwIfAborted()
  await wait(delayMs, signal)

  const product = PRODUCTS.find((p) => p.product_id === productId)
  if (!product) {
    throw Object.assign(new Error('product not found'), { status: 404 })
  }
  if (question.toLowerCase().includes('error')) {
    throw new Error('Mock assistant error')
  }

  const words = [...new Set((question.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter((w) => w.length >= 4 && !QUESTION_STOPWORDS.has(w)))]
  const mentions = (text) => words.some((word) => text.toLowerCase().includes(word))

  const facts = (product.attributes || [])
    .filter((attr) => mentions(`${attr.name} ${attr.value}`))
    .map((attr) => `${attr.name}: ${attr.value}.`)
  const sentences = (product.description || '').split(/(?<=\.)\s+/).map((part) => part.trim()).filter(Boolean)
  facts.push(...sentences.filter(mentions))

  const missing = sources.filter((source) => source !== 'product')
  const metadata = missing.length ? { missing_sources: missing } : {}

  if (!facts.length) {
    return {
      data: {
        answer: `The product information for ${product.title} doesn't cover that.`,
        sources: [],
        insufficient_evidence: true,
        metadata,
      },
      durationMs: Math.round(performance.now() - started),
    }
  }

  return {
    data: {
      answer: `Based on the product details for ${product.title}:\n${facts.join('\n')}`,
      sources: [{
        source: 'product',
        document_id: `product:${product.product_id}`,
        title: product.title,
        score: 0.8421,
        metadata: { score_type: 'mock' },
      }],
      insufficient_evidence: false,
      metadata,
    },
    durationMs: Math.round(performance.now() - started),
  }
}
