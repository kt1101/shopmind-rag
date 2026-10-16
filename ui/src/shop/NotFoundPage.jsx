import { Link } from 'react-router'

export default function NotFoundPage() {
  return (
    <div className="not-found-page">
      <h1>Page not found</h1>
      <p>The page you are looking for does not exist.</p>
      <Link to="/">Return to catalog</Link>
    </div>
  )
}
