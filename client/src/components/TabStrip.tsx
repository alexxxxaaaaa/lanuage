import { X, Home } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useTabsStore } from '../store/tabsStore'

// The close "x". Its hover tint has to flip on an active pill (dark blue), so
// the two states are spelled out rather than shared.
const CLOSE =
  'ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded text-[10px] opacity-55 hover:opacity-100'

export function TabStrip() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeId = useTabsStore((s) => s.activeId)
  const navigate = useNavigate()

  if (tabs.length === 0) return null

  const handleActivate = (id: string, path: string) => {
    useTabsStore.getState().activate(id)
    navigate(path)
  }

  const handleClose = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const nextActive = useTabsStore.getState().close(id)
    if (nextActive) {
      const nextTab = useTabsStore.getState().tabs.find((t) => t.id === nextActive)
      if (nextTab) navigate(nextTab.path)
    }
  }

  return (
    // Sticky so switching tabs doesn't require scrolling back to the top.
    <div
      className="sticky top-0 z-[5] mb-1 flex items-center gap-1.5 overflow-x-auto border-b border-black/6 bg-background px-0.5 py-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-[3px] [&::-webkit-scrollbar-thumb]:bg-black/20"
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            className={`inline-flex min-h-0 max-w-[220px] min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border py-1.5 pr-2.5 pl-3 text-[13px] font-normal whitespace-nowrap transition-[background-color,border-color,color] duration-100 ${
              isActive
                ? 'border-accent bg-accent text-white'
                : 'border-black/8 bg-black/2 text-black/65 hover:bg-black/5 hover:text-black/85'
            }`}
            onClick={() => handleActivate(tab.id, tab.path)}
            onAuxClick={(e) => {
              // middle-click closes (browser convention)
              if (e.button === 1 && tab.closable) handleClose(tab.id, e)
            }}
            title={tab.title}
          >
            {!tab.closable ? <Home className="shrink-0 text-xs" /> : null}
            <span className="min-w-0 truncate">{tab.title}</span>
            {tab.closable ? (
              <span
                role="button"
                aria-label="关闭标签"
                className={`${CLOSE} ${isActive ? 'hover:bg-white/25' : 'hover:bg-black/12'}`}
                onClick={(e) => handleClose(tab.id, e)}
              >
                <X />
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
