import { CloseOutlined, HomeFilled } from '@ant-design/icons'
import { useNavigate } from 'react-router'
import { useTabsStore } from '../store/tabsStore'

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
    <div className="tab-strip" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === activeId
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            className={`tab-pill ${isActive ? 'active' : ''}`}
            onClick={() => handleActivate(tab.id, tab.path)}
            onAuxClick={(e) => {
              // middle-click closes (browser convention)
              if (e.button === 1 && tab.closable) handleClose(tab.id, e)
            }}
            title={tab.title}
          >
            {!tab.closable ? <HomeFilled className="tab-pill-icon" /> : null}
            <span className="tab-pill-title">{tab.title}</span>
            {tab.closable ? (
              <span
                role="button"
                aria-label="关闭标签"
                className="tab-pill-close"
                onClick={(e) => handleClose(tab.id, e)}
              >
                <CloseOutlined />
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
