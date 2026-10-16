import ProductCard from './ProductCard.jsx'

export default function ProductGrid({ products = [], loading = false, skeletonCount = 8 }) {
  const showSkeletons = loading && (!products || products.length === 0)

  return (
    <ul className="product-grid" aria-busy={loading}>
      {showSkeletons
        ? Array.from({ length: skeletonCount }, (_, index) => (
            <li key={`skeleton-${index}`} className="product-grid-item">
              <div className="product-card product-card-skeleton" aria-hidden="true">
                <div className="product-visual skeleton-box" />
                <div className="product-info">
                  <div className="skeleton-line skeleton-eyebrow" />
                  <div className="skeleton-line skeleton-title" />
                  <div className="skeleton-line skeleton-title-short" />
                  <div className="skeleton-meta">
                    <div className="skeleton-line skeleton-brand" />
                    <div className="skeleton-line skeleton-price" />
                  </div>
                </div>
              </div>
            </li>
          ))
        : (products || []).map((product) => (
            <li key={product.product_id} className="product-grid-item">
              <ProductCard product={product} />
            </li>
          ))}
    </ul>
  )
}
