import { useEffect } from 'react'
import { Route, Routes } from 'react-router'

import { RequireAuth } from './components/RequireAuth'
import { DashboardShell } from './components/layout/DashboardShell'
import { LoginPage } from './pages/LoginPage'
import { useAuthStore } from './store/authStore'
import { primeSpeechOnFirstGesture } from './utils/speech'

/**
 * Two shells, one switch: the auth shell at /login, the dashboard shell for
 * everything else. Route-to-page resolution lives in `lib/routes` and is
 * consumed by `KeepAliveOutlet` inside the dashboard shell — there is no
 * second route table here to keep in sync.
 */
function App() {
  // Unlock speechSynthesis on the user's very first click/keypress anywhere.
  // Without a consumed gesture, Chrome's autoplay policy silently drops the
  // auto-speak when the review page mounts.
  useEffect(() => primeSpeechOnFirstGesture(), [])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AuthedShell />
          </RequireAuth>
        }
      />
    </Routes>
  )
}

function AuthedShell() {
  const user = useAuthStore((s) => s.user)
  // RequireAuth guarantees a token, but the cached user object can still be
  // absent on a first load from an older session — render a stub until
  // useSessionSync fills it in from /me.
  return <DashboardShell user={user ?? { id: '', username: '' }} />
}

export default App
