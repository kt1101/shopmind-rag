import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { getProduct, resolveImageUrl, searchText } from '../api.js'
import { formatPrice, humanizeCategory } from '../lib/format.js'
import { buildCatalogUrl } from '../lib/urlState.js'
import { useChat } from '../chat/ChatProvider.jsx'
import ProductAskPanel from './ProductAskPanel.jsx'
import ProductCard from './ProductCard.jsx'
import StatusBlock from './StatusBlock.jsx'

export default function ProductPage() {
  const { productId } = useParams()
  const navigate = useNavigate()
  const { setScope } = useChat()

  const [product, setProduct] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadIndex, setReloadIndex] = useState(0)
  const [imageBroken, setImageBroken] = useState(false)
  const [similarItems, setSimilarItems] = useState([])

  function reload() {
    setReloadIndex((prev) => prev + 1)
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo(0, 0)
    }

    setImageBroken(false)

    if (!productId) {
      setLoading(false)
      setProduct(null)
      setError(Object.assign(new Error('Product not found'), { status: 404 }))
      return
    }

    setProduct(null)
    setLoading(true)
    setError(null)

    const controller = new AbortController()

    getProduct({ productId, signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) {
          setProduct(res?.data || null)
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted && err.name !== 'AbortError') {
          setError(err)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => {
      controller.abort()
    }
  }, [productId, reloadIndex])

  // Scope the chat to this product; switching products swaps the scope,
  // leaving the page returns the chat to catalog search.
  useEffect(() => {
    if (product) setScope(product)
  }, [product, setScope])

  useEffect(() => () => setScope(null), [setScope])

  useEffect(() => {
    if (!product?.title) {
      setSimilarItems([])
      return
    }

    const controller = new AbortController()

    searchText({
      query: product.title,
      mode: 'hybrid',
      topK: 9,
      signal: controller.signal,
    })
      .then((res) => {
        if (!controller.signal.aborted) {
          const results = res?.data?.results || []
          const filtered = results
            .filter((p) => p && p.product_id !== product.product_id)
            .slice(0, 8)
          setSimilarItems(filtered)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSimilarItems([])
        }
      })

    return () => {
      controller.abort()
    }
  }, [product?.product_id, product?.title])

  if (loading) {
    return (
      <div className="product-page">
        <StatusBlock tone="loading" title="Loading product..." />
      </div>
    )
  }

  if (error) {
    if (error.status === 404) {
      return (
        <div className="product-page">
          <StatusBlock
            tone="empty"
            title="Product not found"
            message="The product you are looking for does not exist or has been removed."
            action={{ label: 'Back to home', onClick: () => navigate('/') }}
          />
        </div>
      )
    }
    return (
      <div className="product-page">
        <StatusBlock
          tone="error"
          title="Couldn't load product"
          message={error.message}
          action={{ label: 'Retry', onClick: reload }}
        />
      </div>
    )
  }

  if (!product) {
    return null
  }

  const imageUrl = resolveImageUrl(product.image_url)
  const categoryLabel = humanizeCategory(product.category)
  const priceLabel = formatPrice(product.price)
  const descriptionParagraphs = product.description
    ? product.description
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
    : []
  const hasAttributes = Array.isArray(product.attributes) && product.attributes.length > 0

  return (
    <div className="product-page">
      <nav aria-label="Breadcrumb" className="product-breadcrumb">
        <Link to="/" className="product-breadcrumb-link">
          Home
        </Link>
        {product.category && (
          <>
            <span className="product-breadcrumb-sep" aria-hidden="true">
              ›
            </span>
            <Link
              to={buildCatalogUrl({ category: [product.category] })}
              className="product-breadcrumb-link"
            >
              {categoryLabel}
            </Link>
          </>
        )}
      </nav>

      <div className="product-layout">
        <div className="product-media">
          {imageUrl && !imageBroken ? (
            <img
              src={imageUrl}
              alt={product.title || ''}
              className="product-media-image"
              onError={() => setImageBroken(true)}
            />
          ) : (
            <span aria-hidden="true" className="product-media-placeholder">
              ◇
            </span>
          )}
        </div>

        <div className="product-summary">
          {categoryLabel && <p className="product-eyebrow eyebrow">{categoryLabel}</p>}
          <h1 className="product-title">{product.title}</h1>
          {product.brand && <p className="product-brand">{product.brand}</p>}
          {priceLabel && <p className="product-price">{priceLabel}</p>}
          <p className="product-id">
            ID: <code>{product.product_id}</code>
          </p>
          <ProductAskPanel key={product.product_id} product={product} />
        </div>
      </div>

      {descriptionParagraphs.length > 0 && (
        <section className="product-section product-description">
          <h2 className="product-section-title">Description</h2>
          <div className="product-description-text">
            {descriptionParagraphs.map((para, idx) => (
              <p key={idx}>{para}</p>
            ))}
          </div>
        </section>
      )}

      {hasAttributes && (
        <section className="product-section product-details">
          <h2 className="product-section-title">Details</h2>
          <table className="product-details-table">
            <thead>
              <tr>
                <th scope="col">Attribute</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {product.attributes.map((attr, idx) => (
                <tr key={idx}>
                  <td className="product-attr-name">{attr.name}</td>
                  <td className="product-attr-value">{attr.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {similarItems.length > 0 && (
        <section className="product-section product-similar">
          <h2 className="product-section-title">Similar products</h2>
          <div className="product-similar-grid">
            {similarItems.map((item) => (
              <ProductCard key={item.product_id} product={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
