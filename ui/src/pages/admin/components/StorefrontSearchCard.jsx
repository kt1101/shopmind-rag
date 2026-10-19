import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { getPipelines } from '../../../api.js'
import { saveConfigProfile } from '../../../shared/api/admin.js'
import { getAtPath, normalizeHotReloadable } from '../lib/configTree.js'
import { formatDateTime } from '../lib/format.js'
import { defaultSearchHistory, defaultSearchProfileName, storefrontPipelineChoices } from '../lib/pipelines.js'
import { useAsync } from '../lib/useAsync.js'
import { Banner, Card, Pill, Skeleton } from './ui.jsx'
import { useI18n } from '../../../shared/ui/I18nProvider.jsx'

export const STOREFRONT_KEY = 'defaults.search'

// "Thuật toán tìm kiếm của cửa hàng": the one setting that decides what shoppers' text searches
// run (docs/API_CONTRACT.md "Storefront vs. staff"). Saving creates a config profile through
// the normal PUT /admin/config flow; rollback re-activates an earlier profile.
export default function StorefrontSearchCard({ config, profiles, rollbackTarget, onSaved, onActivate }) {
  const { t } = useI18n()
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
      onSaved?.(data, t('adm.sf.saved', { pipeline: value, name: data.profile?.name ?? name.trim() }))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      className="adm-storefront-card"
      title={t('adm.sf.title')}
      actions={<Link to={`/admin/playground${active ? `?a=${encodeURIComponent(active)}` : ''}`} className="adm-btn adm-btn-small">{t('adm.sf.try')}</Link>}
    >
      <p className="adm-muted adm-small" style={{ marginBottom: 10 }}>
        {t('adm.sf.intro', { key: STOREFRONT_KEY })}
      </p>
      {!config ? <Skeleton lines={3} /> : (
        <>
          <p className="adm-storefront-active">
            <span className="adm-muted">{t('adm.sf.active')}</span>
            <code>{active || '—'}</code>
            {activeInfo?.description && <span className="adm-muted adm-small">{activeInfo.description}</span>}
            {config.active_profile?.name && <span className="adm-small">{t('adm.sf.profile')} <strong>{config.active_profile.name}</strong></span>}
            {rollbackTarget && (
              <button type="button" className="adm-btn adm-btn-small" onClick={() => onActivate?.(rollbackTarget, 'rolledBack')} title={t('adm.sf.rollbackHint')}>
                {t('adm.sf.rollback', { name: rollbackTarget.name })}{rollbackTarget.overrides?.['defaults.search'] ? ` (${rollbackTarget.overrides['defaults.search']})` : ''}
              </button>
            )}
          </p>
          {!hot && <Banner tone="warn">{t('adm.sf.notHot', { key: STOREFRONT_KEY })}</Banner>}
          {meta.error && <Banner tone="bad">{t('adm.sf.pipelinesFailed', { message: meta.error.message })}</Banner>}
          <form className="adm-storefront-form" onSubmit={save}>
            <label className="adm-field" htmlFor="storefront-pipeline">
              <span>{t('adm.sf.pipeline')}</span>
              <select id="storefront-pipeline" value={value} onChange={(e) => setValue(e.target.value)} disabled={!hot || busy || (meta.loading && !meta.data)}>
                {!value && <option value="">—</option>}
                {choices.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}{p.name === active ? t('adm.sf.activeTag') : ''}{p.hidden ? t('adm.sf.hiddenTag') : ''}</option>
                ))}
              </select>
            </label>
            <label className="adm-field" htmlFor="storefront-profile">
              <span>{t('adm.cfg.profileName')}</span>
              <input id="storefront-profile" value={name} disabled={!changed || busy} onChange={(e) => { setName(e.target.value); setNameTouched(true) }} placeholder="search-default-…" />
            </label>
            <button type="submit" className="adm-btn adm-btn-primary" disabled={!hot || !changed || !name.trim() || busy}>{busy ? t('adm.saving') : t('adm.sf.save')}</button>
          </form>
          {selected && <p className="adm-muted adm-small adm-storefront-desc">{selected.description || t('adm.sf.noDescription')}{selected.steps?.length ? t('adm.sf.steps', { steps: selected.steps.map((s) => s.impl || s.step).join(' → ') }) : ''}</p>}
          {error && <Banner tone="bad">{error.message}{error.status === 422 ? t('adm.sf.validation') : ''}</Banner>}
          {history.length > 0 && (
            <>
              <h3 className="adm-small adm-muted" style={{ margin: '14px 0 0' }}>{t('adm.sf.history')}</h3>
              <ul className="adm-storefront-history">
                {history.slice(0, 5).map((h) => (
                  <li key={h.id}>
                    <code>{h.pipeline}</code>
                    <span className="adm-muted">{h.name} · {formatDateTime(h.createdAt)}{h.createdBy ? ` · ${h.createdBy}` : ''}</span>
                    {h.active ? <Pill value="active" /> : <button type="button" className="adm-btn adm-btn-small" onClick={() => onActivate?.({ id: h.id, name: h.name }, 'rolledBack')}>{t('adm.sf.rollbackThis')}</button>}
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
