import { Component, type ReactNode } from 'react'

export type MarketView = 'discover' | 'installed'

export interface MarketErrorBoundaryProps {
  children?: ReactNode
  view: MarketView
}

interface MarketErrorBoundaryState {
  failed: boolean
}

/** Keep one market tab failure from blanking the host settings dialog. */
export class MarketErrorBoundary extends Component<MarketErrorBoundaryProps, MarketErrorBoundaryState> {
  state: MarketErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): MarketErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    try {
      void fetch('/dsh-market/client-error', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          view: this.props.view,
          message: String(error.message).slice(0, 600),
        }),
      }).catch(() => { /* reporting must never trigger another render */ })
    } catch {
      // A missing or synchronously failing fetch must not affect the fallback.
    }
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert">
        <p>此页面发生异常，请前往 Portable 设置导出诊断。 / This page encountered an error. Go to Portable Settings to export diagnostics.</p>
        <button type="button" onClick={() => this.setState({ failed: false })}>重试 / Retry</button>
      </div>
    )
  }
}
