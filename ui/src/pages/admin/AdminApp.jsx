// Admin Console entry, lazy-loaded from App.jsx at /admin/*.
import { Route, Routes } from 'react-router'
import './admin.css'
import { AuthProvider, RequireAuth } from './auth/AuthContext.jsx'
import AdminLayout from './AdminLayout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import ConfigPage from './pages/ConfigPage.jsx'
import TracesPage from './pages/TracesPage.jsx'
import IndexesJobsPage from './pages/IndexesJobsPage.jsx'
import JobDetailPage from './pages/JobDetailPage.jsx'
import PoliciesPage from './pages/PoliciesPage.jsx'
import EvalPage from './pages/EvalPage.jsx'
import EvalRunPage from './pages/EvalRunPage.jsx'
import FeedbackPage from './pages/FeedbackPage.jsx'
import AnnotationPage from './pages/AnnotationPage.jsx'
import { EmptyState } from './components/ui.jsx'

export default function AdminApp() {
  return (
    <div className="adm-root">
      <AuthProvider>
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route element={<RequireAuth><AdminLayout /></RequireAuth>}>
            <Route index element={<DashboardPage />} />
            <Route path="config" element={<ConfigPage />} />
            <Route path="traces" element={<TracesPage />} />
            <Route path="indexes" element={<IndexesJobsPage />} />
            <Route path="jobs/:jobId" element={<JobDetailPage />} />
            <Route path="policies" element={<PoliciesPage />} />
            <Route path="eval" element={<EvalPage />} />
            <Route path="eval/:runId" element={<EvalRunPage />} />
            <Route path="feedback" element={<FeedbackPage />} />
            <Route path="annotate" element={<AnnotationPage />} />
            <Route path="*" element={<EmptyState title="Page not found" message="This admin page does not exist." />} />
          </Route>
        </Routes>
      </AuthProvider>
    </div>
  )
}
