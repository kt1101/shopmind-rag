import { Link, NavLink } from 'react-router'
import SearchBar from './SearchBar.jsx'
import { useI18n } from '../shared/ui/I18nProvider.jsx'
import { useShopLists } from '../features/shop-lists/ShopListsProvider.jsx'
import { buildCompareUrl } from '../features/shop-lists/shopLists.js'

function Counter({ value }) {
  return value > 0 ? <span className="header-counter" aria-hidden="true">{value}</span> : null
}

export default function SiteHeader() {
  const { t, lang, setLang } = useI18n()
  const { compare, wishlist, cartCount } = useShopLists()

  return (
    <header className="site-header">
      <Link to="/" className="brand" aria-label={t('nav.home')}>
        <strong>ShopMind</strong>
      </Link>
      <SearchBar />
      <nav className="header-nav" aria-label="ShopMind">
        <NavLink to="/lab/embeddings" className="header-link">{t('nav.map')}</NavLink>
        <NavLink to="/lab" className="header-link header-link--secondary">{t('nav.lab')}</NavLink>
        <Link to={buildCompareUrl(compare.map((item) => item.product_id))} className="header-icon-link" aria-label={`${t('nav.compare')} (${compare.length})`} title={t('nav.compare')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M16 3h5v5" /><path d="M21 3l-7 7" /><path d="M8 21H3v-5" /><path d="M3 21l7-7" />
          </svg>
          <Counter value={compare.length} />
        </Link>
        <Link to="/cart#wishlist" className="header-icon-link" aria-label={`${t('nav.wishlist')} (${wishlist.length})`} title={t('nav.wishlist')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
          </svg>
          <Counter value={wishlist.length} />
        </Link>
        <Link to="/cart" className="header-icon-link" aria-label={`${t('nav.cart')} (${cartCount})`} title={t('nav.cart')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
          </svg>
          <Counter value={cartCount} />
        </Link>
        <button
          type="button"
          className="header-lang"
          onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')}
          aria-label={`${t('nav.language')}: ${t('nav.switchTo')}`}
          title={t('nav.switchTo')}
        >
          {lang === 'vi' ? 'EN' : 'VI'}
        </button>
      </nav>
    </header>
  )
}
