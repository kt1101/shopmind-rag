import { Link, Outlet } from 'react-router'
import SiteHeader from './SiteHeader.jsx'
import { ImageSearchProvider } from './ImageSearchContext.jsx'
import './shop.css'

export default function ShopLayout() {
  return (
    <ImageSearchProvider>
      <div className="shop">
        <SiteHeader />
        <main>
          <Outlet />
        </main>
        <footer className="site-footer">
          <Link to="/lab">Retrieval Lab</Link>
        </footer>
      </div>
    </ImageSearchProvider>
  )
}
