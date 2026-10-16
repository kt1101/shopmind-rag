import { useState } from 'react'
import { Link } from 'react-router'
import { resolveImageUrl } from '../api.js'
import { formatPrice, humanizeCategory } from '../lib/format.js'
import { productPath } from '../lib/urlState.js'

export default function ProductCard({ product }) {
  const [broken, setBroken] = useState(false)
  if (!product) return null

  const image = resolveImageUrl(product.image_url)
  const categoryLabel = humanizeCategory(product.category)
  const priceLabel = formatPrice(product.price)

  return (
    <Link to={productPath(product.product_id)} className="product-card">
      <div className="product-visual">
        {image && !broken ? (
          <img
            src={image}
            alt={product.title || ''}
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <span aria-hidden="true" className="product-visual-placeholder">◇</span>
        )}
      </div>
      <div className="product-info">
        {categoryLabel && <p className="eyebrow">{categoryLabel}</p>}
        <h3 className="product-title">{product.title}</h3>
        <div className="product-meta">
          {product.brand && <span className="product-brand">{product.brand}</span>}
          {priceLabel && <span className="product-price">{priceLabel}</span>}
        </div>
      </div>
    </Link>
  )
}
