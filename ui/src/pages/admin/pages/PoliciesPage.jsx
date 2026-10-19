import { useState } from 'react'
import { Link } from 'react-router'
import { createPolicy, listPolicies, publishPolicies, updatePolicy } from '../../../shared/api/admin.js'
import { useAsync } from '../lib/useAsync.js'
import { fieldErrorsFrom } from '../lib/configTree.js'
import { formatDateTime } from '../lib/format.js'
import { Banner, Card, EmptyState, ErrorState, PageHeader, Pill, TableSkeleton } from '../components/ui.jsx'
import { useI18n } from '../../../shared/ui/I18nProvider.jsx'

const POLICY_TYPES = ['returns', 'shipping', 'warranty', 'payment', 'privacy', 'other']
const CONTENT_SOFT_LIMIT = 2000
const EMPTY = { title: '', section_id: '', policy_type: 'returns', version: 1, content: '' }

function PolicyForm({ initial, onSaved, onCancel }) {
  const { t, lang } = useI18n()
  const [form, setForm] = useState(() => ({ ...EMPTY, ...initial }))
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const editing = !!initial?.id

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  async function onSubmit(event) {
    event.preventDefault()
    const local = {}
    if (!form.title.trim()) local.title = t('adm.pol.e.title')
    if (!form.section_id.trim()) local.section_id = t('adm.pol.e.section')
    if (!form.content.trim()) local.content = t('adm.pol.e.content')
    if (!(Number(form.version) >= 1) || !Number.isInteger(Number(form.version))) local.version = t('adm.pol.e.version')
    if (Object.keys(local).length) {
      setErrors(local)
      return
    }
    setBusy(true)
    setError(null)
    const policy = {
      title: form.title.trim(),
      section_id: form.section_id.trim(),
      policy_type: form.policy_type,
      version: Number(form.version),
      content: form.content,
      ...(form.policy_id ? { policy_id: form.policy_id } : {}),
    }
    try {
      const { data } = editing ? await updatePolicy({ id: initial.id, policy }) : await createPolicy({ policy })
      onSaved(data, editing)
    } catch (err) {
      if (err.status === 422) setErrors(fieldErrorsFrom(err))
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const chars = form.content.length
  const field = (name) => ({ 'aria-invalid': !!errors[name], 'aria-describedby': errors[name] ? `pol-${name}-err` : undefined })
  const fieldError = (name) => errors[name] && <span id={`pol-${name}-err`} className="adm-field-error">{errors[name]}</span>

  return (
    <form className="adm-policy-form" onSubmit={onSubmit} noValidate>
      <div className="adm-form-grid">
        <label className="adm-field adm-span-2">
          <span>{t('adm.pol.f.title')}</span>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} {...field('title')} />
          {fieldError('title')}
        </label>
        <label className="adm-field">
          <span>{t('adm.pol.f.section')}</span>
          <input value={form.section_id} onChange={(e) => set('section_id', e.target.value)} placeholder="returns.window" {...field('section_id')} />
          {fieldError('section_id')}
        </label>
        <label className="adm-field">
          <span>{t('adm.pol.f.type')}</span>
          <select value={form.policy_type} onChange={(e) => set('policy_type', e.target.value)}>
            {[...new Set([...POLICY_TYPES, form.policy_type])].map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span>{t('adm.pol.f.version')}</span>
          <input type="number" min={1} step={1} value={form.version} onChange={(e) => set('version', e.target.value)} {...field('version')} />
          {fieldError('version')}
        </label>
        <label className="adm-field adm-span-2">
          <span>{t('adm.pol.f.content')}</span>
          <textarea rows={8} value={form.content} onChange={(e) => set('content', e.target.value)} {...field('content')} />
          <span className={`adm-char-count ${chars > CONTENT_SOFT_LIMIT ? 'over' : ''}`} aria-live="polite">
            {t('adm.pol.f.chars', { count: chars.toLocaleString(lang), max: CONTENT_SOFT_LIMIT.toLocaleString(lang) })}{chars > CONTENT_SOFT_LIMIT ? t('adm.pol.f.long') : ''}
          </span>
          {fieldError('content')}
        </label>
      </div>
      {error && <Banner tone="bad">{error}</Banner>}
      <div className="adm-form-actions">
        <button type="button" className="adm-btn adm-btn-ghost" onClick={onCancel}>{t('adm.cancel')}</button>
        <button type="submit" className="adm-btn adm-btn-primary" disabled={busy}>{busy ? t('adm.saving') : editing ? t('adm.pol.f.saveDraft') : t('adm.pol.f.createDraft')}</button>
      </div>
    </form>
  )
}

export default function PoliciesPage() {
  const { data, error, loading, reload, setData } = useAsync((signal) => listPolicies({ signal }), [])
  const [editing, setEditing] = useState(null) // null | {} (new) | policy
  const [publishing, setPublishing] = useState(false)
  const [notice, setNotice] = useState(null)
  const { t } = useI18n()

  const items = data?.items || []
  const drafts = items.filter((p) => p.status === 'draft')

  function onSaved(policy, wasEditing) {
    setData((d) => ({ ...d, items: wasEditing ? d.items.map((p) => (p.id === policy.id ? policy : p)) : [policy, ...(d?.items || [])] }))
    setEditing(null)
    setNotice({ tone: 'good', text: t('adm.pol.savedDraft', { title: policy.title }) })
  }

  async function publish(ids) {
    setPublishing(true)
    setNotice(null)
    try {
      const { data: result } = await publishPolicies(ids ? { ids } : {})
      setNotice({ tone: 'good', jobId: result.job_id })
      reload()
    } catch (err) {
      setNotice({ tone: 'bad', text: t('adm.pol.publishFailed', { message: err.message }) })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <>
      <PageHeader
        title={t('adm.pol.title')}
        description={t('adm.pol.intro')}
        actions={(
          <>
            <button type="button" className="adm-btn" onClick={() => setEditing({})}>{t('adm.pol.new')}</button>
            <button type="button" className="adm-btn adm-btn-primary" disabled={publishing || drafts.length === 0} onClick={() => publish()}>
              {publishing ? t('adm.pol.publishing') : `${t('adm.pol.publishAll')}${drafts.length ? ` (${drafts.length})` : ''}`}
            </button>
          </>
        )}
      />
      <Banner tone="warn">
        <strong>{t('adm.pol.experimental')}</strong> {t('adm.pol.experimentalText')}
      </Banner>
      {notice && (
        <Banner tone={notice.tone}>
          {notice.jobId ? <Link to={`/admin/jobs/${encodeURIComponent(notice.jobId)}`}>{t('adm.pol.published', { job: notice.jobId })}</Link> : notice.text}
        </Banner>
      )}
      {editing && (
        <Card title={editing.id ? t('adm.pol.editTitle', { title: editing.title }) : t('adm.pol.new')}>
          <PolicyForm key={editing.id || 'new'} initial={editing} onSaved={onSaved} onCancel={() => setEditing(null)} />
        </Card>
      )}
      <Card title={t('adm.pol.all')}>
        {loading && !data ? <TableSkeleton cols={6} /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : items.length === 0 ? (
          <EmptyState title={t('adm.pol.empty')} action={<button type="button" className="adm-btn" onClick={() => setEditing({})}>{t('adm.pol.createFirst')}</button>} />
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th scope="col">{t('adm.pol.titleCol')}</th><th scope="col">{t('adm.pol.section')}</th><th scope="col">{t('adm.type')}</th><th scope="col" className="num">{t('adm.pol.version')}</th><th scope="col">{t('adm.status')}</th><th scope="col">{t('adm.pol.updated')}</th><th scope="col"><span className="adm-sr-only">{t('adm.actions')}</span></th></tr></thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.title}</strong>
                      <div className="adm-muted adm-small adm-ellipsis">{p.content}</div>
                    </td>
                    <td><code>{p.section_id}</code></td>
                    <td>{p.policy_type}</td>
                    <td className="num">v{p.version}</td>
                    <td><Pill value={p.status} /></td>
                    <td className="nowrap">{formatDateTime(p.updated_at)}</td>
                    <td className="nowrap">
                      <button type="button" className="adm-btn adm-btn-small" onClick={() => setEditing(p.status === 'published' ? { ...p, version: p.version + 1 } : p)} aria-label={`${t('adm.pol.edit')}: ${p.title}`}>{t('adm.pol.edit')}</button>
                      {p.status === 'draft' && <button type="button" className="adm-btn adm-btn-small adm-btn-ghost" disabled={publishing} onClick={() => publish([p.id])} aria-label={`${t('adm.pol.publish')}: ${p.title}`}>{t('adm.pol.publish')}</button>}
                    </td>
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
