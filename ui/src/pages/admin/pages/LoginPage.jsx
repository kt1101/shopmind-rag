import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../auth/AuthContext.jsx'
import { USE_MOCK_API } from '../../../shared/api/http.js'
import { useI18n } from '../../../shared/ui/I18nProvider.jsx'

function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/admin') && !next.startsWith('/admin/login') ? next : '/admin'
}

export default function LoginPage() {
  const { login, isAuthenticated, notice } = useAuth()
  const { t } = useI18n()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const next = safeNext(params.get('next'))

  if (isAuthenticated && !busy) return <Navigate to={next} replace />

  async function onSubmit(event) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login({ username: username.trim(), password })
      navigate(next, { replace: true })
    } catch (err) {
      setError(err.status === 401 ? t('adm.login.invalid') : err.message || t('adm.login.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="adm-login">
      <form className="adm-card adm-login-card" onSubmit={onSubmit} noValidate>
        <h1>{t('adm.login.title')}</h1>
        <p className="adm-muted">{t('adm.login.intro')}</p>
        {notice && <div className="adm-banner adm-banner-warn" role="status">{t(notice)}</div>}
        {error && <div className="adm-banner adm-banner-bad" role="alert">{error}</div>}
        <label className="adm-field">
          <span>{t('adm.login.user')}</span>
          <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </label>
        <label className="adm-field">
          <span>{t('adm.login.password')}</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button type="submit" className="adm-btn adm-btn-primary" disabled={busy || !username.trim() || !password}>
          {busy ? t('adm.login.busy') : t('adm.login.submit')}
        </button>
        {USE_MOCK_API && <p className="adm-muted adm-small">{t('adm.login.mock', { a: 'admin / admin', b: 'annotator / annotator' })}</p>}
      </form>
    </div>
  )
}
