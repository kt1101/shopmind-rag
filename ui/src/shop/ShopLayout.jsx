import { Link, Outlet, useLocation } from 'react-router'
import SiteHeader from './SiteHeader.jsx'
import { ImageSearchProvider } from './ImageSearchContext.jsx'
import { ChatProvider } from '../chat/ChatProvider.jsx'
import ChatWidget from '../chat/ChatWidget.jsx'
import CompareTray from '../features/compare/CompareTray.jsx'
import { useI18n } from '../shared/ui/I18nProvider.jsx'
import '../shared/ui/ui.css'
import './shop.css'

export default function ShopLayout() {
  const { t } = useI18n()
  const { pathname } = useLocation()
  return (
    <ImageSearchProvider>
      <ChatProvider>
        <div className="shop">
          <a href="#main" className="skip-link">{t('a11y.skip')}</a>
          <SiteHeader />
          <main id="main" tabIndex={-1}>
            <Outlet />
          </main>
          <footer className="site-footer">
            <Link to="/plan">{t('nav.plan')}</Link>
            <Link to="/admin">{t('nav.admin')}</Link>
            <span className="site-footer-note">{t('footer.note')}</span>
          </footer>
          {pathname !== '/compare' && <CompareTray />}
          <ChatWidget />
        </div>
      </ChatProvider>
    </ImageSearchProvider>
  )
}
