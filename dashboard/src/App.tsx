import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuthStore } from '@/store/auth'
import { getToken } from '@/lib/http'
import LoginPage from '@/pages/Login'
import AdminLayout from '@/layouts/AdminLayout'
import DashboardPage from '@/pages/Dashboard'
import UsersPage from '@/pages/Users'
import UserDetailPage from '@/pages/UserDetail'
import FoldersPage from '@/pages/Folders'
import WordsPage from '@/pages/Words'
import NotesPage from '@/pages/Notes'
import ExpressionsPage from '@/pages/Expressions'
import AiUsagePage from '@/pages/AiUsage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const ready = useAuthStore((s) => s.ready)
  const user = useAuthStore((s) => s.user)
  if (!ready) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Spin size="large" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap)

  useEffect(() => {
    if (getToken()) {
      bootstrap()
    } else {
      // 没 token 直接 ready=true（会跳登录页）
      useAuthStore.setState({ ready: true })
    }
  }, [bootstrap])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="users/:id" element={<UserDetailPage />} />
        <Route path="folders" element={<FoldersPage />} />
        <Route path="words" element={<WordsPage />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="expressions" element={<ExpressionsPage />} />
        <Route path="ai-usage" element={<AiUsagePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
