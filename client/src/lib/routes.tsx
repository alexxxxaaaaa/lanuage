import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  FileText,
  Headphones,
  Library,
  MessagesSquare,
  NotebookPen,
  Search,
  Settings,
  SpellCheck,
  Target,
} from 'lucide-react'
import type { ReactElement } from 'react'

import { AddWordPage } from '../pages/AddWordPage'
import { ExamDetailPage } from '../pages/ExamDetailPage'
import { ExamResultPage } from '../pages/ExamResultPage'
import { ExamTakePage } from '../pages/ExamTakePage'
import { ExamsPage } from '../pages/ExamsPage'
import { ExpressionFolderDetailPage } from '../pages/ExpressionFolderDetailPage'
import { ExpressionsPage } from '../pages/ExpressionsPage'
import { FolderDetailPage } from '../pages/FolderDetailPage'
import { FoldersPage } from '../pages/FoldersPage'
import { GrammarDetailPage } from '../pages/GrammarDetailPage'
import { GrammarPage } from '../pages/GrammarPage'
import { GrammarQuestionsPage } from '../pages/GrammarQuestionsPage'
import { HomePage } from '../pages/HomePage'
import { JlptPage } from '../pages/JlptPage'
import { JlptPracticePage } from '../pages/JlptPracticePage'
import { LearnGrammarPage } from '../pages/LearnGrammarPage'
import { LearnPage } from '../pages/LearnPage'
import { NoteDetailPage } from '../pages/NoteDetailPage'
import { NotesPage } from '../pages/NotesPage'
import { PodcastDetailPage } from '../pages/PodcastDetailPage'
import { PodcastsPage } from '../pages/PodcastsPage'
import { ReadingPage } from '../pages/ReadingPage'
import { ReviewGrammarPage } from '../pages/ReviewGrammarPage'
import { ReviewPage } from '../pages/ReviewPage'
import { SettingsPage } from '../pages/SettingsPage'
import { WordSearchPage } from '../pages/WordSearchPage'

/**
 * Single source of truth for the app's URL surface.
 *
 * Every navigable route is declared once, here. The router builds its table
 * from `ROUTES`, the sidebar renders `SIDEBAR_ROUTES`, and breadcrumbs walk
 * the same registry via `getRouteChain`. Adding a page means adding one entry
 * — there is no second list to keep in sync.
 */
export interface RouteDefinition {
  /** React Router path pattern, e.g. `/folders/:id`. */
  path: string
  /** i18n key under the `routes.*` namespace. */
  titleKey: string
  /** The page to render. */
  element: ReactElement
  /** Sidebar icon — only routes with `showInSidebar` need one. */
  icon?: LucideIcon
  /**
   * Whether this route gets a sidebar entry. `/` is reached from the account
   * row at the top of the rail instead, so it deliberately has none.
   */
  showInSidebar?: boolean
  /**
   * Explicit parent for the breadcrumb chain. When omitted, the chain walks
   * ancestors by stripping trailing segments and taking the longest
   * registered match.
   */
  parent?: string
  /** Excluded from the breadcrumb chain when false. */
  breadcrumb?: false
  /**
   * Feature flag the user must hold for this route to render or appear in the
   * sidebar. Currently only podcasts are gated.
   */
  requires?: 'podcast'
  /**
   * Set to false for pages that must start clean on every visit rather than
   * being kept alive in the background (see `KeepAliveOutlet`).
   */
  keepAlive?: false
}

export const ROUTES: readonly RouteDefinition[] = [
  {
    // Dashboard *and* account page: identity, sign out and AI usage live here
    // alongside the day's review numbers.
    path: '/',
    titleKey: 'home',
    element: <HomePage />,
  },

  // --- 词汇 -----------------------------------------------------------------
  {
    path: '/words/search',
    titleKey: 'wordSearch',
    element: <WordSearchPage />,
    icon: Search,
    showInSidebar: true,
  },
  {
    path: '/folders',
    titleKey: 'folders',
    element: <FoldersPage />,
    icon: Library,
    showInSidebar: true,
  },
  {
    path: '/folders/:id',
    titleKey: 'folderDetail',
    element: <FolderDetailPage />,
    parent: '/folders',
  },
  {
    // Learning and reviewing are always *of a wordlist*, so they hang off one
    // instead of owning sidebar slots. One page instance per wordlist means
    // two half-finished sessions can coexist, and keep-alive resumes either.
    path: '/folders/:id/learn',
    titleKey: 'learn',
    element: <LearnPage />,
    parent: '/folders/:id',
  },
  {
    path: '/folders/:id/review',
    titleKey: 'review',
    element: <ReviewPage />,
    parent: '/folders/:id',
  },
  {
    // Reached from a wordlist, from the quick-search float, and from a note —
    // so it hangs off /folders rather than owning a sidebar slot of its own.
    path: '/words/new',
    titleKey: 'addWord',
    element: <AddWordPage />,
    parent: '/folders',
  },

  // --- 笔记 / 表达 ----------------------------------------------------------
  {
    path: '/notes',
    titleKey: 'notes',
    element: <NotesPage />,
    icon: NotebookPen,
    showInSidebar: true,
  },
  {
    path: '/notes/:id',
    titleKey: 'noteDetail',
    element: <NoteDetailPage />,
    parent: '/notes',
  },
  {
    path: '/expressions',
    titleKey: 'expressions',
    element: <ExpressionsPage />,
    icon: MessagesSquare,
    showInSidebar: true,
  },
  {
    path: '/expressions/folders/:id',
    titleKey: 'expressionFolderDetail',
    element: <ExpressionFolderDetailPage />,
    parent: '/expressions',
  },

  // --- 语法 -----------------------------------------------------------------
  {
    path: '/grammar',
    titleKey: 'grammar',
    element: <GrammarPage />,
    icon: SpellCheck,
    showInSidebar: true,
  },
  {
    path: '/grammar/learn',
    titleKey: 'grammarLearn',
    element: <LearnGrammarPage />,
    parent: '/grammar',
  },
  {
    path: '/grammar/review',
    titleKey: 'grammarReview',
    element: <ReviewGrammarPage />,
    parent: '/grammar',
  },
  {
    path: '/grammar/questions',
    titleKey: 'grammarQuestions',
    element: <GrammarQuestionsPage />,
    parent: '/grammar',
  },
  {
    // Declared after the static /grammar/* routes so the sidebar and the
    // breadcrumb chain read in the same order the router matches them.
    path: '/grammar/:id',
    titleKey: 'grammarDetail',
    element: <GrammarDetailPage />,
    parent: '/grammar',
  },

  // --- JLPT -----------------------------------------------------------------
  {
    path: '/exams',
    titleKey: 'exams',
    element: <ExamsPage />,
    icon: FileText,
    showInSidebar: true,
  },
  {
    path: '/exams/:id',
    titleKey: 'examDetail',
    element: <ExamDetailPage />,
    parent: '/exams',
  },
  {
    // A running attempt keeps a timer and unsaved answers, so it must not be
    // resurrected from a stale background mount days later.
    path: '/exams/:id/attempts/:attemptId',
    titleKey: 'examTake',
    element: <ExamTakePage />,
    parent: '/exams/:id',
    keepAlive: false,
  },
  {
    path: '/exams/:id/attempts/:attemptId/result',
    titleKey: 'examResult',
    element: <ExamResultPage />,
    parent: '/exams/:id',
    keepAlive: false,
  },
  {
    path: '/reading',
    titleKey: 'reading',
    element: <ReadingPage />,
    icon: BookOpen,
    showInSidebar: true,
  },
  {
    path: '/jlpt',
    titleKey: 'jlpt',
    element: <JlptPage />,
    icon: Target,
    showInSidebar: true,
  },
  {
    path: '/jlpt/practice',
    titleKey: 'jlptPractice',
    element: <JlptPracticePage />,
    parent: '/jlpt',
  },

  // --- 其他 -----------------------------------------------------------------
  {
    path: '/podcasts',
    titleKey: 'podcasts',
    element: <PodcastsPage />,
    icon: Headphones,
    showInSidebar: true,
    requires: 'podcast',
  },
  {
    path: '/podcasts/:id',
    titleKey: 'podcastDetail',
    element: <PodcastDetailPage />,
    parent: '/podcasts',
    requires: 'podcast',
  },
  {
    path: '/settings',
    titleKey: 'settings',
    element: <SettingsPage />,
    icon: Settings,
    showInSidebar: true,
  },
]

/** Routes that get a sidebar entry, in declaration order. */
export const SIDEBAR_ROUTES: readonly RouteDefinition[] = ROUTES.filter(
  (r) => r.showInSidebar,
)

/** Feature flags a user can hold; mirrors the `requires` field above. */
export interface RouteCapabilities {
  podcast: boolean
}

export function isRouteVisible(
  route: RouteDefinition,
  caps: RouteCapabilities,
): boolean {
  return route.requires ? caps[route.requires] : true
}

// ---------------------------------------------------------------------------
// Compiled lookup tables — built once at module load.
// ---------------------------------------------------------------------------

interface CompiledPattern {
  regex: RegExp
  paramNames: string[]
  route: RouteDefinition
}

const DYNAMIC_SEGMENT = /:([A-Za-z0-9_]+)/g

function compilePattern(route: RouteDefinition): CompiledPattern {
  const paramNames: string[] = []
  const source = route.path.replace(DYNAMIC_SEGMENT, (_, name: string) => {
    paramNames.push(name)
    return '([^/]+)'
  })
  return { regex: new RegExp(`^${source}$`), paramNames, route }
}

const staticByPath = new Map<string, RouteDefinition>()
const dynamicPatterns: CompiledPattern[] = []

for (const route of ROUTES) {
  if (route.path.includes(':')) dynamicPatterns.push(compilePattern(route))
  else staticByPath.set(route.path, route)
}

// Most segments first, so the most specific pattern wins where two overlap.
dynamicPatterns.sort(
  (a, b) => b.route.path.split('/').length - a.route.path.split('/').length,
)

export interface RouteMatch {
  route: RouteDefinition
  params: Record<string, string>
}

/** The most specific registered route matching `pathname`, or null. */
export function matchRoute(pathname: string): RouteMatch | null {
  const exact = staticByPath.get(pathname)
  if (exact) return { route: exact, params: {} }

  for (const { regex, paramNames, route } of dynamicPatterns) {
    const m = regex.exec(pathname)
    if (!m) continue
    const params: Record<string, string> = {}
    paramNames.forEach((name, i) => {
      params[name] = decodeURIComponent(m[i + 1] ?? '')
    })
    return { route, params }
  }
  return null
}

export interface RouteChainEntry {
  route: RouteDefinition
  params: Record<string, string>
  /** Concrete URL for this entry, with params substituted. */
  href: string
}

function buildHref(pattern: string, params: Record<string, string>): string {
  return pattern.replace(DYNAMIC_SEGMENT, (_, name: string) => params[name] ?? `:${name}`)
}

function findParent(match: RouteMatch): RouteMatch | null {
  if (match.route.parent) {
    const parent = staticByPath.get(match.route.parent)
    if (parent) return { route: parent, params: match.params }
    // The declared parent is itself dynamic — resolve it against our params.
    return matchRoute(buildHref(match.route.parent, match.params))
  }

  const segments = match.route.path.split('/').filter(Boolean)
  for (let i = segments.length - 1; i > 0; i--) {
    const ancestor = matchRoute(
      buildHref('/' + segments.slice(0, i).join('/'), match.params),
    )
    if (ancestor) return ancestor
  }
  return null
}

/**
 * Walks leaf → root for `pathname` and returns the chain root-first. Empty
 * when `pathname` matches nothing. Pure — safe to call outside React.
 */
export function getRouteChain(pathname: string): RouteChainEntry[] {
  const leaf = matchRoute(pathname)
  if (!leaf) return []

  const chain: RouteMatch[] = [leaf]
  let current: RouteMatch | null = leaf
  while ((current = findParent(current))) {
    // Defensive: a mis-declared `parent` could otherwise loop forever.
    const seen: RouteMatch = current
    if (chain.some((c) => c.route.path === seen.route.path)) break
    chain.unshift(current)
  }

  return chain.map((entry) => ({
    route: entry.route,
    params: entry.params,
    href: buildHref(entry.route.path, entry.params),
  }))
}
