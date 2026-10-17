import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from './auth/AuthContext.jsx'
import { USE_MOCK_API } from '../../shared/api/http.js'
import { getTrace } from '../../shared/api/admin.js'
import InspectorHost from '../../widgets/inspector/InspectorHost.jsx'
import { useI18n } from '../../shared/ui/I18nProvider.jsx'

const OPERATE = 'adm.nav.operate'
const GLASS_BOX = 'adm.nav.glass'

// Engineering tools (traces, playground, embedding map) live here, never on the storefront.
// Labels and group titles are i18n keys.
export const NAV = [
  { to: '/admin', label: 'adm.nav.dashboard', end: true, group: OPERATE },
  { to: '/admin/config', label: 'adm.nav.config', group: OPERATE },
  { to: '/admin/indexes', label: 'adm.nav.indexes', group: OPERATE },
  { to: '/admin/policies', label: 'adm.nav.policies', group: OPERATE },
  { to: '/admin/feedback', label: 'adm.nav.feedback', group: OPERATE },
  { to: '/admin/traces', label: 'adm.nav.traces', group: GLASS_BOX },
  { to: '/admin/playground', label: 'adm.nav.playground', group: GLASS_BOX },
  { to: '/admin/embedding-map', label: 'adm.nav.map', group: GLASS_BOX },
  { to: '/admin/eval', label: 'adm.nav.eval', group: GLASS_BOX },
  { to: '/admin/annotate', label: 'adm.nav.annotate', group: GLASS_BOX },
]

export const NAV_GROUPS = [...new Set(NAV.map((item) => item.group))].map((title) => ({ title, items: NAV.filter((item) => item.group === title) }))

const SECTION_LABELS = Object.fromEntries(NAV.filter((n) => n.to !== '/admin').map((n) => [n.to.split('/')[2], n]))
SECTION_LABELS.jobs = { to: '/admin/indexes', label: 'adm.nav.indexes' }

// `t` translates the label keys; the last segment (a job or run id) is shown as is.
export function breadcrumbsFor(pathname, t = (key) => key) {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean).slice(1)
  const crumbs = [{ to: '/admin', label: t('adm.crumb.root') }]
  if (parts.length === 0) return [...crumbs, { label: t('adm.nav.dashboard') }]
  const section = SECTION_LABELS[parts[0]]
  if (section) crumbs.push({ to: section.to, label: t(section.label) })
  if (parts[1]) crumbs.push({ label: decodeURIComponent(parts[1]) })
  crumbs[crumbs.length - 1] = { label: crumbs[crumbs.length - 1].label }
  return crumbs
}

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(false)
  const { t, lang, setLang } = useI18n()
  const crumbs = breadcrumbsFor(location.pathname, t)

  useEffect(() => setNavOpen(false), [location.pathname])

  function onLogout() {
    logout()
    navigate('/admin/login', { replace: true })
  }

  return (
    <div className={`adm-shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="adm-sidebar" aria-label={t('adm.nav.label')}>
        <Link to="/admin" className="adm-brand">ShopMind <span>{t('adm.brand')}</span></Link>
        <nav>
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="adm-nav-group" role="group" aria-labelledby={`adm-nav-${group.title.replace(/\W+/g, '-')}`}>
              <p className="adm-nav-group-title" id={`adm-nav-${group.title.replace(/\W+/g, '-')}`}>{t(group.title)}</p>
              <ul>
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                      {t(item.label)}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="adm-sidebar-foot">
          <Link to="/">{t('adm.nav.storefront')}</Link>
        </div>
      </aside>
      <button type="button" className="adm-scrim" aria-label={t('adm.nav.close')} tabIndex={navOpen ? 0 : -1} onClick={() => setNavOpen(false)} />
      <div className="adm-main">
        <header className="adm-topbar">
          <button type="button" className="adm-btn adm-btn-ghost adm-nav-toggle" aria-expanded={navOpen} onClick={() => setNavOpen((o) => !o)}>
            ☰ <span className="adm-sr-only">{t('adm.nav.toggle')}</span>
          </button>
          <nav aria-label={t('adm.crumbs')} className="adm-breadcrumbs">
            <ol>
              {crumbs.map((c, i) => (
                <li key={i}>{c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>
              ))}
            </ol>
          </nav>
          <div className="adm-user">
            {USE_MOCK_API && <span className="adm-pill adm-pill-warn" title={t('adm.mockHint')}>{t('adm.mock')}</span>}
            <span className="adm-user-name">{user?.username}<small>{user?.role}</small></span>
            <button
              type="button"
              className="adm-btn adm-btn-ghost adm-lang"
              onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')}
              aria-label={`${t('nav.language')}: ${t('nav.switchTo')}`}
              title={t('nav.switchTo')}
            >
              {lang === 'vi' ? 'EN' : 'VI'}
            </button>
            <button type="button" className="adm-btn adm-btn-ghost" onClick={onLogout}>{t('adm.logout')}</button>
          </div>
        </header>
        <main className="adm-content" id="admin-main">
          <Outlet />
        </main>
      </div>
      <InspectorHost loadTrace={getTrace} />
    </div>
  )
}
