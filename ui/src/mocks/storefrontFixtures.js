// Extra fixture data for the storefront mock (VITE_MOCK_API=1): canonical colours, synthetic
// stock, reviews, policies, the Vietnamese/English alias vocabulary used by the mock query
// understanding step, and generated SVG product art (data: URIs, no network).

import { PRODUCTS } from './fixtures.js'

// Canonical colour per product (what the ABO `color` field would hold after normalisation).
export const PRODUCT_COLORS = {
  'M-001': 'blue', 'M-002': 'green', 'M-003': 'black', 'M-004': 'brown', 'M-005': 'white', 'M-006': 'grey',
  'M-007': 'green', 'M-008': 'beige', 'M-009': 'brown', 'M-010': 'black', 'M-011': 'grey', 'M-012': 'brown',
  'M-013': 'black', 'M-014': 'brown', 'M-015': 'blue', 'M-016': 'red', 'M-017': 'blue', 'M-018': 'green',
  'M-019': 'blue', 'M-020': 'black', 'M-021': 'green', 'M-022': 'brown', 'M-023': 'grey', 'M-024': null,
}

export const COLOR_HEX = {
  blue: '#3b6fd8', green: '#3f8f5a', black: '#2a2d34', brown: '#8a5a3b', white: '#e9ecf1', grey: '#8b93a1',
  beige: '#cdb68f', red: '#c8423b',
}

// Synthetic stock: deterministic, clearly flagged as synthetic in the API payload.
export function stockFor(productId) {
  const n = Number(String(productId).replace(/\D/g, '')) || 0
  const quantity = (n * 7) % 23
  return { in_stock: quantity > 0, quantity, synthetic: true }
}

export const REVIEWS = [
  { id: 'rv_001_1', product_id: 'M-001', rating: 5, title: 'Great daily trainer', text: 'Very light on the road and the mesh keeps my feet cool on long runs. Fits true to size.' },
  { id: 'rv_001_2', product_id: 'M-001', rating: 4, title: 'Good cushioning', text: 'The midsole absorbs shock well; the upper wore a little after 400 km.' },
  { id: 'rv_003_1', product_id: 'M-003', rating: 5, title: 'Race day rocket', text: 'The carbon plate gives a snappy toe-off. Narrow fit, size up half a size.' },
  { id: 'rv_007_1', product_id: 'M-007', rating: 5, title: 'Dry feet all day', text: 'Hiked through rain and creek crossings, the waterproof membrane held up. Heavy but stable.' },
  { id: 'rv_007_2', product_id: 'M-007', rating: 3, title: 'Long break-in', text: 'Leather is stiff for the first week. Warm, maybe too warm for summer.' },
  { id: 'rv_009_1', product_id: 'M-009', rating: 4, title: 'Classic leather boot', text: 'Nice brown leather, grippy outsole. Runs slightly large.' },
  { id: 'rv_013_1', product_id: 'M-013', rating: 5, title: 'Truly waterproof', text: 'Roll-top kept my laptop dry in a storm. The black finish scuffs easily.' },
  { id: 'rv_015_1', product_id: 'M-015', rating: 4, title: 'Comfortable under load', text: 'Hip belt spreads 15 kg well. Rain cover is a nice touch.' },
  { id: 'rv_020_1', product_id: 'M-020', rating: 5, title: 'Warmest jacket I own', text: 'Down fill is very warm and packs small. Not waterproof in heavy rain.' },
  { id: 'rv_019_1', product_id: 'M-019', rating: 4, title: 'Keeps the rain out', text: 'Taped seams work. Breathability is average when hiking uphill.' },
]

export const POLICIES = [
  { id: 'pol_returns_1', policy_id: 'returns', section_id: 'window', title: 'Return window', text: 'Unworn items can be returned within 30 days of delivery for a full refund. Items must include original packaging.', experimental: true },
  { id: 'pol_returns_2', policy_id: 'returns', section_id: 'footwear', title: 'Footwear returns', text: 'Footwear used outdoors is not eligible for return unless defective. Indoor try-on is fine.', experimental: true },
  { id: 'pol_shipping_1', policy_id: 'shipping', section_id: 'standard', title: 'Standard shipping', text: 'Standard shipping takes 3 to 5 business days and is free above 100 USD.', experimental: true },
  { id: 'pol_warranty_1', policy_id: 'warranty', section_id: 'defects', title: 'Manufacturing defects', text: 'Manufacturing defects are covered for 12 months from purchase. Normal wear is not covered.', experimental: true },
]

// Alias vocabulary for the mock query-understanding step (longest phrase first wins).
// `to` is a catalog value; `terms` are the English index terms the phrase is normalised to.
export const ALIASES = [
  { from: 'giày chạy bộ', to: 'running_shoes', kind: 'category', terms: ['running', 'shoe'] },
  { from: 'giày leo núi', to: 'hiking_boots', kind: 'category', terms: ['hiking', 'boot'] },
  { from: 'giày bốt', to: 'hiking_boots', kind: 'category', terms: ['boot'] },
  { from: 'áo khoác', to: 'jackets', kind: 'category', terms: ['jacket'] },
  { from: 'ba lô', to: 'backpacks', kind: 'category', terms: ['backpack', 'pack'] },
  { from: 'balo', to: 'backpacks', kind: 'category', terms: ['backpack', 'pack'] },
  { from: 'bốt', to: 'hiking_boots', kind: 'category', terms: ['boot'] },
  { from: 'running shoes', to: 'running_shoes', kind: 'category', terms: ['running', 'shoe'] },
  { from: 'boots', to: 'hiking_boots', kind: 'category', terms: ['boot'] },
  { from: 'backpack', to: 'backpacks', kind: 'category', terms: ['backpack', 'pack'] },
  { from: 'jacket', to: 'jackets', kind: 'category', terms: ['jacket'] },
  { from: 'xanh dương', to: 'blue', kind: 'color', terms: ['blue'] },
  { from: 'xanh lá', to: 'green', kind: 'color', terms: ['green'] },
  { from: 'đen', to: 'black', kind: 'color', terms: ['black'] },
  { from: 'nâu', to: 'brown', kind: 'color', terms: ['brown'] },
  { from: 'trắng', to: 'white', kind: 'color', terms: ['white'] },
  { from: 'xám', to: 'grey', kind: 'color', terms: ['grey'] },
  { from: 'đỏ', to: 'red', kind: 'color', terms: ['red'] },
  { from: 'black', to: 'black', kind: 'color', terms: ['black'] },
  { from: 'brown', to: 'brown', kind: 'color', terms: ['brown'] },
  { from: 'blue', to: 'blue', kind: 'color', terms: ['blue'] },
  { from: 'grey', to: 'grey', kind: 'color', terms: ['grey'] },
  { from: 'red', to: 'red', kind: 'color', terms: ['red'] },
  { from: 'green', to: 'green', kind: 'color', terms: ['green'] },
]

// Plain word translations applied after aliases (vi -> en index terms).
export const WORD_MAP = {
  da: 'leather', 'chống nước': 'waterproof', nhẹ: 'lightweight', ấm: 'warm', 'chạy': 'running', 'leo núi': 'hiking',
  giày: 'shoe', 'túi': 'bag', 'màu': '', 'cho': '', 'và': '', 'của': '', 'có': '', 'không': '',
}

export const STOPWORDS = new Set(['a', 'an', 'the', 'for', 'with', 'and', 'or', 'of', 'in', 'to', 'is', 'it', 'màu', 'cho', 'và', 'của'])

export const CATEGORY_LABELS_VI = {
  running_shoes: 'Giày chạy bộ', hiking_boots: 'Giày leo núi', backpacks: 'Ba lô', jackets: 'Áo khoác',
}

const CATEGORY_SHAPES = {
  running_shoes: '<path d="M40 150 Q60 100 110 108 L150 126 Q190 132 200 150 Z" />',
  hiking_boots: '<path d="M70 70 L120 70 L124 120 Q180 124 196 150 L60 150 Z" />',
  backpacks: '<rect x="78" y="58" width="84" height="100" rx="22" /><rect x="96" y="96" width="48" height="34" rx="8" opacity=".45" />',
  jackets: '<path d="M90 56 L150 56 L188 84 L172 108 L164 98 L164 160 L76 160 L76 98 L68 108 L52 84 Z" />',
}

function svgDataUri(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// Simple generated product art: background tint + category silhouette in the product colour.
export function productArt(product, variant = 0) {
  const color = COLOR_HEX[PRODUCT_COLORS[product.product_id]] || '#9aa5ba'
  const shape = CATEGORY_SHAPES[product.category] || '<circle cx="120" cy="110" r="46" />'
  const bgs = ['#f3f5f9', '#eef1e8', '#f6efe9']
  const transform = ['', 'translate(240 0) scale(-1 1)', 'translate(24 18) scale(.8)'][variant % 3]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200"><rect width="240" height="200" fill="${bgs[variant % 3]}"/><g fill="${color}" transform="${transform}">${shape}</g></svg>`
  return svgDataUri(svg)
}

export function productImages(product) {
  if (product.product_id === 'M-024') return []
  const count = 1 + (Number(product.product_id.slice(2)) % 3)
  return Array.from({ length: count }, (_, i) => productArt(product, i))
}

export const PRODUCT_BY_ID = Object.fromEntries(PRODUCTS.map((p) => [p.product_id, p]))
