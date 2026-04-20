import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import './App.css'
import { AddWordPage } from './pages/AddWordPage'
import { FolderDetailPage } from './pages/FolderDetailPage'
import { FoldersPage } from './pages/FoldersPage'
import { HomePage } from './pages/HomePage'
import { ReviewPage } from './pages/ReviewPage'
import { WordSearchPage } from './pages/WordSearchPage'

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [keyword, setKeyword] = useState('')

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
              placeholder="搜索单词/读音/释义(中英日)"
            />
            <button type="submit" className="primary-button">
              搜索
            </button>
          </form>
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/" end>
            首页
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/folders">
            分类
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/words/new">
            添加单词
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/review">
            复习
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
          <Route path="/review" element={<ReviewPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
