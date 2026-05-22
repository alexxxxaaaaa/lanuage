import { useEffect, useState } from 'react'
import { CodeOutlined, MenuOutlined, SearchOutlined } from '@ant-design/icons'
import { Drawer, FloatButton, Modal, Select } from 'antd'
import {
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import './App.css'
import { useI18n } from './i18n'
import { fetchMe } from './api/auth'
import { QuickSearchFloat } from './components/QuickSearchFloat'
import { RequireAuth } from './components/RequireAuth'
import { SearchSuggest } from './components/SearchSuggest'
import { TabbedRoot } from './components/TabbedRoot'
import { useAuthStore } from './store/authStore'
import { useTabsStore } from './store/tabsStore'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'

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

  const navLinks = (
    <>
      <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/" end>
        {t('nav.home')}
      </NavLink>
      <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/folders">
        {t('nav.folders')}
      </NavLink>
      <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/notes">
        {t('nav.notes')}
      </NavLink>
      <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/expressions">
        {t('nav.expressions')}
      </NavLink>
      <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/grammar">
        {t('nav.grammar')}
      </NavLink>
      {user?.canSeePodcast ? (
        <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/podcasts">
          {t('nav.podcasts')}
        </NavLink>
      ) : null}
      <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/ai-usage">
        {t('nav.aiUsage')}
      </NavLink>
    </>
  )

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <p className="eyebrow">Word Sprint</p>
        </div>

        <nav className="nav">
          <form className="nav-search" onSubmit={handleGlobalSearch}>
            <SearchSuggest
              value={keyword}
              onChange={setKeyword}
              onSubmit={submitSearch}
              placeholder={t('nav.searchPlaceholder')}
            />
            <button type="submit" className="primary-button">
              {t('nav.search')}
            </button>
          </form>
          <button
            type="button"
            className="nav-search-icon"
            aria-label={t('nav.search')}
            onClick={() => navigate('/words/search')}
          >
            <SearchOutlined />
          </button>
          <label className="nav-language">
            <span className="nav-language-label">{t('nav.language')}</span>
            <Select
              className="nav-language-select"
              size="small"
              variant="borderless"
              popupMatchSelectWidth={false}
              value={language}
              onChange={(value) => setLanguage(value as 'zh' | 'en' | 'jp')}
              options={[
                { value: 'zh', label: t('nav.zh') },
                { value: 'en', label: t('nav.en') },
                { value: 'jp', label: t('nav.jp') },
              ]}
            />
          </label>
          {user ? (
            <div className="brand-user">
              <span className="brand-user-name">@{user.username}</span>
              <button type="button" className="brand-logout" onClick={handleLogout}>
                {t('nav.logout')}
              </button>
            </div>
          ) : null}
          <div className="nav-links-desktop">{navLinks}</div>
          <button
            type="button"
            className="nav-menu-toggle"
            aria-label={t('nav.openMenu')}
            onClick={() => setIsDrawerOpen(true)}
          >
            <MenuOutlined />
          </button>
        </nav>
      </header>

      <Drawer
        title={t('nav.drawerTitle')}
        placement="right"
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        width={260}
        className="nav-drawer"
      >
        <div className="nav-drawer-links">{navLinks}</div>
      </Drawer>

      <main className="page-content">
        <TabbedRoot />
      </main>
      <FloatButton
        icon={<CodeOutlined />}
        tooltip={t('nav.codeTooltip')}
        onClick={() => setIsCodeOpen(true)}
        className="hide-on-mobile-float"
        style={{ insetInlineStart: 24, bottom: 24 }}
      />
      <Modal
        title=""
        open={isCodeOpen}
        onCancel={() => setIsCodeOpen(false)}
        footer={null}
        className="full-screen-code-modal"
        width="100vw"
        style={{ top: 0, paddingBottom: 0, maxWidth: '100vw' }}
        styles={{
          body: { height: 'calc(100vh - 56px)', display: 'grid', gridTemplateRows: 'auto 1fr' },
        }}
      >
        <p className="muted">{t('nav.codeHotkey')}</p>
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
