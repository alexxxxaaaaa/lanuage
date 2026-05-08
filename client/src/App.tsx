import { useEffect, useState } from 'react'
import { CodeOutlined } from '@ant-design/icons'
import { FloatButton, Modal, Select } from 'antd'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import './App.css'
import { useI18n } from './i18n'
import { QuickAddWordFloat } from './components/QuickAddWordFloat'
import { AiUsagePage } from './pages/AiUsagePage'
import { AddWordPage } from './pages/AddWordPage'
import { ExpressionFolderDetailPage } from './pages/ExpressionFolderDetailPage'
import { ExpressionsPage } from './pages/ExpressionsPage'
import { FolderDetailPage } from './pages/FolderDetailPage'
import { FoldersPage } from './pages/FoldersPage'
import { HomePage } from './pages/HomePage'
import { LearnPage } from './pages/LearnPage'
import { NoteDetailPage } from './pages/NoteDetailPage'
import { NotesPage } from './pages/NotesPage'
import { ReviewPage } from './pages/ReviewPage'
import { WordSearchPage } from './pages/WordSearchPage'

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const { language, setLanguage, t } = useI18n()
  const [keyword, setKeyword] = useState('')
  const [isCodeOpen, setIsCodeOpen] = useState(false)

  const demoCode = `
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
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
          <label className="nav-language">
            <span>{t('nav.language')}</span>
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
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/" end>
            {t('nav.home')}
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/folders">
            {t('nav.folders')}
          </NavLink>
          {/* <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/words/new">
            添加单词
          </NavLink> */}
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/notes">
            {t('nav.notes')}
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/expressions">
            {t('nav.expressions')}
          </NavLink>
          {/* <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/review">
            复习
          </NavLink> */}
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/ai-usage">
            {t('nav.aiUsage')}
          </NavLink>
  `

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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
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
          <label className="nav-language">
            <span>{t('nav.language')}</span>
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
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/" end>
            {t('nav.home')}
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/folders">
            {t('nav.folders')}
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/learn">
            {t('nav.learn')}
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/review">
            {t('nav.review')}
          </NavLink>
          {/* <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/words/new">
            添加单词
          </NavLink> */}
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/notes">
            {t('nav.notes')}
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/expressions">
            {t('nav.expressions')}
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/ai-usage">
            {t('nav.aiUsage')}
          </NavLink>

        </nav>
      </header>

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
        <pre className="global-code-preview">{demoCode}</pre>
      </Modal>
      {location.pathname !== '/words/new' ? <QuickAddWordFloat /> : null}
    </div>
  )
}

export default App
