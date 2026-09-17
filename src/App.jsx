import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { checkReadiness, resolveImageUrl, searchImage, searchText } from './api.js'

const MODES = {
  bm25: ['BM25', 'Exact-term ranking across titles, brands, categories, and descriptions.'],
  dense: ['Dense text', 'SigLIP2 text embeddings retrieve semantically similar product descriptions.'],
  cross_modal: ['Cross-modal', 'A text embedding searches the visual product embedding space.'],
  hybrid: ['Hybrid RRF', 'BM25 and dense rankings are fused with Reciprocal Rank Fusion.'],
  image_dense: ['Image dense', 'The uploaded image is embedded with SigLIP2 and matched against product images.'],
}

const EMPTY_RUN = { status: 'idle', results: [], durationMs: null, error: null }
const NO_SHARED_IDS = new Set()

function ProductCard({ product, shared }) {
  const image = resolveImageUrl(product.image_url)
  const [broken, setBroken] = useState(false)
  return (
    <article className={`product-card${shared ? ' shared' : ''}`}>
      <div className="product-visual">
        {image && !broken ? <img src={image} alt={product.title} onError={() => setBroken(true)} /> : <span aria-hidden="true">◇</span>}
        <b>#{product.rank}</b>
        {shared && <em>Shared match</em>}
      </div>
      <div className="product-copy">
        <p className="eyebrow">{product.category || 'Uncategorised'} · {product.product_id}</p>
        <h3>{product.title}</h3>
        <div className="product-meta"><span>{product.brand || 'Unknown brand'}</span><strong>{product.score.toFixed(4)}</strong></div>
      </div>
    </article>
  )
}

function ResultPanel({ mode, run, sharedIds }) {
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
        {run.status === 'idle' && <div className="empty"><b>{mode === 'image_dense' ? 'Ready for an image' : 'Ready to compare'}</b><span>{mode === 'image_dense' ? 'Choose a product image to search the visual index.' : 'Run the same query through both retrieval strategies.'}</span></div>}
        {run.status === 'loading' && <div className="empty pulse"><b>Searching the index</b><span>Ranking candidates…</span></div>}
        {run.status === 'error' && <div className="empty error"><b>Search failed</b><span>{run.error}</span></div>}
        {run.status === 'success' && !run.results.length && <div className="empty"><b>No matches</b><span>Try a broader query or remove a filter.</span></div>}
        {run.results.map((product) => <ProductCard key={product.product_id} product={product} shared={sharedIds.has(product.product_id)} />)}
      </div>
    </section>
  )
}

export default function App() {
  const [ready, setReady] = useState('checking')
  const [activeTab, setActiveTab] = useState('text')
  const [query, setQuery] = useState('black running shoes')
  const [modeA, setModeA] = useState('bm25')
  const [modeB, setModeB] = useState('hybrid')
  const [topK, setTopK] = useState(10)
  const [filters, setFilters] = useState({ brand: '', category: '', product_id: '' })
  const [runs, setRuns] = useState([EMPTY_RUN, EMPTY_RUN])
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [imageRun, setImageRun] = useState(EMPTY_RUN)
  const controller = useRef()

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

  async function compare(event) {
    event.preventDefault()
    if (!query.trim()) return
    controller.current?.abort()
    const requestController = new AbortController()
    controller.current = requestController
    setRuns([{ ...EMPTY_RUN, status: 'loading' }, { ...EMPTY_RUN, status: 'loading' }])
    const settled = await Promise.allSettled([modeA, modeB].map((mode) => searchText({ query, mode, topK, filters, signal: requestController.signal })))
    if (controller.current !== requestController) return
    setRuns(settled.map((result) => result.status === 'fulfilled'
      ? { status: 'success', results: result.value.data.results, durationMs: result.value.durationMs, error: null }
      : { ...EMPTY_RUN, status: 'error', error: result.reason.name === 'AbortError' ? 'Search cancelled.' : result.reason.message }))
  }

  async function findSimilar(event) {
    event.preventDefault()
    if (!imageFile) return
    controller.current?.abort()
    const requestController = new AbortController()
    controller.current = requestController
    setImageRun({ ...EMPTY_RUN, status: 'loading' })
    try {
      const result = await searchImage({ file: imageFile, topK, filters, signal: requestController.signal })
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

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/" aria-label="ShopMind home"><span>SM</span><strong>ShopMind</strong><small>Retrieval Lab / A1</small></a>
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
            <label><span>Product query</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try “black running shoes”" required /></label>
            <button type="submit" disabled={runs.some((run) => run.status === 'loading')}>Compare modes <span aria-hidden="true">↗</span></button>
          </div>
          <div className="control-grid">
            <label><span>Mode A</span><select value={modeA} onChange={(event) => setModeA(event.target.value)}>{Object.entries(MODES).filter(([value]) => value !== 'image_dense').map(([value, [label]]) => <option key={value} value={value} disabled={value === modeB}>{label}</option>)}</select></label>
            <label><span>Mode B</span><select value={modeB} onChange={(event) => setModeB(event.target.value)}>{Object.entries(MODES).filter(([value]) => value !== 'image_dense').map(([value, [label]]) => <option key={value} value={value} disabled={value === modeA}>{label}</option>)}</select></label>
            <label><span>Top K</span><select value={topK} onChange={(event) => setTopK(Number(event.target.value))}>{[5, 10, 20].map((value) => <option key={value}>{value}</option>)}</select></label>
            {Object.entries({ brand: 'Brand', category: 'Category', product_id: 'Product ID' }).map(([key, label]) => <label key={key}><span>{label}</span><input value={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })} placeholder="Any" /></label>)}
          </div>
        </form>
        <p className="score-note"><span>i</span> Scores are native to each retrieval method and should not be compared directly across columns.</p>
        <div className="comparison-grid"><ResultPanel mode={modeA} run={runs[0]} sharedIds={sharedIds} /><ResultPanel mode={modeB} run={runs[1]} sharedIds={sharedIds} /></div>
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
              {Object.entries({ brand: 'Brand', category: 'Category', product_id: 'Product ID' }).map(([key, label]) => <label key={key}><span>{label}</span><input value={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })} placeholder="Any" /></label>)}
            </div>
            <button className="image-submit" type="submit" disabled={!imageFile || imageRun.status === 'loading'}>Find similar products <span aria-hidden="true">↗</span></button>
          </div>
        </form>
        <div className="image-results"><ResultPanel mode="image_dense" run={imageRun} sharedIds={NO_SHARED_IDS} /></div>
      </>}
    </main>
  )
}
