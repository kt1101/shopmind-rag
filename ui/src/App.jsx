import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import ShopLayout from './shop/ShopLayout.jsx'
import CatalogPage from './shop/CatalogPage.jsx'
import SearchPage from './shop/SearchPage.jsx'
import ProductPage from './shop/ProductPage.jsx'
import NotFoundPage from './shop/NotFoundPage.jsx'
import { I18nProvider } from './shared/ui/I18nProvider.jsx'
import { ToastProvider } from './shared/ui/Toast.jsx'
import { ShopListsProvider } from './features/shop-lists/ShopListsProvider.jsx'

const AdminApp = lazy(() => import('./pages/admin/AdminApp.jsx'))
const ComparePage = lazy(() => import('./pages/compare/ComparePage.jsx'))
const CartPage = lazy(() => import('./pages/cart/CartPage.jsx'))

// Old engineering URLs now live in the admin console (query string kept).
function Moved({ to }) {
  const { search } = useLocation()
  return <Navigate to={`${to}${search}`} replace />
}

function Lazy({ children }) {
  return <Suspense fallback={<p role="status" style={{ padding: 24 }}>…</p>}>{children}</Suspense>
}

export default function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <ShopListsProvider>
          <Routes>
            <Route path="/lab" element={<Moved to="/admin/playground" />} />
            <Route path="/lab/embeddings" element={<Moved to="/admin/embedding-map" />} />
            <Route path="/admin/*" element={<Suspense fallback={<p role="status" style={{ padding: 24 }}>Loading admin…</p>}><AdminApp /></Suspense>} />
            <Route element={<ShopLayout />}>
              <Route path="/" element={<CatalogPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/products/:productId" element={<ProductPage />} />
              <Route path="/compare" element={<Lazy><ComparePage /></Lazy>} />
              <Route path="/cart" element={<Lazy><CartPage /></Lazy>} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </ShopListsProvider>
      </ToastProvider>
    </I18nProvider>
  )
}
