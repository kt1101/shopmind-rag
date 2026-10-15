import { Link, Outlet } from 'react-router'
import './shop.css'

export default function ShopLayout() {
  return (
    <div className="shop">
      <header className="site-header">
        <Link to="/" className="brand">
          <strong>ShopMind</strong>
        </Link>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="site-footer">
        <Link to="/lab">Retrieval Lab</Link>
      </footer>
    </div>
  )
}
