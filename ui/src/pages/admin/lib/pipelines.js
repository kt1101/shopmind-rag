// GET /meta/pipelines helpers for staff tools (docs/API_CONTRACT.md "Traces & meta" and
// "Storefront vs. staff"). Items without a `public` flag (older backends) count as public.

export function isPublicPipeline(pipeline) {
  return pipeline?.public !== false
}

// Text-search pipelines for the Search Playground: public ones first (the storefront default
// on top), then evaluation-only ones; each tagged {hidden, isDefault}.
export function searchPipelineOptions(pipelines = [], { defaultName = null, includeHidden = true } = {}) {
  const list = (Array.isArray(pipelines) ? pipelines : [])
    .filter((p) => p && typeof p.name === 'string' && p.kind === 'search')
    .filter((p) => includeHidden || isPublicPipeline(p))
    .map((p) => ({
      name: p.name,
      description: p.description || '',
      steps: Array.isArray(p.steps) ? p.steps : [],
      hidden: !isPublicPipeline(p),
      isDefault: p.name === defaultName,
    }))
  const seen = new Set()
  return list
    .filter((p) => (seen.has(p.name) ? false : seen.add(p.name)))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(a.hidden) - Number(b.hidden) || a.name.localeCompare(b.name))
}

// Choices for the storefront default (`defaults.search`): public text-search pipelines only.
// The active value stays selectable even if it is no longer public, so the form never lies.
export function storefrontPipelineChoices(pipelines = [], active = null) {
  const options = searchPipelineOptions(pipelines, { defaultName: active, includeHidden: false })
  if (active && !options.some((p) => p.name === active)) {
    const known = (Array.isArray(pipelines) ? pipelines : []).find((p) => p?.name === active)
    options.unshift({ name: active, description: known?.description || '', steps: [], hidden: true, isDefault: true })
  }
  return options
}

// Profile name for a one-key change of the storefront pipeline, e.g. "search-default-hybrid_linear".
export function defaultSearchProfileName(pipeline) {
  const slug = String(pipeline || '').replace(/^search\./, '').replace(/[^a-z0-9_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'pipeline'
  return `search-default-${slug}`
}

// Profiles (newest first) that set `defaults.search`, for the rollback list of the card.
export function defaultSearchHistory(profiles = []) {
  return (Array.isArray(profiles) ? profiles : [])
    .filter((p) => p && p.overrides && typeof p.overrides['defaults.search'] === 'string')
    .map((p) => ({ id: p.id, name: p.name, pipeline: p.overrides['defaults.search'], createdAt: p.created_at ?? null, createdBy: p.created_by ?? null, active: Boolean(p.active) }))
}
