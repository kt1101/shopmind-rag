import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { getPipelines } from '../../../api.js'
import { saveConfigProfile } from '../../../shared/api/admin.js'
import { getAtPath, normalizeHotReloadable } from '../lib/configTree.js'
import { formatDateTime } from '../lib/format.js'
import { defaultSearchHistory, defaultSearchProfileName, storefrontPipelineChoices } from '../lib/pipelines.js'
import { useAsync } from '../lib/useAsync.js'
import { Banner, Card, Pill, Skeleton } from './ui.jsx'

export const STOREFRONT_KEY = 'defaults.search'

// "Thuật toán tìm kiếm của cửa hàng": the one setting that decides what shoppers' text searches
// run (docs/API_CONTRACT.md "Storefront vs. staff"). Saving creates a config profile through
// the normal PUT /admin/config flow; rollback re-activates an earlier profile.
export default function StorefrontSearchCard({ config, profiles, rollbackTarget, onSaved, onActivate }) {
  const meta = useAsync((signal) => getPipelines({ signal }), [])
  const active = getAtPath(config?.effective, STOREFRONT_KEY) ?? null
  const hot = useMemo(() => normalizeHotReloadable(config?.hot_reloadable).some((spec) => spec.key === STOREFRONT_KEY), [config])
  const choices = useMemo(() => storefrontPipelineChoices(meta.data?.pipelines, active), [meta.data, active])
  const history = useMemo(() => defaultSearchHistory(profiles), [profiles])
  const [value, setValue] = useState(active || '')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setValue(active || '')
  }, [active])

  useEffect(() => {
    if (!nameTouched) setName(value && value !== active ? defaultSearchProfileName(value) : '')
  }, [value, active, nameTouched])

  const selected = choices.find((p) => p.name === value)
  const activeInfo = choices.find((p) => p.name === active)
  const changed = Boolean(value) && value !== active

  async function save(event) {
    event.preventDefault()
    if (!changed || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const { data } = await saveConfigProfile({ name: name.trim(), overrides: { [STOREFRONT_KEY]: value } })
      setNameTouched(false)
      onSaved?.(data, `Storefront search now runs “${value}” (profile “${data.profile?.name ?? name.trim()}”).`)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      className="adm-storefront-card"
      title="Thuật toán tìm kiếm của cửa hàng · Storefront search algorithm"
      actions={<Link to={`/admin/playground${active ? `?a=${encodeURIComponent(active)}` : ''}`} className="adm-btn adm-btn-small">Try in Search Playground</Link>}
    >
      <p className="adm-muted adm-small" style={{ marginBottom: 10 }}>
        Shoppers never pick an algorithm: every storefront text search runs this pipeline (<code>{STOREFRONT_KEY}</code>, hot-reloadable, no restart).
        Filter-only browsing always uses BM25.
      </p>
      {!config ? <Skeleton lines={3} /> : (
        <>
          <p className="adm-storefront-active">
            <span className="adm-muted">Active:</span>
            <code>{active || '—'}</code>
            {activeInfo?.description && <span className="adm-muted adm-small">{activeInfo.description}</span>}
            {config.active_profile?.name && <span className="adm-small">profile <strong>{config.active_profile.name}</strong></span>}
            {rollbackTarget && (
              <button type="button" className="adm-btn adm-btn-small" onClick={() => onActivate?.(rollbackTarget, 'Rolled back to')} title="Re-activates the previous profile (all of its overrides)">
                Roll back to “{rollbackTarget.name}”{rollbackTarget.overrides?.['defaults.search'] ? ` (${rollbackTarget.overrides['defaults.search']})` : ''}
              </button>
            )}
          </p>
          {!hot && <Banner tone="warn">The backend does not list <code>{STOREFRONT_KEY}</code> as hot-reloadable, so it cannot be changed here.</Banner>}
          {meta.error && <Banner tone="bad">Could not load pipelines: {meta.error.message}</Banner>}
          <form className="adm-storefront-form" onSubmit={save}>
            <label className="adm-field" htmlFor="storefront-pipeline">
              <span>Pipeline</span>
              <select id="storefront-pipeline" value={value} onChange={(e) => setValue(e.target.value)} disabled={!hot || busy || (meta.loading && !meta.data)}>
                {!value && <option value="">—</option>}
                {choices.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}{p.name === active ? ' (active)' : ''}{p.hidden ? ' · not public' : ''}</option>
                ))}
              </select>
            </label>
            <label className="adm-field" htmlFor="storefront-profile">
              <span>Profile name</span>
              <input id="storefront-profile" value={name} disabled={!changed || busy} onChange={(e) => { setName(e.target.value); setNameTouched(true) }} placeholder="search-default-…" />
            </label>
            <button type="submit" className="adm-btn adm-btn-primary" disabled={!hot || !changed || !name.trim() || busy}>{busy ? 'Saving…' : 'Save & activate'}</button>
          </form>
          {selected && <p className="adm-muted adm-small adm-storefront-desc">{selected.description || 'No description.'}{selected.steps?.length ? ` Steps: ${selected.steps.map((s) => s.impl || s.step).join(' → ')}.` : ''}</p>}
          {error && <Banner tone="bad">{error.message}{error.status === 422 ? ' (validation failed)' : ''}</Banner>}
          {history.length > 0 && (
            <>
              <h3 className="adm-small adm-muted" style={{ margin: '14px 0 0' }}>History (activating a profile restores all of its overrides)</h3>
              <ul className="adm-storefront-history">
                {history.slice(0, 5).map((h) => (
                  <li key={h.id}>
                    <code>{h.pipeline}</code>
                    <span className="adm-muted">{h.name} · {formatDateTime(h.createdAt)}{h.createdBy ? ` · ${h.createdBy}` : ''}</span>
                    {h.active ? <Pill value="active" /> : <button type="button" className="adm-btn adm-btn-small" onClick={() => onActivate?.({ id: h.id, name: h.name }, 'Rolled back to')}>Roll back to this</button>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Card>
  )
}
