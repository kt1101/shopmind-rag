import { useEffect, useState } from 'react'
import { getFilterOptions } from '../api.js'
import FilterField from '../components/FilterField.jsx'
import { useFilterOptions } from '../components/useFilterOptions.js'
import { humanizeCategory } from '../lib/format.js'

export default function FilterSidebar({ filters = {}, onChange }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [categoryOptions, setCategoryOptions] = useState([])
  const [categoryLoading, setCategoryLoading] = useState(true)
  const [categoryError, setCategoryError] = useState(null)
  const [categoryReloadIndex, setCategoryReloadIndex] = useState(0)

  const [brandDraft, setBrandDraft] = useState('')
  const [brandFocused, setBrandFocused] = useState(false)
  const {
    options: brandOptions,
    loading: brandLoading,
    error: brandError,
  } = useFilterOptions('brand', brandDraft, brandFocused)

  const selectedCategories = Array.isArray(filters?.category)
    ? filters.category
    : filters?.category
      ? [filters.category]
      : []

  const selectedBrands = Array.isArray(filters?.brand)
    ? filters.brand
    : filters?.brand
      ? [filters.brand]
      : []

  const activeCount = selectedCategories.length + selectedBrands.length

  useEffect(() => {
    const controller = new AbortController()
    setCategoryLoading(true)
    setCategoryError(null)

    getFilterOptions({ field: 'category', limit: 50, signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) {
          setCategoryOptions(res?.data?.options || [])
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setCategoryError(err.message || "Couldn't load categories")
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setCategoryLoading(false)
        }
      })

    return () => {
      controller.abort()
    }
  }, [categoryReloadIndex])

  useEffect(() => {
    if (!drawerOpen) return undefined
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setDrawerOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [drawerOpen])

  function handleCategoryToggle(value) {
    const nextCategories = selectedCategories.includes(value)
      ? selectedCategories.filter((cat) => cat !== value)
      : [...selectedCategories, value]

    onChange?.({
      ...filters,
      category: nextCategories,
    })
  }

  function handleBrandSelect(_, value) {
    setBrandDraft('')
    if (!selectedBrands.includes(value)) {
      onChange?.({
        ...filters,
        brand: [...selectedBrands, value],
      })
    }
  }

  function handleBrandRemove(_, value) {
    onChange?.({
      ...filters,
      brand: selectedBrands.filter((item) => item !== value),
    })
  }

  const knownCategoryValues = new Set((categoryOptions || []).map((opt) => opt.value))
  const extraSelected = selectedCategories.filter((val) => !knownCategoryValues.has(val))
  const displayedCategories = [
    ...extraSelected.map((val) => ({ value: val, count: null })),
    ...(categoryOptions || []),
  ]

  return (
    <aside className="filter-sidebar">
      <button
        type="button"
        className="filter-drawer-toggle"
        aria-expanded={drawerOpen}
        aria-controls="shop-filter-drawer"
        onClick={() => setDrawerOpen((prev) => !prev)}
      >
        Filters{activeCount > 0 ? ` (${activeCount})` : ''}
      </button>

      {drawerOpen && (
        <div
          className="filter-drawer-backdrop"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={`filter-drawer-panel ${drawerOpen ? 'open' : ''}`}
        id="shop-filter-drawer"
        aria-label="Filter products"
      >
        <div className="filter-drawer-header">
          <h3 className="filter-drawer-title">Filters</h3>
          <button
            type="button"
            className="filter-drawer-close"
            aria-label="Close filters"
            onClick={() => setDrawerOpen(false)}
          >
            ×
          </button>
        </div>

        <div className="filter-section filter-section-category">
          <span className="filter-section-title">Category</span>
          {categoryLoading && categoryOptions.length === 0 && (
            <span className="filter-loading">Loading categories…</span>
          )}
          {categoryError && (
            <div className="filter-inline-error">
              <span>Couldn't load categories</span>
              <button
                type="button"
                className="filter-retry-button"
                onClick={() => setCategoryReloadIndex((i) => i + 1)}
              >
                Retry
              </button>
            </div>
          )}
          <div className="filter-category-list" role="group" aria-label="Category filters">
            {displayedCategories.map((opt) => {
              const checked = selectedCategories.includes(opt.value)
              return (
                <label key={opt.value} className="filter-checkbox-label">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleCategoryToggle(opt.value)}
                  />
                  <span className="filter-checkbox-name">{humanizeCategory(opt.value)}</span>
                  {opt.count != null && <span className="filter-count">{opt.count}</span>}
                </label>
              )
            })}
          </div>
        </div>

        <div className="filter-section filter-section-brand">
          <FilterField
            field="brand"
            config={{ label: 'Brand', placeholder: 'Any brand', multiple: true }}
            value={selectedBrands}
            draft={brandDraft}
            options={brandOptions}
            loading={brandLoading}
            error={brandError}
            onFocus={() => setBrandFocused(true)}
            onDraftChange={(_, val) => setBrandDraft(val)}
            onSelect={handleBrandSelect}
            onRemove={handleBrandRemove}
          />
        </div>
      </div>
    </aside>
  )
}
