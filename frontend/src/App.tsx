import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AccessGate } from './components/AccessGate'
import { AppLayout } from './components/AppLayout'
import { CategoriesPage } from './pages/CategoriesPage'
import { DashboardPage } from './pages/DashboardPage'
import { EngagementPage } from './pages/EngagementPage'
import { RunsPage } from './pages/RunsPage'
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
              <Route path="categories" element={<CategoriesPage />} />
              <Route path="runs" element={<RunsPage />} />
              <Route path="engagement" element={<EngagementPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </AccessGate>
  )
}
