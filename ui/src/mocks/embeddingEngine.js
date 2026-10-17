// Mock 2D embedding maps (GET /meta/embedding-map, POST /meta/embedding-map/project).
// The fixture products plus synthetic catalogue points are clustered by category. The
// clusters are deliberately well separated in the `text` (E5) space, looser in `image`
// (SigLIP image) and collapsed in `siglip_text`, which is the story the map has to tell:
// the old SigLIP text tower does not separate categories, so text dense retrieval failed.

import { PRODUCTS } from './fixtures.js'
import { hash, understandQuery, tokenize } from './searchEngine.js'

export const SPACES = ['text', 'siglip_text', 'image']

const SYNTHETIC = {
  running_shoes: ['Road Racer', 'Tempo Trainer', 'Cushion Glide', 'Track Spike', 'Daily Runner'],
  hiking_boots: ['Ridge Boot', 'Canyon Mid', 'Leather Trekker', 'Alpine GTX', 'Trail Boot'],
  backpacks: ['Day Pack 20L', 'Travel Pack 40L', 'Laptop Backpack', 'Hydration Pack', 'Roll-top Pack'],
  jackets: ['Rain Shell', 'Puffer Jacket', 'Fleece Midlayer', 'Softshell', 'Wind Jacket'],
  sofas: ['3-seat Sofa', 'Loveseat', 'Sectional Sofa', 'Sofa Bed', 'Velvet Couch'],
  lamps: ['Desk Lamp', 'Floor Lamp', 'LED Reading Lamp', 'Arc Lamp', 'Bedside Lamp'],
  phone_cases: ['Silicone Case', 'Wallet Case', 'Rugged Case', 'Clear Case', 'Leather Folio'],
  watches: ['Chronograph', 'Smart Watch', 'Dive Watch', 'Field Watch', 'Dress Watch'],
}
export const MAP_CATEGORIES = Object.keys(SYNTHETIC)

const SPREAD = {
  text: { radius: 6.2, sigma: 0.75 },
  image: { radius: 4.6, sigma: 1.25 },
  siglip_text: { radius: 1.1, sigma: 2.1 },
}

function prng(seed) {
  let s = hash(seed) || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function gaussian(rand) {
  const u = Math.max(rand(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

function centroid(space, category) {
  const index = MAP_CATEGORIES.indexOf(category)
  const angle = (index / MAP_CATEGORIES.length) * 2 * Math.PI + (space === 'image' ? 0.5 : 0)
  const { radius } = SPREAD[space]
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
}

const round = (v) => Math.round(v * 1000) / 1000
const cache = new Map()

export function embeddingMap(space = 'text') {
  if (!SPREAD[space]) throw Object.assign(new Error(`unknown space '${space}'`), { status: 422, code: 'validation_error' })
  if (cache.has(space)) return cache.get(space)
  const rand = prng(`map|${space}`)
  const { sigma } = SPREAD[space]
  const points = []
  const place = (product_id, title, category) => {
    const c = centroid(space, category)
    points.push({ product_id, x: round(c.x + gaussian(rand) * sigma), y: round(c.y + gaussian(rand) * sigma), category, title })
  }
  for (const product of PRODUCTS) place(product.product_id, product.title, product.category)
  let n = 0
  for (const [category, names] of Object.entries(SYNTHETIC)) {
    const count = PRODUCTS.some((p) => p.category === category) ? 30 : 36
    for (let i = 0; i < count; i += 1) {
      n += 1
      place(`ABO-${String(1000 + n)}`, `${names[i % names.length]} ${['Pro', 'Lite', 'Classic', 'Plus', 'Max', 'Mini'][i % 6]} ${i + 1}`, category)
    }
  }
  const body = { space, points, projection: 'pca' }
  cache.set(space, body)
  return body
}

// Projects a query: category detected from aliases/terms -> near that category's centroid
// (tight in `text`, loose in `image`, essentially random around the origin in `siglip_text`).
export function projectQuery({ space = 'text', query = '' } = {}) {
  if (!SPREAD[space]) throw Object.assign(new Error(`unknown space '${space}'`), { status: 422, code: 'validation_error' })
  const understanding = understandQuery(query)
  let category = understanding.derived.category[0]
  if (!category) {
    const terms = new Set(tokenize(understanding.normalized_query))
    let best = 0
    for (const product of PRODUCTS) {
      const overlap = tokenize(`${product.title} ${product.category}`).filter((t) => terms.has(t)).length
      if (overlap > best) {
        best = overlap
        category = product.category
      }
    }
    if (!category) {
      category = MAP_CATEGORIES.find((c) => [...terms].some((t) => c.startsWith(t.slice(0, 4))))
    }
  }
  const rand = prng(`project|${space}|${query}`)
  if (space === 'siglip_text' || !category) {
    return { x: round(gaussian(rand) * 1.6), y: round(gaussian(rand) * 1.6) }
  }
  const c = centroid(space, category)
  const jitter = space === 'text' ? 0.45 : 1.1
  return { x: round(c.x + gaussian(rand) * jitter), y: round(c.y + gaussian(rand) * jitter) }
}
