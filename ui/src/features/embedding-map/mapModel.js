// Geometry for the 2D embedding scatter (GET /meta/embedding-map + /project).

export const SPACES = ['text', 'siglip_text', 'image']
export const SERIES_COUNT = 8

export function validPoints(points) {
  return (Array.isArray(points) ? points : []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
}

// Bounding box of points (+ extra points such as the projected query), padded by `pad` %.
export function extent(points, extra = [], pad = 0.06) {
  const all = [...validPoints(points), ...validPoints(extra)]
  if (!all.length) return { minX: -1, maxX: 1, minY: -1, maxY: 1 }
  let minX = Math.min(...all.map((p) => p.x))
  let maxX = Math.max(...all.map((p) => p.x))
  let minY = Math.min(...all.map((p) => p.y))
  let maxY = Math.max(...all.map((p) => p.y))
  if (maxX === minX) { minX -= 1; maxX += 1 }
  if (maxY === minY) { minY -= 1; maxY += 1 }
  const dx = (maxX - minX) * pad
  const dy = (maxY - minY) * pad
  return { minX: minX - dx, maxX: maxX + dx, minY: minY - dy, maxY: maxY + dy }
}

// Data -> SVG coordinates (y grows upward in data space, downward in SVG). Keeps aspect 1:1.
export function makeScale(box, width, height, margin = 12) {
  const w = width - margin * 2
  const h = height - margin * 2
  const k = Math.min(w / (box.maxX - box.minX), h / (box.maxY - box.minY))
  const offsetX = margin + (w - k * (box.maxX - box.minX)) / 2
  const offsetY = margin + (h - k * (box.maxY - box.minY)) / 2
  return {
    x: (v) => Math.round((offsetX + (v - box.minX) * k) * 10) / 10,
    y: (v) => Math.round((offsetY + (box.maxY - v) * k) * 10) / 10,
  }
}

// Category -> colour token, stable by first appearance order (sorted for determinism).
export function categoryColors(points) {
  const categories = [...new Set(validPoints(points).map((p) => p.category || 'other'))].sort()
  return Object.fromEntries(categories.map((c, i) => [c, `var(--viz-series-${(i % SERIES_COUNT) + 1})`]))
}

export function categoryCounts(points) {
  const counts = new Map()
  for (const p of validPoints(points)) counts.set(p.category || 'other', (counts.get(p.category || 'other') || 0) + 1)
  return [...counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
}

// Nearest projected point to (sx, sy) in SVG space within `radius` px, or null.
export function nearestPoint(projected, sx, sy, radius = 14) {
  let best = null
  let bestD = radius * radius
  for (const p of projected) {
    const d = (p.sx - sx) ** 2 + (p.sy - sy) ** 2
    if (d <= bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

// Mean distance from the query to its top-k points vs. to all points (lower ratio = the
// space put the query near its results), used for the caption.
export function neighbourhoodRatio(points, query, ids) {
  const pts = validPoints(points)
  if (!query || !pts.length || !ids?.length) return null
  const dist = (p) => Math.hypot(p.x - query.x, p.y - query.y)
  const top = pts.filter((p) => ids.includes(p.product_id))
  if (!top.length) return null
  const mean = (list) => list.reduce((s, p) => s + dist(p), 0) / list.length
  return Math.round((mean(top) / mean(pts)) * 100) / 100
}
