import { useEffect, useState } from 'react'
import { SelectField } from './components/ui/SelectField'
import { Code, Menu } from 'lucide-react'
import { Button, Drawer } from '@heroui/react'
import { FloatButton } from './components/ui/FloatButton'
import { Modal } from './components/ui/Modal'
import {
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router'
import { useI18n } from './i18n'
import { fetchMe } from './api/auth'
import { QuickSearchFloat } from './components/QuickSearchFloat'
import { RequireAuth } from './components/RequireAuth'
import { SearchSuggest } from './components/SearchSuggest'
import { BackstageNote } from './components/BackstageNote'
import { TabbedRoot } from './components/TabbedRoot'
import { useAppStore } from './store/useAppStore'
import { useAuthStore } from './store/authStore'
import { useTabsStore } from './store/tabsStore'
import { primeSpeechOnFirstGesture } from './utils/speech'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'

// The PWA safe-area @supports block always applied (it sat after the
// breakpoints in source order), so the desktop 24px/64px padding never
// actually took effect. Kept as-is rather than silently changing the layout.
const APP_SHELL =
  'mx-auto box-border w-[min(1040px,100%)] pt-12 pl-[max(12px,env(safe-area-inset-left))] pr-[max(12px,env(safe-area-inset-right))] pb-[max(32px,env(safe-area-inset-bottom))] max-md:pt-4'

// Circular icon button in the nav bar; only shown once the desktop link row
// collapses.
const NAV_ICON_BUTTON =
  'hidden size-10 items-center justify-center rounded-full border border-border bg-surface p-0 text-lg text-foreground max-md:inline-flex max-[480px]:size-9'

// The same link list renders in the top bar and inside the drawer, so the
// styling is picked per placement rather than inherited from an ancestor.
const NAV_LINK: Record<'bar' | 'drawer', (isActive: boolean) => string> = {
  bar: (isActive) =>
    `rounded-full border px-3.5 py-2.5 no-underline max-md:px-3 max-md:py-2 max-md:text-[13px] max-[480px]:px-2.5 max-[480px]:py-1.5 max-[480px]:text-xs ${
      isActive
        ? 'border-accent bg-accent text-white'
        : 'border-border bg-surface text-foreground'
    }`,
  drawer: (isActive) =>
    `rounded-[10px] border px-3.5 py-3 text-[15px] no-underline ${
      isActive
        ? 'border-accent bg-accent text-white'
        : 'border-transparent bg-transparent text-foreground hover:border-border hover:bg-accent/6'
    }`,
}

function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { language, setLanguage, t } = useI18n()
  const user = useAuthStore((state) => state.user)
  const token = useAuthStore((state) => state.token)
  const setUser = useAuthStore((state) => state.setUser)
  const clearSession = useAuthStore((state) => state.clearSession)
  const [keyword, setKeyword] = useState('')
  const [isCodeOpen, setIsCodeOpen] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const handleGlobalSearch = (event: React.FormEvent) => {
    event.preventDefault()
    submitSearch(keyword)
  }

  const submitSearch = (text: string) => {
    const q = text.trim()
    if (!q) {
      navigate('/words/search')
      return
    }
    navigate(`/words/search?q=${encodeURIComponent(q)}`)
    // Clear the nav input after dispatching — the search page has its own
    // input that holds the active query, so the nav box is just a compose
    // box and should reset for the next search.
    setKeyword('')
  }

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      ) {
        return
      }
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault()
        setIsCodeOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [])

  // Unlock speechSynthesis on the user's very first click/keypress anywhere,
  // otherwise Chrome's autoplay policy silently drops the auto-speak when the
  // review page mounts before any gesture has been consumed.
  useEffect(() => primeSpeechOnFirstGesture(), [])

  // Daily auto-refresh of today's review queue. With keep-alive tabs the page
  // stays mounted across days, so the cached todayReviews can be 24h stale
  // when the user returns the next morning. We refetch on multiple signals
  // because no single one catches every "user came back" scenario:
  //   - visibilitychange: switching tabs / minimize-restore
  //   - focus: window regains focus (laptop wake without tab switch)
  //   - pageshow: page restored from BFCache (hit Back after navigating away)
  //   - online: network reconnects (typical after sleep)
  //   - minute-by-minute setInterval: catches midnight while tab is foreground
  useEffect(() => {
    if (!token) return // logged out — nothing to refresh
    const localDate = () => {
      const d = new Date()
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    }
    let lastDate = localDate()
    const refreshIfRolled = () => {
      const today = localDate()
      if (today !== lastDate) {
        lastDate = today
        void useAppStore.getState().fetchTodayReviews()
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshIfRolled()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refreshIfRolled)
    window.addEventListener('pageshow', refreshIfRolled)
    window.addEventListener('online', refreshIfRolled)
    const tick = window.setInterval(refreshIfRolled, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refreshIfRolled)
      window.removeEventListener('pageshow', refreshIfRolled)
      window.removeEventListener('online', refreshIfRolled)
      window.clearInterval(tick)
    }
  }, [token])

  const handleLogout = () => {
    clearSession()
    useTabsStore.getState().closeAll()
    navigate('/login', { replace: true })
  }

  // Close drawer when route changes
  useEffect(() => {
    setIsDrawerOpen(false)
  }, [location.pathname])

  // 每次启动都拉一次 /me，保证权限（canSeePodcast 等）跟服务端同步
  useEffect(() => {
    if (!token) return
    fetchMe()
      .then((fresh) => setUser(fresh))
      .catch(() => {})
  }, [token, setUser])

  const renderNavLinks = (place: 'bar' | 'drawer') => (
    <>
      <NavLink className={({ isActive }) => NAV_LINK[place](isActive)} to="/" end>
        {t('nav.home')}
      </NavLink>
      <NavLink className={({ isActive }) => NAV_LINK[place](isActive)} to="/folders">
        {t('nav.folders')}
      </NavLink>
      <NavLink className={({ isActive }) => NAV_LINK[place](isActive)} to="/notes">
        {t('nav.notes')}
      </NavLink>
      <NavLink className={({ isActive }) => NAV_LINK[place](isActive)} to="/expressions">
        {t('nav.expressions')}
      </NavLink>
      <NavLink className={({ isActive }) => NAV_LINK[place](isActive)} to="/grammar">
        {t('nav.grammar')}
      </NavLink>
      <NavLink className={({ isActive }) => NAV_LINK[place](isActive)} to="/exams">
        真题
      </NavLink>
      <NavLink className={({ isActive }) => NAV_LINK[place](isActive)} to="/reading">
        精读
      </NavLink>
      <NavLink className={({ isActive }) => NAV_LINK[place](isActive)} to="/jlpt">
        JLPT精练
      </NavLink>
      {user?.canSeePodcast ? (
        <NavLink className={({ isActive }) => NAV_LINK[place](isActive)} to="/podcasts">
          {t('nav.podcasts')}
        </NavLink>
      ) : null}
      <NavLink className={({ isActive }) => NAV_LINK[place](isActive)} to="/ai-usage">
        {t('nav.aiUsage')}
      </NavLink>
    </>
  )

  return (
    <div className={APP_SHELL}>
      <header className="mb-8 flex items-start justify-between gap-6 max-md:mb-5 max-md:flex-nowrap max-md:items-center max-md:gap-2">
        <div className="flex min-w-0 flex-col gap-2 max-md:flex-1 max-md:gap-1">
          <p className="eyebrow max-md:m-0 max-md:truncate max-md:text-[13px]">Word Sprint</p>
        </div>

        <nav className="flex flex-wrap items-center gap-3 max-md:w-auto max-md:flex-nowrap max-md:justify-end max-md:gap-2">
          <form
            className="mr-2 inline-flex items-center gap-2 max-md:hidden"
            onSubmit={handleGlobalSearch}
          >
            <SearchSuggest
              className="w-[280px] max-w-[46vw] flex-none"
              inputClassName="rounded-full border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none"
              placeholder={t('nav.searchPlaceholder')}
              value={keyword}
              onChange={setKeyword}
              onSubmit={submitSearch}
            />
            <Button type="submit">
              {t('nav.search')}
            </Button>
          </form>
          <label className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-foreground max-md:px-1.5 max-md:py-1">
            <span className="max-md:hidden">{t('nav.language')}</span>
            <SelectField
              className="min-w-[92px] max-md:min-w-16 max-[480px]:min-w-14"
              options={[
                { value: 'zh', label: t('nav.zh') },
                { value: 'en', label: t('nav.en') },
                { value: 'jp', label: t('nav.jp') },
              ]}
              value={language}
              onChange={(value) => setLanguage(value as 'zh' | 'en' | 'jp')}
            />
          </label>
          {user ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1.5 pr-1 pl-3 text-xs text-muted max-md:py-1 max-md:pl-2.5 max-[480px]:gap-1.5 max-[480px]:py-[3px] max-[480px]:pr-[3px] max-[480px]:pl-2">
              <span className="max-w-[90px] truncate font-semibold text-foreground max-md:max-w-14 max-[480px]:max-w-11">@{user.username}</span>
              <button type="button" className="min-h-[26px] cursor-pointer rounded-full border-none bg-accent/8 px-2.5 py-0.5 text-xs font-semibold text-accent hover:bg-accent/16 max-[480px]:min-h-6 max-[480px]:px-2 max-[480px]:text-[11px]" onClick={handleLogout}>
                {t('nav.logout')}
              </button>
            </div>
          ) : null}
          <div className="contents max-md:hidden">{renderNavLinks('bar')}</div>
          <Button
            type="button"
            className={NAV_ICON_BUTTON}
            aria-label={t('nav.openMenu')}
            onPress={() => setIsDrawerOpen(true)}
          >
            <Menu />
          </Button>
        </nav>
      </header>

      <Drawer.Backdrop isOpen={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="w-[260px]">
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading>{t('nav.drawerTitle')}</Drawer.Heading>
            </Drawer.Header>
            <Drawer.Body>
              <div className="flex flex-col gap-2">{renderNavLinks('drawer')}</div>
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>

      <main className="page-content">
        <TabbedRoot />
      </main>
      <FloatButton
        className="max-md:hidden"
        icon={<Code className="size-5" />}
        side="left"
        tooltip={t('nav.codeTooltip')}
        onPress={() => setIsCodeOpen(true)}
      />
      <Modal
        isOpen={isCodeOpen}
        size="full"
        onClose={() => setIsCodeOpen(false)}
      >
        <BackstageNote />
      </Modal>
      {location.pathname !== '/words/new' ? <QuickSearchFloat /> : null}
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      />
    </Routes>
  )
}

export default App
