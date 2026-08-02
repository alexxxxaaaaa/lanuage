import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@heroui/react'

type Props = {
  /** Changing this resets the boundary — pass the route key so navigating
   *  away from a broken page clears the error instead of sticking. */
  resetKey: string
  children: ReactNode
}

type State = { error: Error | null }

/**
 * Catches a render crash in one page and shows it, instead of letting React
 * unmount the entire tree and leave a white screen.
 *
 * Scoped to the routed page rather than the app root on purpose: the sidebar
 * and topbar keep working, so the user can navigate out of the broken page.
 * Error boundaries must be class components — there is no hook equivalent.
 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[page crashed]', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <section className="page">
        <div className="card state-card gap-3 text-center">
          <h2 className="m-0 text-lg">这个页面出错了</h2>
          <p className="muted m-0 text-sm">
            页面渲染时抛出异常，其它页面不受影响。可以重试，或换个页面继续。
          </p>
          <pre className="multiline-text m-0 max-w-full overflow-x-auto rounded-[10px] bg-surface-secondary px-3 py-2 text-left text-xs text-muted">
            {error.message}
          </pre>
          <div className="actions">
            <Button onPress={() => this.setState({ error: null })}>重试</Button>
            <Button variant="outline" onPress={() => window.location.reload()}>
              刷新页面
            </Button>
          </div>
        </div>
      </section>
    )
  }
}
