import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { getProducts } from '../api.js'
import { humanizeCategory } from '../lib/format.js'
import { buildCatalogUrl, parseFilters } from '../lib/urlState.js'
import FilterSidebar from './FilterSidebar.jsx'
import ProductGrid from './ProductGrid.jsx'
import StatusBlock from './StatusBlock.jsx'

export const PAGE_SIZE = 24

function formatResultCount(total) {
  if (total === 1) return '1 product'
  return `${total} products`
}

export default function CatalogPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const filters = useMemo(() => parseFilters(searchParams), [searchParams])
  const serializedFilters = useMemo(() => buildCatalogUrl(filters), [filters])

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadIndex, setReloadIndex] = useState(0)

  const [loadMoreLoading, setLoadMoreLoading] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(null)
  const loadMoreAbortRef = useRef(null)

  useEffect(() => {
    if (loadMoreAbortRef.current) {
      loadMoreAbortRef.current.abort()
      loadMoreAbortRef.current = null
    }

    const controller = new AbortController()
    setItems([])
    setTotal(null)
    setLoading(true)
    setError(null)
    setLoadMoreLoading(false)
    setLoadMoreError(null)

    getProducts({
      category: filters.category,
      brand: filters.brand,
      limit: PAGE_SIZE,
      offset: 0,
      signal: controller.signal,
    })
      .then((res) => {
        if (!controller.signal.aborted) {
          setItems(res?.data?.items || [])
          setTotal(res?.data?.total ?? 0)
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
      if (loadMoreAbortRef.current) {
        loadMoreAbortRef.current.abort()
        loadMoreAbortRef.current = null
      }
    }
  }, [serializedFilters, reloadIndex])

  function handleFilterChange(nextFilters) {
    navigate(buildCatalogUrl(nextFilters))
  }

  function handleRemoveCategory(catToRemove) {
    const nextCategories = filters.category.filter((c) => c !== catToRemove)
    navigate(buildCatalogUrl({ ...filters, category: nextCategories }))
  }

  function handleRemoveBrand(brandToRemove) {
    const nextBrands = filters.brand.filter((b) => b !== brandToRemove)
    navigate(buildCatalogUrl({ ...filters, brand: nextBrands }))
  }

  function handleClearAll() {
    navigate('/')
  }

  function reload() {
    setReloadIndex((prev) => prev + 1)
  }

  async function handleLoadMore() {
    if (loading || loadMoreLoading) return
    if (total == null || items.length >= total) return

    if (loadMoreAbortRef.current) {
      loadMoreAbortRef.current.abort()
    }

    const controller = new AbortController()
    loadMoreAbortRef.current = controller

    setLoadMoreLoading(true)
    setLoadMoreError(null)

    try {
      const res = await getProducts({
        category: filters.category,
        brand: filters.brand,
        limit: PAGE_SIZE,
        offset: items.length,
        signal: controller.signal,
      })

      if (!controller.signal.aborted) {
        const nextItems = res?.data?.items || []
        setItems((prev) => [...prev, ...nextItems])
        if (res?.data?.total != null) {
          setTotal(res?.data?.total)
        }
        loadMoreAbortRef.current = null
        setLoadMoreLoading(false)
      }
    } catch (err) {
      if (!controller.signal.aborted && err.name !== 'AbortError') {
        setLoadMoreError(err.message || "Couldn't load more products")
        loadMoreAbortRef.current = null
        setLoadMoreLoading(false)
      }
    }
  }

  const title =
    filters.category.length > 0
      ? filters.category.map(humanizeCategory).join(', ')
      : 'All products'

  const hasActiveFilters = filters.category.length > 0 || filters.brand.length > 0
  const canLoadMore = !loading && total != null && items.length < total

  return (
    <div className="catalog-page shop-columns">
      <FilterSidebar filters={filters} onChange={handleFilterChange} />

      <div className="catalog-content">
        <div className="catalog-toolbar">
          <div className="catalog-toolbar-main">
            <h1 className="catalog-title">{title}</h1>
            {total != null && !error && (
              <span className="catalog-total">{formatResultCount(total)}</span>
            )}
          </div>

          {hasActiveFilters && (
            <div className="catalog-active-filters" aria-label="Active filters">
              {filters.category.map((cat) => (
                <span key={`cat-${cat}`} className="catalog-chip">
                  <span className="catalog-chip-label">{humanizeCategory(cat)}</span>
                  <button
                    type="button"
                    className="catalog-chip-remove"
                    aria-label={`Remove ${humanizeCategory(cat)} filter`}
                    onClick={() => handleRemoveCategory(cat)}
                  >
                    ×
                  </button>
                </span>
              ))}
              {filters.brand.map((brand) => (
                <span key={`brand-${brand}`} className="catalog-chip">
                  <span className="catalog-chip-label">{brand}</span>
                  <button
                    type="button"
                    className="catalog-chip-remove"
                    aria-label={`Remove ${brand} filter`}
                    onClick={() => handleRemoveBrand(brand)}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="catalog-clear-all"
                onClick={handleClearAll}
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {loading && items.length === 0 ? (
          <ProductGrid products={[]} loading={true} skeletonCount={8} />
        ) : error ? (
          <StatusBlock
            tone="error"
            title="Couldn't load products"
            message={error.message || 'Request failed'}
            action={{ label: 'Retry', onClick: reload }}
          />
        ) : total === 0 || items.length === 0 ? (
          <StatusBlock
            tone="empty"
            title="No products found"
            message="Try clearing some filters to see more products."
            action={{ label: 'Clear filters', onClick: () => navigate('/') }}
          />
        ) : (
          <>
            <ProductGrid products={items} />
            {canLoadMore && (
              <div className="catalog-load-more">
                <button
                  type="button"
                  className="catalog-load-more-button"
                  disabled={loadMoreLoading}
                  onClick={handleLoadMore}
                >
                  {loadMoreLoading ? 'Loading...' : 'Load more'}
                </button>
                {loadMoreError && (
                  <div className="catalog-load-more-error-wrap">
                    <span className="catalog-load-more-error">{loadMoreError}</span>
                    <button
                      type="button"
                      className="catalog-load-more-retry"
                      onClick={handleLoadMore}
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
