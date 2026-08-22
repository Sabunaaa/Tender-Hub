import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AccessGate } from './components/AccessGate'
import { AppLayout } from './components/AppLayout'
import { CategoriesPage } from './pages/CategoriesPage'
import { DashboardPage } from './pages/DashboardPage'
import { EngagementPage } from './pages/EngagementPage'
import { EngagementSettingsPage } from './pages/EngagementSettingsPage'
import { RunsPage } from './pages/RunsPage'
import { SettingsLayout } from './pages/SettingsLayout'
import { SettingsPage } from './pages/SettingsPage'
import { TenderDetailPage } from './pages/TenderDetailPage'
import { TendersPage } from './pages/TendersPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <AccessGate>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="tenders" element={<TendersPage />} />
              <Route path="tenders/:id" element={<TenderDetailPage />} />
              <Route path="engagement" element={<EngagementPage />} />
              <Route path="settings" element={<SettingsLayout />}>
                <Route index element={<SettingsPage />} />
                <Route path="categories" element={<CategoriesPage />} />
                <Route path="scraper" element={<RunsPage />} />
                <Route path="engagement" element={<EngagementSettingsPage />} />
                <Route path="runs" element={<Navigate to="/settings/scraper" replace />} />
              </Route>
              <Route path="categories" element={<Navigate to="/settings/categories" replace />} />
              <Route path="runs" element={<Navigate to="/settings/scraper" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </AccessGate>
  )
}
