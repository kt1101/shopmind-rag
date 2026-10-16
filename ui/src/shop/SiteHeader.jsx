import { Link } from 'react-router'
import SearchBar from './SearchBar.jsx'

export default function SiteHeader() {
  return (
    <header className="site-header">
      <Link to="/" className="brand" aria-label="ShopMind home">
        <strong>ShopMind</strong>
      </Link>
      <SearchBar />
    </header>
  )
}
