import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from './auth/AuthContext.jsx'
import { USE_MOCK_API } from '../../shared/api/http.js'
import { getTrace } from '../../shared/api/admin.js'
import InspectorHost from '../../widgets/inspector/InspectorHost.jsx'

const OPERATE = 'Operate'
const GLASS_BOX = 'Glass-box & lab'

// Engineering tools (traces, playground, embedding map) live here, never on the storefront.
export const NAV = [
  { to: '/admin', label: 'Dashboard', end: true, group: OPERATE },
  { to: '/admin/config', label: 'Pipeline & Config', group: OPERATE },
  { to: '/admin/indexes', label: 'Indexes & Jobs', group: OPERATE },
  { to: '/admin/policies', label: 'Policies', group: OPERATE },
  { to: '/admin/feedback', label: 'Feedback', group: OPERATE },
  { to: '/admin/traces', label: 'Traces', group: GLASS_BOX },
  { to: '/admin/playground', label: 'Search Playground', group: GLASS_BOX },
  { to: '/admin/embedding-map', label: 'Embedding Map', group: GLASS_BOX },
  { to: '/admin/eval', label: 'Evaluation', group: GLASS_BOX },
  { to: '/admin/annotate', label: 'Annotation', group: GLASS_BOX },
]

export const NAV_GROUPS = [...new Set(NAV.map((item) => item.group))].map((title) => ({ title, items: NAV.filter((item) => item.group === title) }))

const SECTION_LABELS = Object.fromEntries(NAV.filter((n) => n.to !== '/admin').map((n) => [n.to.split('/')[2], n]))
SECTION_LABELS.jobs = { to: '/admin/indexes', label: 'Indexes & Jobs' }

export function breadcrumbsFor(pathname) {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean).slice(1)
  const crumbs = [{ to: '/admin', label: 'Admin' }]
  if (parts.length === 0) return [...crumbs, { label: 'Dashboard' }]
  const section = SECTION_LABELS[parts[0]]
  if (section) crumbs.push({ to: section.to, label: section.label })
  if (parts[1]) crumbs.push({ label: decodeURIComponent(parts[1]) })
  crumbs[crumbs.length - 1] = { label: crumbs[crumbs.length - 1].label }
  return crumbs
}

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(false)
  const crumbs = breadcrumbsFor(location.pathname)

  useEffect(() => setNavOpen(false), [location.pathname])

  function onLogout() {
    logout()
    navigate('/admin/login', { replace: true })
  }

  return (
    <div className={`adm-shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="adm-sidebar" aria-label="Admin navigation">
        <Link to="/admin" className="adm-brand">ShopMind <span>Admin</span></Link>
        <nav>
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="adm-nav-group" role="group" aria-labelledby={`adm-nav-${group.title.replace(/\W+/g, '-')}`}>
              <p className="adm-nav-group-title" id={`adm-nav-${group.title.replace(/\W+/g, '-')}`}>{group.title}</p>
              <ul>
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="adm-sidebar-foot">
          <Link to="/">← Storefront</Link>
        </div>
      </aside>
      <button type="button" className="adm-scrim" aria-label="Close navigation" tabIndex={navOpen ? 0 : -1} onClick={() => setNavOpen(false)} />
      <div className="adm-main">
        <header className="adm-topbar">
          <button type="button" className="adm-btn adm-btn-ghost adm-nav-toggle" aria-expanded={navOpen} onClick={() => setNavOpen((o) => !o)}>
            ☰ <span className="adm-sr-only">Toggle navigation</span>
          </button>
          <nav aria-label="Breadcrumb" className="adm-breadcrumbs">
            <ol>
              {crumbs.map((c, i) => (
                <li key={i}>{c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>
              ))}
            </ol>
          </nav>
          <div className="adm-user">
            {USE_MOCK_API && <span className="adm-pill adm-pill-warn" title="VITE_MOCK_API=1: data is synthetic">Mock API</span>}
            <span className="adm-user-name">{user?.username}<small>{user?.role}</small></span>
            <button type="button" className="adm-btn adm-btn-ghost" onClick={onLogout}>Log out</button>
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
