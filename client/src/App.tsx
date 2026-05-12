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
import { QuickSearchFloat } from './components/QuickSearchFloat'
import { RequireAuth } from './components/RequireAuth'
import { useAuthStore } from './store/authStore'
import { AiUsagePage } from './pages/AiUsagePage'
import { AddWordPage } from './pages/AddWordPage'
import { ExpressionFolderDetailPage } from './pages/ExpressionFolderDetailPage'
import { ExpressionsPage } from './pages/ExpressionsPage'
import { FolderDetailPage } from './pages/FolderDetailPage'
import { FoldersPage } from './pages/FoldersPage'
import { HomePage } from './pages/HomePage'
import { LearnPage } from './pages/LearnPage'
import { LoginPage } from './pages/LoginPage'
import { NoteDetailPage } from './pages/NoteDetailPage'
import { NotesPage } from './pages/NotesPage'
import { RegisterPage } from './pages/RegisterPage'
import { ReviewPage } from './pages/ReviewPage'
import { WordSearchPage } from './pages/WordSearchPage'

function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { language, setLanguage, t } = useI18n()
  const user = useAuthStore((state) => state.user)
  const clearSession = useAuthStore((state) => state.clearSession)
  const [keyword, setKeyword] = useState('')
  const [isCodeOpen, setIsCodeOpen] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  useEffect(() => {
    if (!location.pathname.startsWith('/words/search')) return
    const params = new URLSearchParams(location.search)
    setKeyword(params.get('q') ?? '')
  }, [location.pathname, location.search])

  const handleGlobalSearch = (event: React.FormEvent) => {
    event.preventDefault()
    const q = keyword.trim()
    if (!q) {
      navigate('/words/search')
      return
    }
    navigate(`/words/search?q=${encodeURIComponent(q)}`)
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
    navigate('/login', { replace: true })
  }

  // Close drawer when route changes
  useEffect(() => {
    setIsDrawerOpen(false)
  }, [location.pathname])

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
            <input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
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
                退出
              </button>
            </div>
          ) : null}
          <div className="nav-links-desktop">{navLinks}</div>
          <button
            type="button"
            className="nav-menu-toggle"
            aria-label="打开导航菜单"
            onClick={() => setIsDrawerOpen(true)}
          >
            <MenuOutlined />
          </button>
        </nav>
      </header>

      <Drawer
        title="导航"
        placement="right"
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        width={260}
        className="nav-drawer"
      >
        <div className="nav-drawer-links">{navLinks}</div>
      </Drawer>

      <main className="page-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/folders" element={<FoldersPage />} />
          <Route path="/folders/:id" element={<FolderDetailPage />} />
          <Route path="/words/new" element={<AddWordPage />} />
          <Route path="/words/search" element={<WordSearchPage />} />
          <Route path="/learn" element={<LearnPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/ai-usage" element={<AiUsagePage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/notes/:id" element={<NoteDetailPage />} />
          <Route path="/expressions" element={<ExpressionsPage />} />
          <Route path="/expressions/folders/:id" element={<ExpressionFolderDetailPage />} />
        </Routes>
      </main>
      <FloatButton
        icon={<CodeOutlined />}
        tooltip="代码页 (Z 切换)"
        onClick={() => setIsCodeOpen(true)}
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
        <p className="muted">快捷键：Z（可来回切换）</p>
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
