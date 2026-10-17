import { useEffect, useMemo, useState } from 'react'
import { activateConfigProfile, getConfig, listConfigProfiles, saveConfigProfile } from '../../../shared/api/admin.js'
import { useAsync } from '../lib/useAsync.js'
import {
  coerceInput, diffConfig, fieldErrorsFrom, flattenConfig, formatConfigValue, inferInputType,
  normalizeHotReloadable, overridesFromDiff, toTree,
} from '../lib/configTree.js'
import { formatDateTime } from '../lib/format.js'
import { Banner, Card, EmptyState, ErrorState, PageHeader, Pill, Skeleton, TableSkeleton } from '../components/ui.jsx'
import StorefrontSearchCard from '../components/StorefrontSearchCard.jsx'
import { useI18n } from '../../../shared/ui/I18nProvider.jsx'

// Client-side validation messages from configTree.coerceInput -> i18n keys (server messages
// pass through as sent).
const FIELD_ERRORS = {
  Required: 'adm.cfg.err.required',
  'Must be a number': 'adm.cfg.err.number',
  'Must be an integer': 'adm.cfg.err.integer',
  'Not an allowed value': 'adm.cfg.err.option',
  'Invalid JSON': 'adm.cfg.err.json',
  'Invalid value': 'adm.cfg.err.invalid',
}

function TreeNode({ node, hotKeys, depth }) {
  if (node.children) {
    return (
      <li>
        <details open={depth < 1}>
          <summary><span className="adm-tree-key">{node.key}</span> <span className="adm-muted adm-small">{node.children.length}</span></summary>
          <ul>{node.children.map((c) => <TreeNode key={c.path} node={c} hotKeys={hotKeys} depth={depth + 1} />)}</ul>
        </details>
      </li>
    )
  }
  return (
    <li className="adm-tree-leaf">
      <span className="adm-tree-key">{node.key}</span>
      <code className="adm-tree-value">{formatConfigValue(node.value)}</code>
      {hotKeys.has(node.path) && <Pill tone="info">hot</Pill>}
    </li>
  )
}

function ConfigInput({ id, spec, input, raw, onChange, error }) {
  const { t } = useI18n()
  const describedBy = error ? `${id}-err` : undefined
  if (input.type === 'boolean') {
    return (
      <label className="adm-switch">
        <input id={id} type="checkbox" checked={raw === true || raw === 'true'} onChange={(e) => onChange(e.target.checked)} aria-describedby={describedBy} />
        <span>{raw === true || raw === 'true' ? t('adm.cfg.enabled') : t('adm.cfg.disabled')}</span>
      </label>
    )
  }
  if (input.type === 'enum') {
    return (
      <select id={id} value={raw ?? ''} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={describedBy}>
        {input.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (input.type === 'integer' || input.type === 'number') {
    return <input id={id} type="number" inputMode="decimal" value={raw ?? ''} min={input.min} max={input.max} step={input.step} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={describedBy} />
  }
  if (input.type === 'json') {
    return <textarea id={id} rows={2} value={raw ?? ''} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={describedBy} spellCheck={false} />
  }
  return <input id={id} type="text" value={raw ?? ''} placeholder={spec.placeholder} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={describedBy} />
}

function toRaw(input, value) {
  if (input.type === 'json') return JSON.stringify(value)
  if (input.type === 'boolean') return !!value
  return value == null ? '' : String(value)
}

export default function ConfigPage() {
  const { t } = useI18n()
  const config = useAsync((signal) => getConfig({ signal }), [])
  const profiles = useAsync((signal) => listConfigProfiles({ signal }), [])
  const [raw, setRaw] = useState({})
  const [name, setName] = useState('')
  const [serverErrors, setServerErrors] = useState({})
  const [saveError, setSaveError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const effective = config.data?.effective
  const activeFlat = useMemo(() => (effective ? flattenConfig(effective) : {}), [effective])
  const fields = useMemo(() => normalizeHotReloadable(config.data?.hot_reloadable).map((spec) => ({
    spec,
    input: inferInputType(spec.key, activeFlat[spec.key], spec),
  })), [config.data, activeFlat])
  const hotKeys = useMemo(() => new Set(fields.map((f) => f.spec.key)), [fields])

  // Seed the form whenever the active config changes.
  useEffect(() => {
    setRaw(Object.fromEntries(fields.map(({ spec, input }) => [spec.key, toRaw(input, activeFlat[spec.key])])))
  }, [fields, activeFlat])

  const parsed = useMemo(() => {
    const values = {}
    const errors = {}
    for (const { spec, input } of fields) {
      if (!(spec.key in raw)) continue
      const result = coerceInput(input, raw[spec.key])
      if (result.error) errors[spec.key] = result.error
      else values[spec.key] = result.value
    }
    return { values, errors }
  }, [fields, raw])
  const diff = useMemo(() => diffConfig(activeFlat, parsed.values), [activeFlat, parsed.values])
  const hasClientErrors = Object.keys(parsed.errors).length > 0

  function update(key, value) {
    setRaw((r) => ({ ...r, [key]: value }))
    setServerErrors((e) => {
      if (!e[key]) return e
      const next = { ...e }
      delete next[key]
      return next
    })
  }

  async function onSave(event) {
    event.preventDefault()
    setSaveError(null)
    setMessage(null)
    setBusy(true)
    try {
      const { data } = await saveConfigProfile({ name: name.trim(), overrides: overridesFromDiff(diff) })
      config.setData((d) => ({ ...d, effective: data.effective, active_profile: data.profile }))
      profiles.reload()
      setServerErrors({})
      setName('')
      setMessage(t('adm.cfg.saved', { name: data.profile?.name }))
    } catch (error) {
      if (error.status === 422) {
        const fieldErrors = fieldErrorsFrom(error)
        setServerErrors(fieldErrors)
        setSaveError(Object.keys(fieldErrors).length ? t('adm.cfg.validation') : error.message)
      } else {
        setSaveError(error.message)
      }
    } finally {
      setBusy(false)
    }
  }

  // `verb` is 'activated' or 'rolledBack' (message key).
  async function activate(profile, verb = 'activated') {
    setMessage(null)
    setSaveError(null)
    try {
      const { data } = await activateConfigProfile({ id: profile.id })
      config.setData((d) => ({ ...d, effective: data.effective ?? d.effective, active_profile: data.profile ?? profile }))
      if (!data.effective) config.reload()
      profiles.reload()
      setMessage(t(verb === 'rolledBack' ? 'adm.cfg.rolledBack' : 'adm.cfg.activated', { name: profile.name }))
    } catch (error) {
      setSaveError(error.message)
    }
  }

  function onStorefrontSaved(data, text) {
    config.setData((d) => ({ ...d, effective: data.effective ?? d.effective, active_profile: data.profile ?? d.active_profile }))
    if (!data.effective) config.reload()
    profiles.reload()
    setSaveError(null)
    setMessage(text)
  }

  const items = profiles.data?.items || []
  const activeIndex = items.findIndex((p) => p.active)
  const rollbackTarget = activeIndex >= 0 ? items.slice(activeIndex + 1).find((p) => !p.active) : null

  return (
    <>
      <PageHeader title={t('adm.cfg.title')} description={t('adm.cfg.intro')} />
      {message && <Banner tone="good">{message}</Banner>}
      {!(config.error && !config.data) && <StorefrontSearchCard config={config.data} profiles={items} rollbackTarget={rollbackTarget} onSaved={onStorefrontSaved} onActivate={activate} />}
      {config.error && !config.data && <ErrorState error={config.error} onRetry={config.reload} />}
      {config.loading && !config.data && <div className="adm-grid-2"><Card><Skeleton lines={12} /></Card><Card><Skeleton lines={12} /></Card></div>}
      {config.data && (
        <div className="adm-grid-2 adm-grid-config">
          <Card title={t('adm.cfg.effective')} actions={config.data.active_profile && <span className="adm-muted adm-small">{t('adm.cfg.active')} <strong>{config.data.active_profile.name}</strong></span>}>
            <ul className="adm-tree">
              {toTree(effective).map((n) => <TreeNode key={n.path} node={n} hotKeys={hotKeys} depth={0} />)}
            </ul>
          </Card>
          <Card title={t('adm.cfg.edit')}>
            {fields.length === 0 ? <EmptyState title={t('adm.cfg.noHot')} message={t('adm.cfg.noHotText')} /> : (
              <form onSubmit={onSave} className="adm-config-form" noValidate>
                {fields.map(({ spec, input }) => {
                  const id = `cfg-${spec.key.replace(/\W/g, '-')}`
                  const error = parsed.errors[spec.key] || serverErrors[spec.key]
                  const changed = diff.some((d) => d.key === spec.key)
                  return (
                    <div key={spec.key} className={`adm-config-row ${changed ? 'changed' : ''} ${error ? 'invalid' : ''}`}>
                      <label htmlFor={id}><code>{spec.key}</code> <span className="adm-muted adm-small">{input.type}</span></label>
                      <ConfigInput id={id} spec={spec} input={input} raw={raw[spec.key]} onChange={(v) => update(spec.key, v)} error={error} />
                      {error && <p id={`${id}-err`} className="adm-field-error">{FIELD_ERRORS[error] ? t(FIELD_ERRORS[error]) : error}</p>}
                    </div>
                  )
                })}
                <div className="adm-diff" aria-live="polite">
                  <h3>{t('adm.cfg.diff')}</h3>
                  {diff.length === 0 ? <p className="adm-muted">{t('adm.cfg.noChanges')}</p> : (
                    <table className="adm-table adm-table-compact">
                      <thead><tr><th scope="col">{t('adm.cfg.key')}</th><th scope="col">{t('adm.cfg.current')}</th><th scope="col">{t('adm.cfg.new')}</th></tr></thead>
                      <tbody>
                        {diff.map((d) => (
                          <tr key={d.key}>
                            <td><code>{d.key}</code></td>
                            <td><del>{formatConfigValue(d.from)}</del></td>
                            <td><ins>{formatConfigValue(d.to)}</ins></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                {saveError && <Banner tone="bad">{saveError}</Banner>}
                <div className="adm-form-actions">
                  <label className="adm-field adm-field-inline">
                    <span>{t('adm.cfg.profileName')}</span>
                    <input value={name} onChange={(e) => { setName(e.target.value); setServerErrors((s) => ({ ...s, name: undefined })) }} placeholder={t('adm.cfg.profilePlaceholder')} aria-invalid={!!serverErrors.name} />
                    {serverErrors.name && <span className="adm-field-error">{serverErrors.name}</span>}
                  </label>
                  <button type="button" className="adm-btn adm-btn-ghost" disabled={diff.length === 0} onClick={() => setRaw(Object.fromEntries(fields.map(({ spec, input }) => [spec.key, toRaw(input, activeFlat[spec.key])])))}>{t('adm.cfg.reset')}</button>
                  <button type="submit" className="adm-btn adm-btn-primary" disabled={busy || diff.length === 0 || hasClientErrors || !name.trim()}>
                    {busy ? t('adm.saving') : t('adm.cfg.save')}
                  </button>
                </div>
              </form>
            )}
          </Card>
        </div>
      )}
      <Card
        title={t('adm.cfg.profiles')}
        actions={rollbackTarget && <button type="button" className="adm-btn" onClick={() => activate(rollbackTarget, 'rolledBack')}>{t('adm.cfg.rollbackTo', { name: rollbackTarget.name })}</button>}
      >
        {profiles.loading && !profiles.data ? <TableSkeleton cols={5} rows={3} /> : profiles.error && !profiles.data ? <ErrorState error={profiles.error} onRetry={profiles.reload} /> : items.length === 0 ? <EmptyState title={t('adm.cfg.noProfiles')} /> : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th scope="col">{t('adm.name')}</th><th scope="col">{t('adm.created')}</th><th scope="col">{t('adm.by')}</th><th scope="col">{t('adm.cfg.overrides')}</th><th scope="col">{t('adm.status')}</th></tr></thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong></td>
                    <td>{formatDateTime(p.created_at)}</td>
                    <td>{p.created_by}</td>
                    <td>
                      {Object.keys(p.overrides || {}).length === 0 ? <span className="adm-muted">{t('adm.cfg.defaults')}</span> : (
                        <ul className="adm-inline-list">
                          {Object.entries(p.overrides).map(([k, v]) => <li key={k}><code>{k}={formatConfigValue(v)}</code></li>)}
                        </ul>
                      )}
                    </td>
                    <td>{p.active ? <Pill value="active" /> : <button type="button" className="adm-btn adm-btn-small" onClick={() => activate(p)}>{t('adm.cfg.activate')}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
