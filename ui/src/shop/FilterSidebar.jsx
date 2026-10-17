import { useEffect, useMemo, useState } from 'react'
import { getFacets, getFilterOptions } from '../api.js'
import FilterField from '../components/FilterField.jsx'
import { useFilterOptions } from '../components/useFilterOptions.js'
import { categoryLabel, colorLabel } from '../shared/i18n.js'
import { useI18n } from '../shared/ui/I18nProvider.jsx'
import { mergeFacet } from '../features/facets/facets.js'

const COLOR_SWATCH = {
  black: '#22252b', brown: '#8a5a3b', blue: '#3b6fd8', green: '#3f8f5a', white: '#f4f5f7', grey: '#8b93a1', red: '#c8423b', beige: '#cdb68f',
}

function asList(value) {
  return Array.isArray(value) ? value : value ? [value] : []
}

// Facet counts come from POST /search/facets (ES aggregations). If that endpoint fails,
// the sidebar falls back to filter-options (categories) and the brand autocomplete.
export default function FilterSidebar({ filters = {}, onChange, query = null, showColor = false }) {
  const { t, lang } = useI18n()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [facets, setFacets] = useState(null)
  const [facetsFailed, setFacetsFailed] = useState(false)
  const [categoryOptions, setCategoryOptions] = useState([])
  const [categoryLoading, setCategoryLoading] = useState(false)
  const [categoryError, setCategoryError] = useState(null)
  const [categoryReloadIndex, setCategoryReloadIndex] = useState(0)
  const [brandDraft, setBrandDraft] = useState('')
  const [brandFocused, setBrandFocused] = useState(false)

  const selected = {
    category: asList(filters?.category),
    brand: asList(filters?.brand),
    color: asList(filters?.color),
  }
  const activeCount = selected.category.length + selected.brand.length + (showColor ? selected.color.length : 0)
  const facetKey = JSON.stringify({ query, category: selected.category, brand: selected.brand, color: showColor ? selected.color : [] })

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const body = { category: selected.category, brand: selected.brand, ...(showColor ? { color: selected.color } : {}) }
      getFacets({ query: query || undefined, filters: body, signal: controller.signal })
        .then((res) => {
          if (controller.signal.aborted) return
          setFacets(res?.data?.facets || null)
          setFacetsFailed(!res?.data?.facets)
        })
        .catch((err) => {
          if (!controller.signal.aborted && err?.name !== 'AbortError') setFacetsFailed(true)
        })
    }, 120)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // facetKey captures every input
  }, [facetKey])

  // Fallback path: categories from filter-options.
  useEffect(() => {
    if (!facetsFailed) return undefined
    const controller = new AbortController()
    setCategoryLoading(true)
    setCategoryError(null)
    getFilterOptions({ field: 'category', limit: 50, signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) {
          setCategoryOptions((res?.data?.options || []).map((opt) => (typeof opt === 'string' ? { value: opt, count: null } : opt)))
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setCategoryError(err.message || t('filters.error'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setCategoryLoading(false)
      })
    return () => controller.abort()
  }, [facetsFailed, categoryReloadIndex, t])

  const { options: brandOptions, loading: brandLoading, error: brandError } = useFilterOptions('brand', brandDraft, facetsFailed && brandFocused)

  useEffect(() => {
    if (!drawerOpen) return undefined
    function handleKeyDown(event) {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [drawerOpen])

  function toggle(field, value) {
    const list = selected[field]
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
    onChange?.({ ...filters, [field]: next })
  }

  const categoryList = useMemo(
    () => (facets ? mergeFacet(facets.category, selected.category) : mergeFacet(categoryOptions, selected.category)),
    [facets, categoryOptions, facetKey],
  )
  const brandList = useMemo(() => (facets ? mergeFacet(facets.brand, selected.brand) : []), [facets, facetKey])
  const colorList = useMemo(() => (facets ? mergeFacet(facets.color, selected.color) : []), [facets, facetKey])

  function checkboxList(field, list, labelFor, groupLabel) {
    return (
      <div className="filter-category-list" role="group" aria-label={groupLabel}>
        {list.map((opt) => (
          <label key={opt.value} className={`filter-checkbox-label ${opt.count === 0 ? 'is-zero' : ''}`}>
            <input type="checkbox" checked={selected[field].includes(opt.value)} onChange={() => toggle(field, opt.value)} />
            {field === 'color' && <span className="filter-swatch" style={{ background: COLOR_SWATCH[opt.value] || 'var(--color-surface-3)' }} aria-hidden="true" />}
            <span className="filter-checkbox-name">{labelFor(opt.value)}</span>
            {opt.count != null && <span className="filter-count">{opt.count}</span>}
          </label>
        ))}
      </div>
    )
  }

  return (
    <aside className="filter-sidebar">
      <button type="button" className="filter-drawer-toggle" aria-expanded={drawerOpen} aria-controls="shop-filter-drawer" onClick={() => setDrawerOpen((prev) => !prev)}>
        {t('filters.title')}{activeCount > 0 ? ` (${activeCount})` : ''}
      </button>

      {drawerOpen && <div className="filter-drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}

      <div className={`filter-drawer-panel ${drawerOpen ? 'open' : ''}`} id="shop-filter-drawer" aria-label={t('filters.title')}>
        <div className="filter-drawer-header">
          <h3 className="filter-drawer-title">{t('filters.title')}</h3>
          <button type="button" className="filter-drawer-close" aria-label={t('filters.close')} onClick={() => setDrawerOpen(false)}>×</button>
        </div>
        {facets && <p className="filter-facets-hint">{t('filters.facetsHint')}</p>}

        <div className="filter-section filter-section-category">
          <span className="filter-section-title">{t('filters.category')}</span>
          {!facets && !facetsFailed && <span className="filter-loading">{t('filters.loading')}</span>}
          {facetsFailed && categoryLoading && categoryOptions.length === 0 && <span className="filter-loading">{t('filters.loading')}</span>}
          {facetsFailed && categoryError && (
            <div className="filter-inline-error">
              <span>{t('filters.error')}</span>
              <button type="button" className="filter-retry-button" onClick={() => setCategoryReloadIndex((i) => i + 1)}>{t('state.retry')}</button>
            </div>
          )}
          {checkboxList('category', categoryList, (v) => categoryLabel(lang, v), t('filters.category'))}
        </div>

        <div className="filter-section filter-section-brand">
          {facets ? (
            <>
              <span className="filter-section-title">{t('filters.brand')}</span>
              {checkboxList('brand', brandList, (v) => v, t('filters.brand'))}
            </>
          ) : facetsFailed ? (
            <FilterField
              field="brand"
              config={{ label: t('filters.brand'), placeholder: t('filters.anyBrand'), multiple: true }}
              value={selected.brand}
              draft={brandDraft}
              options={brandOptions}
              loading={brandLoading}
              error={brandError}
              onFocus={() => setBrandFocused(true)}
              onDraftChange={(_, val) => setBrandDraft(val)}
              onSelect={(_, value) => {
                setBrandDraft('')
                if (!selected.brand.includes(value)) onChange?.({ ...filters, brand: [...selected.brand, value] })
              }}
              onRemove={(_, value) => onChange?.({ ...filters, brand: selected.brand.filter((item) => item !== value) })}
            />
          ) : null}
        </div>

        {showColor && facets && colorList.length > 0 && (
          <div className="filter-section filter-section-color">
            <span className="filter-section-title">{t('filters.color')}</span>
            {checkboxList('color', colorList, (v) => colorLabel(lang, v), t('filters.color'))}
          </div>
        )}
      </div>
    </aside>
  )
}
