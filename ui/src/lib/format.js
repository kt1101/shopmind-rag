export function humanizeCategory(value) {
  if (!value || typeof value !== 'string') return ''
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function formatPrice(price) {
  if (!price || typeof price !== 'object') return null
  const { amount, currency = 'USD' } = price
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
  } catch {
    return null
  }
}
