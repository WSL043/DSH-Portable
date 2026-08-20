window.__ModuleLoader__.load({
  id: '@wsl043/dsh-portable-desktop-bridge',
  factory: function (require) {
    const exports = {}
    const inject = ['slots', 'locale', 'theme', 'sessions', 'sessionLogDownload']

    function localeOf(ctx) {
      const active = String(ctx.locale.getLocale()?.active ?? '').toLowerCase()
      return active.startsWith('zh') ? 'zh' : 'en'
    }

    function themeOf(ctx) {
      return ctx.theme.getTheme()?.active?.colorScheme === 'dark' ? 'dark' : 'light'
    }

    function sessionState(ctx) {
      const source = ctx.sessions.list.getSnapshot()
      const sourceSessions = (source.ids ?? [])
        .map(id => source.byId?.[id])
        .filter(Boolean)
      const hasRunningSession = sourceSessions.some(item => Boolean(item.running))
      const sessions = sourceSessions
        .filter(item => item && !item.blank && item.origin !== 'subagent')
        .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
        .slice(0, 10)
        .map(item => ({
          id: String(item.id),
          title: String(item.displayTitle || item.title || item.id),
          updatedAt: Number(item.updatedAt || 0),
          running: Boolean(item.running),
          completed: Boolean(item.completed),
          pendingInteraction: item.pendingInteraction == null ? '' : String(item.pendingInteraction),
          agentPreset: item.agentPreset == null ? '' : String(item.agentPreset),
        }))
      return {
        type: 'dsh-portable/state',
        schemaVersion: 1,
        locale: localeOf(ctx),
        theme: themeOf(ctx),
        currentSessionId: source.current == null ? '' : String(source.current),
        hasRunningSession,
        sessions,
      }
    }

    function applyNativeDownload(ctx, message) {
      if (message?.schemaVersion !== 1) return
      const sessionId = String(message.sessionId || '')
      if (!sessionId || !ctx.sessionLogDownload?.store?.update) return
      const nativeDownload = {
        state: String(message.state || ''),
        fileName: String(message.fileName || ''),
        bytesReceived: Math.max(0, Number(message.bytesReceived || 0)),
        totalBytes: Math.max(0, Number(message.totalBytes || 0)),
        percent: Number.isFinite(Number(message.percent)) ? Number(message.percent) : -1,
        reason: String(message.reason || ''),
      }
      const status = nativeDownload.state === 'completed'
        ? 'success'
        : nativeDownload.state === 'interrupted' || nativeDownload.state === 'cancelled'
          ? 'error'
          : 'downloading'
      ctx.sessionLogDownload.store.update(state => {
        const current = state.bySession[sessionId]
        state.bySession = {
          ...state.bySession,
          [sessionId]: {
            ...current,
            open: current?.open ?? true,
            status,
            error: status === 'error' ? nativeDownload.reason : null,
            nativeDownload,
          },
        }
      })
    }

    function apply(ctx) {
      const webview = window.chrome?.webview
      if (!webview?.postMessage || !webview?.addEventListener) return

      ctx.effect(() => {
        let active = true
        const publish = () => {
          if (active) webview.postMessage(sessionState(ctx))
        }
        const receive = event => {
          const message = event?.data
          if (!message) return
          if (message.type === 'dsh-portable/download') {
            applyNativeDownload(ctx, message)
            return
          }
          if (message.type !== 'dsh-portable/action') return
          if (message.action === 'new-session') {
            ctx.sessions.clear()
            return
          }
          if (message.action !== 'open-session') return
          const sessionId = String(message.sessionId || '')
          const snapshot = ctx.sessions.list.getSnapshot()
          if (snapshot.byId?.[sessionId] && snapshot.byId[sessionId].origin !== 'subagent') {
            ctx.sessions.open(sessionId)
          }
        }

        webview.addEventListener('message', receive)
        const stopSessions = ctx.sessions.list.subscribe(publish)
        const stopLocale = ctx.on('locale/change', publish)
        const stopTheme = ctx.on('theme/change', publish)
        publish()

        return () => {
          active = false
          webview.removeEventListener?.('message', receive)
          stopSessions?.()
          stopLocale?.()
          stopTheme?.()
        }
      })
    }

    exports.inject = inject
    exports.apply = apply
    return exports
  },
})
