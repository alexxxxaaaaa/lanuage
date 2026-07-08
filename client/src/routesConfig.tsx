import { Navigate, type RouteObject } from 'react-router-dom'
import { AiUsagePage } from './pages/AiUsagePage'
import { AddWordPage } from './pages/AddWordPage'
import { ExamDetailPage } from './pages/ExamDetailPage'
import { ExamResultPage } from './pages/ExamResultPage'
import { ExamTakePage } from './pages/ExamTakePage'
import { ExamsPage } from './pages/ExamsPage'
import { ExpressionFolderDetailPage } from './pages/ExpressionFolderDetailPage'
import { ExpressionsPage } from './pages/ExpressionsPage'
import { FolderDetailPage } from './pages/FolderDetailPage'
import { FoldersPage } from './pages/FoldersPage'
import { GrammarDetailPage } from './pages/GrammarDetailPage'
import { GrammarPage } from './pages/GrammarPage'
import { LearnGrammarPage } from './pages/LearnGrammarPage'
import { ReviewGrammarPage } from './pages/ReviewGrammarPage'
import { PodcastDetailPage } from './pages/PodcastDetailPage'
import { PodcastsPage } from './pages/PodcastsPage'
import { HomePage } from './pages/HomePage'
import { LearnPage } from './pages/LearnPage'
import { NoteDetailPage } from './pages/NoteDetailPage'
import { NotesPage } from './pages/NotesPage'
import { ReviewPage } from './pages/ReviewPage'
import { WordSearchPage } from './pages/WordSearchPage'

// Route table used by useRoutes(routes, tab.path) so each open tab renders the
// page matching its own path — independent of the browser's current URL. Pages
// that require permission gating still use the same <Navigate> fallback.
export function buildRoutes(opts: { canSeePodcast: boolean }): RouteObject[] {
  return [
    { path: '/', element: <HomePage /> },
    { path: '/folders', element: <FoldersPage /> },
    { path: '/folders/:id', element: <FolderDetailPage /> },
    { path: '/words/new', element: <AddWordPage /> },
    { path: '/words/search', element: <WordSearchPage /> },
    { path: '/learn', element: <LearnPage /> },
    { path: '/review', element: <ReviewPage /> },
    { path: '/ai-usage', element: <AiUsagePage /> },
    { path: '/notes', element: <NotesPage /> },
    { path: '/notes/:id', element: <NoteDetailPage /> },
    { path: '/expressions', element: <ExpressionsPage /> },
    { path: '/expressions/folders/:id', element: <ExpressionFolderDetailPage /> },
    { path: '/grammar', element: <GrammarPage /> },
    { path: '/grammar/learn', element: <LearnGrammarPage /> },
    { path: '/grammar/review', element: <ReviewGrammarPage /> },
    { path: '/grammar/:id', element: <GrammarDetailPage /> },
    { path: '/exams', element: <ExamsPage /> },
    { path: '/exams/:id', element: <ExamDetailPage /> },
    { path: '/exams/:id/attempts/:attemptId', element: <ExamTakePage /> },
    { path: '/exams/:id/attempts/:attemptId/result', element: <ExamResultPage /> },
    {
      path: '/podcasts',
      element: opts.canSeePodcast ? <PodcastsPage /> : <Navigate to="/" replace />,
    },
    {
      path: '/podcasts/:id',
      element: opts.canSeePodcast ? <PodcastDetailPage /> : <Navigate to="/" replace />,
    },
  ]
}
