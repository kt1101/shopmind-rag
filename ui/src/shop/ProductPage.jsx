import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { getProduct, getSimilarProducts, resolveImageUrl } from '../api.js'
import { formatPrice } from '../lib/format.js'
import { buildCatalogUrl } from '../lib/urlState.js'
import { galleryImages, isSyntheticPrice, normalizeAttributes, stockBadge } from '../entities/product/product.js'
import { useShopLists } from '../features/shop-lists/ShopListsProvider.jsx'
import { categoryLabel } from '../shared/i18n.js'
import { useI18n } from '../shared/ui/I18nProvider.jsx'
import { useChat } from '../chat/ChatProvider.jsx'
import ProductAskPanel from './ProductAskPanel.jsx'
import ProductCard from './ProductCard.jsx'
import StatusBlock from './StatusBlock.jsx'

function Gallery({ images, title }) {
  const { t } = useI18n()
  const [index, setIndex] = useState(0)
  const [broken, setBroken] = useState({})
  const usable = images.filter((src) => !broken[src])
  const current = usable[Math.min(index, usable.length - 1)]

  if (!current) {
    return <div className="product-media"><span aria-hidden="true" className="product-media-placeholder">◇</span></div>
  }
  return (
    <div className="product-gallery">
      <div className="product-media">
        <img src={current} alt={title || ''} className="product-media-image" onError={() => setBroken((b) => ({ ...b, [current]: true }))} />
      </div>
      {usable.length > 1 && (
        <div className="product-thumbs" role="group" aria-label={t('product.gallery')}>
          {usable.map((src, i) => (
            <button
              key={src}
              type="button"
              className={`product-thumb ${src === current ? 'is-active' : ''}`}
              aria-label={t('product.showImage', { index: i + 1 })}
              aria-pressed={src === current}
              onClick={() => setIndex(i)}
            >
              <img src={src} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ProductPage() {
  const { productId } = useParams()
  const navigate = useNavigate()
  const { setScope } = useChat()
  const { t, lang } = useI18n()
  const lists = useShopLists()

  const [product, setProduct] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadIndex, setReloadIndex] = useState(0)
  const [similar, setSimilar] = useState({ items: [], loading: false })

  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo(0, 0)
    if (!productId) {
      setLoading(false)
      setProduct(null)
      setError(Object.assign(new Error('Product not found'), { status: 404 }))
      return undefined
    }
    setProduct(null)
    setLoading(true)
    setError(null)
    const controller = new AbortController()
    getProduct({ productId, signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) setProduct(res?.data || null)
      })
      .catch((err) => {
        if (!controller.signal.aborted && err.name !== 'AbortError') setError(err)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [productId, reloadIndex])

  // Scope the chat to this product; leaving the page returns the chat to catalog search.
  useEffect(() => {
    if (product) setScope(product)
    else if (error) setScope(null)
  }, [product, error, setScope])

  useEffect(() => () => setScope(null), [setScope])

  // "Sản phẩm tương tự về hình ảnh": image kNN (GET /products/{id}/similar).
  useEffect(() => {
    if (!product?.product_id) {
      setSimilar({ items: [], loading: false })
      return undefined
    }
    const controller = new AbortController()
    setSimilar({ items: [], loading: true })
    getSimilarProducts({ productId: product.product_id, limit: 8, signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) setSimilar({ items: (res?.data?.items || []).filter((p) => p?.product_id !== product.product_id), loading: false })
      })
      .catch(() => {
        if (!controller.signal.aborted) setSimilar({ items: [], loading: false })
      })
    return () => controller.abort()
  }, [product?.product_id])

  if (loading) {
    return (
      <div className="product-page">
        <div className="product-layout product-layout-skeleton" aria-busy="true" role="status" aria-label={t('product.loading')}>
          <div className="product-media skeleton-box" />
          <div className="product-summary">
            <div className="skeleton-line skeleton-eyebrow" />
            <div className="skeleton-line skeleton-title" />
            <div className="skeleton-line skeleton-title-short" />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="product-page">
        {error.status === 404 ? (
          <StatusBlock tone="empty" title={t('product.notFound')} message={t('product.notFoundHint')} action={{ label: t('product.backHome'), onClick: () => navigate('/') }} />
        ) : (
          <StatusBlock tone="error" title={t('product.loadFailed')} message={error.message} action={{ label: t('state.retry'), onClick: () => setReloadIndex((i) => i + 1) }} />
        )}
      </div>
    )
  }

  if (!product) return null

  const images = galleryImages(product, resolveImageUrl)
  const category = categoryLabel(lang, product.category)
  const priceLabel = formatPrice(product.price)
  const stock = stockBadge(product.stock)
  const synthetic = isSyntheticPrice(product.price) || stock?.synthetic
  const paragraphs = product.description ? product.description.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : []
  const attributes = normalizeAttributes(product.attributes)
  const comparing = lists.isComparing(product.product_id)
  const saved = lists.isWishlisted(product.product_id)
  const inCart = lists.cartQuantity(product.product_id)
  const cardProduct = { ...product, image_url: product.image_url || product.images?.[0] }

  return (
    <div className="product-page">
      <nav aria-label="Breadcrumb" className="product-breadcrumb">
        <Link to="/" className="product-breadcrumb-link">{t('product.home')}</Link>
        {product.category && (
          <>
            <span className="product-breadcrumb-sep" aria-hidden="true">›</span>
            <Link to={buildCatalogUrl({ category: [product.category] })} className="product-breadcrumb-link">{category}</Link>
          </>
        )}
      </nav>

      <div className="product-layout">
        <Gallery key={product.product_id} images={images} title={product.title} />

        <div className="product-summary">
          {category && <p className="product-eyebrow eyebrow">{category}</p>}
          <h1 className="product-title">{product.title}</h1>
          {product.brand && <p className="product-brand">{product.brand}</p>}

          {(priceLabel || stock) && (
            <div className="product-commerce">
              {priceLabel && <p className="product-price">{priceLabel}</p>}
              {stock && (
                <span className={`sm-badge ${stock.inStock ? 'sm-badge--success' : 'sm-badge--danger'}`}>
                  {stock.inStock ? t('product.inStock', { quantity: stock.quantity ?? '?' }) : t('product.outOfStock')}
                </span>
              )}
              {synthetic && <span className="sm-badge sm-badge--warning" title={t('product.syntheticNote')}>{t('product.synthetic')}</span>}
            </div>
          )}
          {synthetic && <p className="product-synthetic-note">{t('product.syntheticNote')}</p>}

          <div className="product-actions">
            <button type="button" className="sm-button sm-button--primary" onClick={() => lists.addToCart(cardProduct)} disabled={stock ? !stock.inStock : false}>
              {inCart ? t('product.inCart', { count: inCart }) : t('product.addToCart')}
            </button>
            <button type="button" className="sm-button" aria-pressed={comparing} onClick={() => lists.toggleCompare(cardProduct)}>
              <span aria-hidden="true">{comparing ? '✓' : '⇄'}</span> {comparing ? t('card.compareRemove') : t('card.compareAdd')}
            </button>
            <button type="button" className="sm-button" aria-pressed={saved} onClick={() => lists.toggleWishlist(cardProduct)}>
              <span aria-hidden="true">{saved ? '♥' : '♡'}</span> {saved ? t('card.wishlistRemove') : t('card.wishlistAdd')}
            </button>
          </div>

          <p className="product-id">ID: <code>{product.product_id}</code></p>
          <ProductAskPanel key={product.product_id} product={product} />
        </div>
      </div>

      {paragraphs.length > 0 && (
        <section className="product-section product-description">
          <h2 className="product-section-title">{t('product.description')}</h2>
          <div className="product-description-text">
            {paragraphs.map((para, idx) => <p key={idx}>{para}</p>)}
          </div>
        </section>
      )}

      {attributes.length > 0 && (
        <section className="product-section product-details">
          <h2 className="product-section-title">{t('product.details')}</h2>
          <table className="product-details-table">
            <thead>
              <tr><th scope="col">{t('product.attribute')}</th><th scope="col">{t('product.value')}</th></tr>
            </thead>
            <tbody>
              {attributes.map((attr) => (
                <tr key={attr.name}>
                  <td className="product-attr-name">{attr.name}</td>
                  <td className="product-attr-value">{attr.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(similar.loading || similar.items.length > 0) && (
        <section className="product-section product-similar" aria-busy={similar.loading}>
          <h2 className="product-section-title">{t('product.similarVisual')}</h2>
          <p className="product-section-hint">{t('product.similarVisualHint')}</p>
          <div className="product-similar-strip">
            {similar.loading
              ? Array.from({ length: 4 }, (_, i) => <div key={i} className="product-card product-card-skeleton"><div className="product-visual skeleton-box" /></div>)
              : similar.items.map((item) => <ProductCard key={item.product_id} product={item} />)}
          </div>
        </section>
      )}
    </div>
  )
}
