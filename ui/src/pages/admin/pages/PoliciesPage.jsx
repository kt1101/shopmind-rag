import { useState } from 'react'
import { Link } from 'react-router'
import { createPolicy, listPolicies, publishPolicies, updatePolicy } from '../../../shared/api/admin.js'
import { useAsync } from '../lib/useAsync.js'
import { fieldErrorsFrom } from '../lib/configTree.js'
import { formatDateTime } from '../lib/format.js'
import { Banner, Card, EmptyState, ErrorState, PageHeader, Pill, TableSkeleton } from '../components/ui.jsx'

const POLICY_TYPES = ['returns', 'shipping', 'warranty', 'payment', 'privacy', 'other']
const CONTENT_SOFT_LIMIT = 2000
const EMPTY = { title: '', section_id: '', policy_type: 'returns', version: 1, content: '' }

function PolicyForm({ initial, onSaved, onCancel }) {
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
    if (!form.title.trim()) local.title = 'Title is required'
    if (!form.section_id.trim()) local.section_id = 'Section id is required'
    if (!form.content.trim()) local.content = 'Content is required'
    if (!(Number(form.version) >= 1) || !Number.isInteger(Number(form.version))) local.version = 'Version must be a positive integer'
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
          <span>Title</span>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} {...field('title')} />
          {fieldError('title')}
        </label>
        <label className="adm-field">
          <span>Section id</span>
          <input value={form.section_id} onChange={(e) => set('section_id', e.target.value)} placeholder="returns.window" {...field('section_id')} />
          {fieldError('section_id')}
        </label>
        <label className="adm-field">
          <span>Policy type</span>
          <select value={form.policy_type} onChange={(e) => set('policy_type', e.target.value)}>
            {[...new Set([...POLICY_TYPES, form.policy_type])].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span>Version</span>
          <input type="number" min={1} step={1} value={form.version} onChange={(e) => set('version', e.target.value)} {...field('version')} />
          {fieldError('version')}
        </label>
        <label className="adm-field adm-span-2">
          <span>Content</span>
          <textarea rows={8} value={form.content} onChange={(e) => set('content', e.target.value)} {...field('content')} />
          <span className={`adm-char-count ${chars > CONTENT_SOFT_LIMIT ? 'over' : ''}`} aria-live="polite">
            {chars.toLocaleString('en-US')} / {CONTENT_SOFT_LIMIT.toLocaleString('en-US')} characters{chars > CONTENT_SOFT_LIMIT ? ' (long sections are chunked when indexed)' : ''}
          </span>
          {fieldError('content')}
        </label>
      </div>
      {error && <Banner tone="bad">{error}</Banner>}
      <div className="adm-form-actions">
        <button type="button" className="adm-btn adm-btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="adm-btn adm-btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save draft' : 'Create draft'}</button>
      </div>
    </form>
  )
}

export default function PoliciesPage() {
  const { data, error, loading, reload, setData } = useAsync((signal) => listPolicies({ signal }), [])
  const [editing, setEditing] = useState(null) // null | {} (new) | policy
  const [publishing, setPublishing] = useState(false)
  const [notice, setNotice] = useState(null)

  const items = data?.items || []
  const drafts = items.filter((p) => p.status === 'draft')

  function onSaved(policy, wasEditing) {
    setData((d) => ({ ...d, items: wasEditing ? d.items.map((p) => (p.id === policy.id ? policy : p)) : [policy, ...(d?.items || [])] }))
    setEditing(null)
    setNotice({ tone: 'good', text: `Saved “${policy.title}” as draft. Publish to reindex.` })
  }

  async function publish(ids) {
    setPublishing(true)
    setNotice(null)
    try {
      const { data: result } = await publishPolicies(ids ? { ids } : {})
      setNotice({ tone: 'good', jobId: result.job_id })
      reload()
    } catch (err) {
      setNotice({ tone: 'bad', text: `Publish failed: ${err.message}` })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Policies"
        description="Store policies used as a RAG source. Publishing re-embeds them into a new policies index and switches the alias."
        actions={(
          <>
            <button type="button" className="adm-btn" onClick={() => setEditing({})}>New policy</button>
            <button type="button" className="adm-btn adm-btn-primary" disabled={publishing || drafts.length === 0} onClick={() => publish()}>
              {publishing ? 'Publishing…' : `Publish & reindex${drafts.length ? ` (${drafts.length})` : ''}`}
            </button>
          </>
        )}
      />
      <Banner tone="warn">
        <strong>Experimental:</strong> these policies are synthetic placeholders for the A3 experiments, not real store terms. Do not present answers based on them as measured quality.
      </Banner>
      {notice && (
        <Banner tone={notice.tone}>
          {notice.jobId ? <>Published. Reindex job <Link to={`/admin/jobs/${encodeURIComponent(notice.jobId)}`}><code>{notice.jobId}</code></Link> started.</> : notice.text}
        </Banner>
      )}
      {editing && (
        <Card title={editing.id ? `Edit “${editing.title}”` : 'New policy'}>
          <PolicyForm key={editing.id || 'new'} initial={editing} onSaved={onSaved} onCancel={() => setEditing(null)} />
        </Card>
      )}
      <Card title="All policies">
        {loading && !data ? <TableSkeleton cols={6} /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : items.length === 0 ? (
          <EmptyState title="No policies yet" action={<button type="button" className="adm-btn" onClick={() => setEditing({})}>Create the first one</button>} />
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th scope="col">Title</th><th scope="col">Section</th><th scope="col">Type</th><th scope="col" className="num">Version</th><th scope="col">Status</th><th scope="col">Updated</th><th scope="col"><span className="adm-sr-only">Actions</span></th></tr></thead>
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
                      <button type="button" className="adm-btn adm-btn-small" onClick={() => setEditing(p.status === 'published' ? { ...p, version: p.version + 1 } : p)}>Edit</button>
                      {p.status === 'draft' && <button type="button" className="adm-btn adm-btn-small adm-btn-ghost" disabled={publishing} onClick={() => publish([p.id])}>Publish</button>}
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
