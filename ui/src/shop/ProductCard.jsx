import { useState } from 'react'
import { Link } from 'react-router'
import { resolveImageUrl } from '../api.js'
import { formatPrice } from '../lib/format.js'
import { productPath } from '../lib/urlState.js'
import { categoryLabel } from '../shared/i18n.js'
import { displayTitle } from '../entities/product/product.js'
import { useI18n } from '../shared/ui/I18nProvider.jsx'
import { useShopLists } from '../features/shop-lists/ShopListsProvider.jsx'

// The card link and the action buttons are siblings (no buttons nested inside the link).
export default function ProductCard({ product, onOpen, showActions = true }) {
  const [broken, setBroken] = useState(false)
  const { t, lang } = useI18n()
  const lists = useShopLists()
  if (!product) return null

  const image = resolveImageUrl(product.image_url)
  const title = displayTitle(product.title)
  const priceLabel = formatPrice(product.price)
  const comparing = lists.isComparing(product.product_id)
  const saved = lists.isWishlisted(product.product_id)

  return (
    <article className="product-card">
      <Link to={productPath(product.product_id)} className="product-card-link" onClick={() => onOpen?.(product)}>
        <div className="product-visual">
          {image && !broken ? (
            <img src={image} alt={title} loading="lazy" decoding="async" onError={() => setBroken(true)} />
          ) : (
            <span aria-hidden="true" className="product-visual-placeholder">◇</span>
          )}
        </div>
        <div className="product-info">
          {product.category && <p className="eyebrow">{categoryLabel(lang, product.category)}</p>}
          <h3 className="product-title" title={title}>{title}</h3>
          <div className="product-meta">
            {product.brand && <span className="product-brand">{product.brand}</span>}
            {priceLabel && (
              <span className="product-price" title={product.price?.synthetic ? t('product.syntheticNote') : undefined}>
                {priceLabel}{product.price?.synthetic && <sup aria-label={t('product.synthetic')}>*</sup>}
              </span>
            )}
          </div>
        </div>
      </Link>
      {showActions && (
        <div className="product-card-actions">
          <button
            type="button"
            className={`card-action ${saved ? 'is-on' : ''}`}
            aria-pressed={saved}
            aria-label={`${saved ? t('card.wishlistRemove') : t('card.wishlistAdd')}: ${title}`}
            title={saved ? t('card.wishlistRemove') : t('card.wishlistAdd')}
            onClick={() => lists.toggleWishlist(product)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
            </svg>
          </button>
          <button
            type="button"
            className={`card-action card-action--compare ${comparing ? 'is-on' : ''}`}
            aria-pressed={comparing}
            aria-label={`${comparing ? t('card.compareRemove') : t('card.compareAdd')}: ${title}`}
            title={comparing ? t('card.compareRemove') : t('card.compareAdd')}
            onClick={() => lists.toggleCompare(product)}
          >
            <span aria-hidden="true">{comparing ? '✓' : '+'}</span> {t('card.compare')}
          </button>
        </div>
      )}
    </article>
  )
}
