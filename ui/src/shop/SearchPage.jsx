import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { searchImage, searchText } from '../api.js'
import { humanizeCategory } from '../lib/format.js'
import { buildCatalogUrl, buildSearchUrl, parseSearch, SEARCH_MODES } from '../lib/urlState.js'
import FilterSidebar from './FilterSidebar.jsx'
import { useImageSearch } from './ImageSearchContext.jsx'
import ProductGrid from './ProductGrid.jsx'
import StatusBlock from './StatusBlock.jsx'

export default function SearchPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { imageFile, setImageFile } = useImageSearch()
  const fileInputRef = useRef(null)

  const search = useMemo(() => parseSearch(searchParams), [searchParams])
  const searchParamsKey = useMemo(() => searchParams.toString(), [searchParams])

  const [items, setItems] = useState([])
  const [durationMs, setDurationMs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadIndex, setReloadIndex] = useState(0)
  const [thumbnailUrl, setThumbnailUrl] = useState(null)

  useEffect(() => {
    if (search.type === 'image' && imageFile) {
      let url = null
      if (typeof URL.createObjectURL === 'function') {
        try {
          url = URL.createObjectURL(imageFile)
          setThumbnailUrl(url)
        } catch {
          setThumbnailUrl(null)
        }
      }
      return () => {
        if (url && typeof URL.revokeObjectURL === 'function') {
          try {
            URL.revokeObjectURL(url)
          } catch {
            // ignore
          }
        }
        setThumbnailUrl(null)
      }
    } else {
      setThumbnailUrl(null)
    }
  }, [search.type, imageFile])

  useEffect(() => {
    if (search.type === null) {
      return
    }

    if (search.type === 'image' && !imageFile) {
      setItems([])
      setDurationMs(null)
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setItems([])
    setDurationMs(null)

    const fetchPromise =
      search.type === 'text'
        ? searchText({
            query: search.query,
            mode: search.mode,
            topK: 20,
            filters: search.filters,
            signal: controller.signal,
          })
        : searchImage({
            file: imageFile,
            topK: 20,
            filters: search.filters,
            signal: controller.signal,
          })

    fetchPromise
      .then((res) => {
        if (!controller.signal.aborted) {
          setItems(res?.data?.results || [])
          setDurationMs(res?.durationMs ?? null)
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
  }, [searchParamsKey, imageFile, reloadIndex])

  function handleFilterChange(nextFilters) {
    navigate(buildSearchUrl({ ...search, filters: nextFilters }))
  }

  function handleRemoveCategory(catToRemove) {
    const nextCategories = search.filters.category.filter((cat) => cat !== catToRemove)
    navigate(
      buildSearchUrl({
        ...search,
        filters: { ...search.filters, category: nextCategories },
      })
    )
  }

  function handleRemoveBrand(brandToRemove) {
    const nextBrands = search.filters.brand.filter((brand) => brand !== brandToRemove)
    navigate(
      buildSearchUrl({
        ...search,
        filters: { ...search.filters, brand: nextBrands },
      })
    )
  }

  function handleClearFilters() {
    navigate(
      buildSearchUrl({
        ...search,
        filters: { category: [], brand: [] },
      })
    )
  }

  function handleFileSelect(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const isImage =
      Boolean(file.type?.startsWith('image/')) ||
      (!file.type && /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name || ''))

    if (isImage) {
      setImageFile(file)
    }
  }

  function reload() {
    setReloadIndex((prev) => prev + 1)
  }

  if (search.type === null) {
    return <Navigate to={buildCatalogUrl(search.filters)} replace />
  }

  const hasActiveFilters =
    search.filters.category.length > 0 || search.filters.brand.length > 0

  const modeLabel =
    search.type === 'image'
      ? 'Image similarity'
      : SEARCH_MODES[search.mode] || 'Hybrid'

  return (
    <div className="search-page shop-columns">
      <FilterSidebar filters={search.filters} onChange={handleFilterChange} />

      <div className="search-content">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          hidden
          onChange={handleFileSelect}
          tabIndex={-1}
          aria-hidden="true"
        />

        {search.type === 'image' && !imageFile ? (
          <StatusBlock
            tone="empty"
            title="No image selected"
            message="Select an image to search for visually similar products."
            action={{
              label: 'Select image',
              onClick: () => fileInputRef.current?.click(),
            }}
          />
        ) : (
          <>
            <div className="search-toolbar">
              <div className="search-toolbar-main">
                <div className="search-query-info">
                  {search.type === 'image' ? (
                    <h1 className="search-title">
                      {thumbnailUrl && (
                        <img
                          src={thumbnailUrl}
                          alt="Search image"
                          className="search-thumbnail"
                        />
                      )}
                      <span>Visually similar products</span>
                    </h1>
                  ) : (
                    <h1 className="search-title">
                      Results for &ldquo;{search.query}&rdquo;
                    </h1>
                  )}
                </div>

                <div className="search-meta">
                  <span className="search-meta-mode">{modeLabel}</span>
                  {durationMs != null && !loading && !error && (
                    <>
                      <span className="search-meta-dot" aria-hidden="true">
                        ·
                      </span>
                      <span className="search-meta-count">
                        {items.length}{' '}
                        {items.length === 1 ? 'product' : 'products'}
                      </span>
                      <span className="search-meta-dot" aria-hidden="true">
                        ·
                      </span>
                      <span className="search-meta-duration">{durationMs} ms</span>
                    </>
                  )}
                </div>
              </div>

              {hasActiveFilters && (
                <div className="search-active-filters" aria-label="Active filters">
                  {search.filters.category.map((cat) => (
                    <span key={`cat-${cat}`} className="search-chip">
                      <span className="search-chip-label">
                        {humanizeCategory(cat)}
                      </span>
                      <button
                        type="button"
                        className="search-chip-remove"
                        aria-label={`Remove ${humanizeCategory(cat)} filter`}
                        onClick={() => handleRemoveCategory(cat)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {search.filters.brand.map((brand) => (
                    <span key={`brand-${brand}`} className="search-chip">
                      <span className="search-chip-label">{brand}</span>
                      <button
                        type="button"
                        className="search-chip-remove"
                        aria-label={`Remove ${brand} filter`}
                        onClick={() => handleRemoveBrand(brand)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    className="search-clear-all"
                    onClick={handleClearFilters}
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </div>

            {loading && !items.length ? (
              <ProductGrid products={[]} loading={true} skeletonCount={8} />
            ) : error ? (
              <StatusBlock
                tone="error"
                title="Search failed"
                message={error.message || 'Request failed'}
                action={{ label: 'Retry', onClick: reload }}
              />
            ) : !loading && items.length === 0 ? (
              <StatusBlock
                tone="empty"
                title="No products match"
                message="Try another mode, broader search terms, or clearing filters."
                action={
                  hasActiveFilters
                    ? { label: 'Clear filters', onClick: handleClearFilters }
                    : undefined
                }
              />
            ) : (
              <ProductGrid products={items} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
