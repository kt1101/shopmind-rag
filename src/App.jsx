import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { askProduct, checkReadiness, cleanFilters, getFilterOptions, resolveImageUrl, searchImage, searchText } from './api.js'

const MODES = {
  bm25: ['BM25', 'Exact-term ranking across titles, brands, categories, and descriptions.'],
  dense: ['Dense text', 'SigLIP2 text embeddings retrieve semantically similar product descriptions.'],
  cross_modal: ['Cross-modal', 'A text embedding searches the visual product embedding space.'],
  hybrid: ['Hybrid RRF', 'BM25 and dense rankings are fused with Reciprocal Rank Fusion.'],
  image_dense: ['Image dense', 'The uploaded image is embedded with SigLIP2 and matched against product images.'],
  filter_only: ['Filtered catalog', 'BM25 lists catalog products that satisfy the selected filters.'],
}

const EMPTY_RUN = { status: 'idle', results: [], durationMs: null, error: null }
const NO_SHARED_IDS = new Set()
const FILTER_FIELDS = {
  brand: { label: 'Brand', placeholder: 'Any brand', multiple: true },
  category: { label: 'Category', placeholder: 'Any category', multiple: true },
  product_id: { label: 'Product ID', placeholder: 'Paste or type an ID', multiple: false },
}

function humanizeOption(field, value) {
  if (field !== 'category') return value
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function FilterField({ field, value, draft, options, loading, error, onFocus, onDraftChange, onSelect, onRemove }) {
  const config = FILTER_FIELDS[field]
  const fieldRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const selected = config.multiple ? value : value ? [value] : []
  const visibleOptions = options.filter((option) => !selected.includes(option.value))

  useEffect(() => {
    if (!open) return undefined
    const closeWhenOutside = (event) => {
      if (!fieldRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', closeWhenOutside)
    return () => document.removeEventListener('mousedown', closeWhenOutside)
  }, [open])

  function choose(option) {
    onSelect(field, option.value)
    setOpen(false)
    setActiveIndex(-1)
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => Math.min(index + 1, visibleOptions.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (open && visibleOptions[activeIndex]) choose(visibleOptions[activeIndex])
      else if (draft.trim()) choose({ value: draft.trim() })
    } else if (event.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  return <div className="filter-field" ref={fieldRef}>
    <label>
      <span>{config.label}</span>
      <input
        value={draft}
        placeholder={config.placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${field}-filter-options`}
        aria-autocomplete="list"
        onFocus={() => { onFocus(field); setOpen(true) }}
        onChange={(event) => { onDraftChange(field, event.target.value); setOpen(true); setActiveIndex(-1) }}
        onKeyDown={handleKeyDown}
      />
    </label>
    {selected.length > 0 && <div className="filter-chips" aria-label={`Selected ${config.label}`}>
      {selected.map((item) => <button className="filter-chip" type="button" key={item} onClick={() => onRemove(field, item)} title={`Remove ${item}`}>
        {humanizeOption(field, item)} <span aria-hidden="true">×</span>
      </button>)}
    </div>}
    {open && <div className="filter-options" id={`${field}-filter-options`} role="listbox">
      {loading && <span className="filter-status">Loading options…</span>}
      {!loading && error && <span className="filter-status error">{error}</span>}
      {!loading && !error && visibleOptions.length === 0 && <span className="filter-status">No suggestions</span>}
      {!loading && !error && visibleOptions.map((option, index) => <button
        className={index === activeIndex ? 'filter-option active' : 'filter-option'}
        type="button"
        role="option"
        aria-selected={false}
        key={option.value}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(option)}
      >
        <span>{humanizeOption(field, option.value)}</span><small>{option.count}</small>
      </button>)}
    </div>}
  </div>
}

function ProductCard({ product, shared, selected, onSelect }) {
  const image = resolveImageUrl(product.image_url)
  const [broken, setBroken] = useState(false)
  return (
    <article className={`product-card${shared ? ' shared' : ''}${selected ? ' selected' : ''}`}>
      <div className="product-visual">
        {image && !broken ? <img src={image} alt={product.title} onError={() => setBroken(true)} /> : <span aria-hidden="true">◇</span>}
        <b>#{product.rank}</b>
        {shared && <em>Shared match</em>}
      </div>
      <div className="product-copy">
        <p className="eyebrow">{product.category || 'Uncategorised'} · {product.product_id}</p>
        <h3>{product.title}</h3>
        <div className="product-meta"><span>{product.brand || 'Unknown brand'}</span><strong>{product.score.toFixed(4)}</strong></div>
        <button className="ask-product-button" type="button" onClick={() => onSelect(product)} aria-pressed={selected}>{selected ? 'Selected for questions' : 'Ask about this product'} <span aria-hidden="true">↗</span></button>
      </div>
    </article>
  )
}

function ResultPanel({ mode, run, sharedIds, selectedProductId, onSelectProduct }) {
  const [label, description] = MODES[mode]
  return (
    <section className="result-panel" aria-busy={run.status === 'loading'}>
      <header>
        <div><span className="mode-dot" /><h2>{label}</h2></div>
        <p>{description}</p>
        <dl>
          <div><dt>Results</dt><dd>{run.results.length || '—'}</dd></div>
          <div><dt>Round trip</dt><dd>{run.durationMs === null ? '—' : `${run.durationMs} ms`}</dd></div>
        </dl>
      </header>
      <div className="result-list" aria-live="polite">
        {run.status === 'idle' && <div className="empty"><b>{mode === 'image_dense' ? 'Ready for an image' : mode === 'filter_only' ? 'Choose a filter' : 'Ready to compare'}</b><span>{mode === 'image_dense' ? 'Choose a product image to search the visual index.' : mode === 'filter_only' ? 'Select a Brand, Category, or Product ID to browse the catalog.' : 'Run the same query through both retrieval strategies.'}</span></div>}
        {run.status === 'loading' && <div className="empty pulse"><b>Searching the index</b><span>Ranking candidates…</span></div>}
        {run.status === 'error' && <div className="empty error"><b>Search failed</b><span>{run.error}</span></div>}
        {run.status === 'success' && !run.results.length && <div className="empty"><b>{mode === 'filter_only' || mode === 'image_dense' ? 'No products match these filters' : 'No matches'}</b><span>{mode === 'filter_only' || mode === 'image_dense' ? 'Try a different value or remove a filter.' : 'Try a broader query or remove a filter.'}</span></div>}
        {run.results.map((product) => <ProductCard key={product.product_id} product={product} shared={sharedIds.has(product.product_id)} selected={selectedProductId === product.product_id} onSelect={onSelectProduct} />)}
      </div>
    </section>
  )
}

function SourceCard({ source }) {
  const experimentalPolicy = source.source === 'policy' && source.metadata?.provenance === 'shopmind_curated_experimental'
  const sourceUrl = /^https?:\/\//i.test(source.source_url || '') ? source.source_url : null
  return <li className="answer-source">
    <div className="source-heading"><span className="source-type">{source.source}</span>{experimentalPolicy && <span className="experimental-label">Experimental policy</span>}<span className="source-score">Score {Number.isFinite(source.score) ? source.score.toFixed(4) : '—'}</span></div>
    <strong>{source.title}</strong>
    <small>{source.document_id}{source.policy_version ? ` · version ${source.policy_version}` : ''}{source.metadata?.score_type ? ` · ${source.metadata.score_type} score` : ''}</small>
    {experimentalPolicy && <p>Curated for this experiment; not actual store terms.</p>}
    {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Open source ↗</a>}
  </li>
}

function AnswerPanel({ product, question, onQuestionChange, onSubmit, sources, onToggleSource, answers, status, error }) {
  return <section className="ask-panel" id="ask-product" aria-label="Ask about a product">
    <div className="ask-intro"><p className="eyebrow">A3 · Grounded answers</p><h2>Ask about a product.</h2><p>{product ? <>Selected: <strong>{product.title}</strong> <span>({product.product_id})</span></> : 'Search by text or image, then choose a result above.'}</p></div>
    {product && <div className="ask-content">
      {answers.length > 0 && <ol className="answer-history" aria-label="Questions and answers">{answers.map((item, index) => <li className="answer-turn" key={index}>
        <p className="asked-question"><span>Question {index + 1}</span>{item.question}</p>
        <div className="answer-text">{item.answer}</div>
        {item.insufficient_evidence && <p className="evidence-warning">The indexed sources did not provide enough evidence for a reliable answer.</p>}
        {item.sources.length > 0 && <div className="answer-sources"><h3>Cited sources</h3><ol>{item.sources.map((source) => <SourceCard key={source.document_id} source={source} />)}</ol></div>}
      </li>)}</ol>}
      <form className="ask-form" onSubmit={onSubmit}>
        <label htmlFor="product-question">{answers.length ? 'Ask another question about this product' : 'Your question'}</label>
        <textarea id="product-question" value={question} onChange={(event) => onQuestionChange(event.target.value)} placeholder="How does it fit? What do reviews say?" rows="3" maxLength="2000" required />
        <fieldset className="ask-source-options" disabled={status === 'loading'}><legend>Evidence sources</legend>
          <span className="source-required">Product details included</span>
          <label><input type="checkbox" checked={sources.includes('review')} onChange={() => onToggleSource('review')} /> Reviews</label>
          <label><input type="checkbox" checked={sources.includes('policy')} onChange={() => onToggleSource('policy')} /> Experimental policies</label>
        </fieldset>
        <div><span>Choose the evidence to use for this answer.</span><button type="submit" disabled={!question.trim() || status === 'loading'}>{status === 'loading' ? 'Finding evidence…' : 'Ask question'} <span aria-hidden="true">↗</span></button></div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
      {status === 'loading' && <p className="ask-status" role="status">Finding evidence and composing an answer…</p>}
    </div>}
  </section>
}

export default function App() {
  const [ready, setReady] = useState('checking')
  const [activeTab, setActiveTab] = useState('text')
  const [query, setQuery] = useState('black running shoes')
  const [modeA, setModeA] = useState('bm25')
  const [modeB, setModeB] = useState('hybrid')
  const [topK, setTopK] = useState(10)
  const [filters, setFilters] = useState({ brand: [], category: [], product_id: '' })
  const [filterDrafts, setFilterDrafts] = useState({ brand: '', category: '', product_id: '' })
  const [filterOptions, setFilterOptions] = useState({ brand: [], category: [], product_id: [] })
  const [filterLoading, setFilterLoading] = useState({ brand: false, category: false, product_id: false })
  const [filterErrors, setFilterErrors] = useState({ brand: null, category: null, product_id: null })
  const [activeFilterField, setActiveFilterField] = useState(null)
  const [runs, setRuns] = useState([EMPTY_RUN, EMPTY_RUN])
  const [textFilterOnly, setTextFilterOnly] = useState(false)
  const [formError, setFormError] = useState(null)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [imageRun, setImageRun] = useState(EMPTY_RUN)
  const controller = useRef()
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [question, setQuestion] = useState('')
  const [selectedSources, setSelectedSources] = useState(['product'])
  const [answers, setAnswers] = useState([])
  const [answerStatus, setAnswerStatus] = useState('idle')
  const [answerError, setAnswerError] = useState(null)
  const answerController = useRef()

  useEffect(() => {
    const requestController = new AbortController()
    let retry
    const probe = () => checkReadiness(requestController.signal)
      .then(() => setReady('ready'))
      .catch((error) => {
        if (error.name === 'AbortError') return
        setReady('offline')
        retry = setTimeout(probe, 3000)
      })
    probe()
    return () => {
      requestController.abort()
      clearTimeout(retry)
    }
  }, [])

  const activeFilterPrefix = activeFilterField ? filterDrafts[activeFilterField] : ''

  useEffect(() => {
    if (!activeFilterField) return undefined
    const abortController = new AbortController()
    const timer = setTimeout(() => {
      setFilterLoading((current) => ({ ...current, [activeFilterField]: true }))
      setFilterErrors((current) => ({ ...current, [activeFilterField]: null }))
      getFilterOptions({ field: activeFilterField, prefix: activeFilterPrefix, limit: 20, signal: abortController.signal })
        .then((response) => { if (!abortController.signal.aborted) setFilterOptions((current) => ({ ...current, [activeFilterField]: response.data.options })) })
        .catch((error) => {
          if (error.name !== 'AbortError') setFilterErrors((current) => ({ ...current, [activeFilterField]: error.message }))
        })
        .finally(() => { if (!abortController.signal.aborted) setFilterLoading((current) => ({ ...current, [activeFilterField]: false })) })
    }, activeFilterPrefix ? 250 : 0)
    return () => {
      clearTimeout(timer)
      abortController.abort()
    }
  }, [activeFilterField, activeFilterPrefix])

  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null)
      return undefined
    }
    const preview = URL.createObjectURL(imageFile)
    setImagePreview(preview)
    return () => URL.revokeObjectURL(preview)
  }, [imageFile])

  const sharedIds = useMemo(() => {
    const left = new Set(runs[0].results.map((result) => result.product_id))
    return new Set(runs[1].results.filter((result) => left.has(result.product_id)).map((result) => result.product_id))
  }, [runs])

  function effectiveFilters() {
    return cleanFilters({
      brand: [...filters.brand, filterDrafts.brand],
      category: [...filters.category, filterDrafts.category],
      product_id: filterDrafts.product_id || filters.product_id,
    })
  }

  function updateFilterDraft(field, value) {
    setFilterDrafts((current) => ({ ...current, [field]: value }))
    if (field === 'product_id') setFilters((current) => ({ ...current, product_id: '' }))
  }

  function selectFilter(field, value) {
    setFilters((current) => {
      if (!FILTER_FIELDS[field].multiple) return { ...current, [field]: value }
      return current[field].includes(value) ? current : { ...current, [field]: [...current[field], value] }
    })
    setFilterDrafts((current) => ({ ...current, [field]: '' }))
  }

  function removeFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: FILTER_FIELDS[field].multiple ? current[field].filter((item) => item !== value) : '' }))
  }

  function clearFilters() {
    setFilters({ brand: [], category: [], product_id: '' })
    setFilterDrafts({ brand: '', category: '', product_id: '' })
  }

  async function compare(event) {
    event.preventDefault()
    const selectedFilters = effectiveFilters()
    if (!query.trim() && !Object.keys(selectedFilters).length) {
      setFormError('Enter a product query or choose at least one filter.')
      return
    }
    setFormError(null)
    controller.current?.abort()
    const requestController = new AbortController()
    controller.current = requestController
    const filterOnly = !query.trim()
    setTextFilterOnly(filterOnly)
    setRuns(filterOnly ? [{ ...EMPTY_RUN, status: 'loading' }, EMPTY_RUN] : [{ ...EMPTY_RUN, status: 'loading' }, { ...EMPTY_RUN, status: 'loading' }])
    const modes = filterOnly ? ['bm25'] : [modeA, modeB]
    const settled = await Promise.allSettled(modes.map((mode) => searchText({ query, mode, topK, filters: selectedFilters, signal: requestController.signal })))
    if (controller.current !== requestController) return
    const nextRuns = settled.map((result) => result.status === 'fulfilled'
      ? { status: 'success', results: result.value.data.results, durationMs: result.value.durationMs, error: null }
      : { ...EMPTY_RUN, status: 'error', error: result.reason.name === 'AbortError' ? 'Search cancelled.' : result.reason.message })
    setRuns(filterOnly ? [nextRuns[0], EMPTY_RUN] : nextRuns)
  }

  async function findSimilar(event) {
    event.preventDefault()
    if (!imageFile) return
    controller.current?.abort()
    const requestController = new AbortController()
    controller.current = requestController
    setImageRun({ ...EMPTY_RUN, status: 'loading' })
    try {
      const result = await searchImage({ file: imageFile, topK, filters: effectiveFilters(), signal: requestController.signal })
      if (controller.current !== requestController) return
      setImageRun({ status: 'success', results: result.data.results, durationMs: result.durationMs, error: null })
    } catch (error) {
      if (controller.current !== requestController) return
      setImageRun({ ...EMPTY_RUN, status: 'error', error: error.name === 'AbortError' ? 'Search cancelled.' : error.message })
    }
  }

  function chooseImage(files) {
    const file = files?.[0]
    if (file?.type.startsWith('image/')) setImageFile(file)
    else if (file) setImageRun({ ...EMPTY_RUN, status: 'error', error: 'Choose a valid image file.' })
  }

  function selectProduct(product) {
    if (selectedProduct?.product_id !== product.product_id) {
      answerController.current?.abort()
      answerController.current = null
      setSelectedProduct(product)
      setQuestion('')
      setAnswers([])
      setAnswerStatus('idle')
      setAnswerError(null)
    }
    document.getElementById('ask-product')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function toggleSource(source) {
    setSelectedSources((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source])
  }

  async function askQuestion(event) {
    event.preventDefault()
    if (!selectedProduct || !question.trim() || answerStatus === 'loading') return
    const asked = question.trim()
    const requestController = new AbortController()
    answerController.current = requestController
    setAnswerStatus('loading')
    setAnswerError(null)
    try {
      const { data } = await askProduct({ question: asked, productId: selectedProduct.product_id, sources: selectedSources, signal: requestController.signal })
      if (answerController.current !== requestController) return
      setAnswers((current) => [...current, { question: asked, ...data }])
      setQuestion('')
      setAnswerStatus('idle')
    } catch (error) {
      if (answerController.current !== requestController) return
      setAnswerError(error.message)
      setAnswerStatus('idle')
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/" aria-label="ShopMind home"><span>SM</span><strong>ShopMind</strong><small>Retrieval Lab / A1 + A3</small></a>
        <div className={`readiness ${ready}`} role="status" aria-live="polite"><span />{ready === 'checking' ? 'Checking API' : ready === 'ready' ? 'System ready' : 'API unavailable'}</div>
      </header>

      <section className="intro">
        <p className="eyebrow">Multimodal product intelligence</p>
        <h1>See what each retrieval strategy finds.</h1>
        <p>One query, two ranking paths. Compare lexical precision with semantic recall in the same product index.</p>
      </section>

      <nav className="tabs" aria-label="Search type">
        <button className={activeTab === 'text' ? 'active' : ''} type="button" onClick={() => setActiveTab('text')}>Compare text</button>
        <button className={activeTab === 'image' ? 'active' : ''} type="button" onClick={() => setActiveTab('image')}>Image search</button>
      </nav>

      {activeTab === 'text' ? <>
        <form className="search-console" onSubmit={compare}>
          <div className="query-row">
            <label><span>Product query <small>(optional when filters are selected)</small></span><input value={query} onChange={(event) => { setQuery(event.target.value); setFormError(null) }} placeholder="Try “black running shoes”" /></label>
            <button type="submit" disabled={runs.some((run) => run.status === 'loading') || (!query.trim() && !Object.keys(effectiveFilters()).length)}>{query.trim() ? 'Compare modes' : 'Search catalog'} <span aria-hidden="true">↗</span></button>
          </div>
          <div className="control-grid">
            <label><span>Mode A</span><select value={modeA} disabled={!query.trim()} onChange={(event) => setModeA(event.target.value)}>{Object.entries(MODES).filter(([value]) => !['image_dense', 'filter_only'].includes(value)).map(([value, [label]]) => <option key={value} value={value} disabled={value === modeB}>{label}</option>)}</select></label>
            <label><span>Mode B</span><select value={modeB} disabled={!query.trim()} onChange={(event) => setModeB(event.target.value)}>{Object.entries(MODES).filter(([value]) => !['image_dense', 'filter_only'].includes(value)).map(([value, [label]]) => <option key={value} value={value} disabled={value === modeA}>{label}</option>)}</select></label>
            <label><span>Top K</span><select value={topK} onChange={(event) => setTopK(Number(event.target.value))}>{[5, 10, 20].map((value) => <option key={value}>{value}</option>)}</select></label>
            {Object.keys(FILTER_FIELDS).map((field) => <FilterField key={field} field={field} value={filters[field]} draft={filterDrafts[field]} options={filterOptions[field]} loading={filterLoading[field]} error={filterErrors[field]} onFocus={setActiveFilterField} onDraftChange={updateFilterDraft} onSelect={selectFilter} onRemove={removeFilter} />)}
          </div>
          <div className="filter-toolbar"><span>Filters apply across the catalog.</span>{Object.keys(effectiveFilters()).length > 0 && <button type="button" onClick={clearFilters}>Clear all</button>}</div>
          {formError && <p className="form-error" role="alert">{formError}</p>}
        </form>
        <p className="score-note"><span>i</span> {textFilterOnly ? 'Filter-only catalog search uses deterministic BM25 ordering.' : 'Scores are native to each retrieval method and should not be compared directly across columns.'}</p>
        <div className={textFilterOnly ? 'comparison-grid single-result' : 'comparison-grid'}><ResultPanel mode={textFilterOnly ? 'filter_only' : modeA} run={runs[0]} sharedIds={sharedIds} selectedProductId={selectedProduct?.product_id} onSelectProduct={selectProduct} />{!textFilterOnly && <ResultPanel mode={modeB} run={runs[1]} sharedIds={sharedIds} selectedProductId={selectedProduct?.product_id} onSelectProduct={selectProduct} />}</div>
      </> : <>
        <form className="search-console image-console" onSubmit={findSimilar}>
          <label className={`drop-zone${imagePreview ? ' has-image' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseImage(event.dataTransfer.files) }}>
            <input type="file" accept="image/*" onChange={(event) => chooseImage(event.target.files)} />
            {imagePreview ? <img src={imagePreview} alt="Selected visual search query" /> : <span className="upload-mark" aria-hidden="true">+</span>}
            <strong>{imageFile ? imageFile.name : 'Drop a product image here'}</strong>
            <small>{imageFile ? 'Choose another image' : 'or choose a JPG, PNG, or WebP file'}</small>
          </label>
          <div className="image-controls">
            <div><p className="eyebrow">Visual similarity</p><h2>Find products that look like this.</h2><p>SigLIP2 places your image in the same embedding space as the indexed catalog.</p></div>
            <div className="image-filter-grid">
              <label><span>Top K</span><select value={topK} onChange={(event) => setTopK(Number(event.target.value))}>{[5, 10, 20].map((value) => <option key={value}>{value}</option>)}</select></label>
              {Object.keys(FILTER_FIELDS).map((field) => <FilterField key={field} field={field} value={filters[field]} draft={filterDrafts[field]} options={filterOptions[field]} loading={filterLoading[field]} error={filterErrors[field]} onFocus={setActiveFilterField} onDraftChange={updateFilterDraft} onSelect={selectFilter} onRemove={removeFilter} />)}
            </div>
            <div className="filter-toolbar"><span>Optional filters narrow visual matches.</span>{Object.keys(effectiveFilters()).length > 0 && <button type="button" onClick={clearFilters}>Clear all</button>}</div>
            <button className="image-submit" type="submit" disabled={!imageFile || imageRun.status === 'loading'}>Find similar products <span aria-hidden="true">↗</span></button>
          </div>
        </form>
        <div className="image-results"><ResultPanel mode="image_dense" run={imageRun} sharedIds={NO_SHARED_IDS} selectedProductId={selectedProduct?.product_id} onSelectProduct={selectProduct} /></div>
      </>}
      <AnswerPanel product={selectedProduct} question={question} onQuestionChange={setQuestion} onSubmit={askQuestion} sources={selectedSources} onToggleSource={toggleSource} answers={answers} status={answerStatus} error={answerError} />
    </main>
  )
}
