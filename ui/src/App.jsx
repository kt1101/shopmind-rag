import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import ShopLayout from './shop/ShopLayout.jsx'
import CatalogPage from './shop/CatalogPage.jsx'
import SearchPage from './shop/SearchPage.jsx'
import ProductPage from './shop/ProductPage.jsx'
import NotFoundPage from './shop/NotFoundPage.jsx'
import LabPage from './lab/LabPage.jsx'

const AdminApp = lazy(() => import('./pages/admin/AdminApp.jsx'))

export default function App() {
  return (
    <Routes>
      <Route path="/lab" element={<LabPage />} />
      <Route path="/admin/*" element={<Suspense fallback={<p role="status" style={{ padding: 24 }}>Loading admin…</p>}><AdminApp /></Suspense>} />
      <Route element={<ShopLayout />}>
        <Route path="/" element={<CatalogPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/products/:productId" element={<ProductPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
