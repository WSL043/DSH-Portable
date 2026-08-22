window.__ModuleLoader__.load({
  id: '@wsl043/dsh-portable-desktop-bridge',
  factory: function (require) {
    const exports = {}
    const inject = ['slots', 'locale', 'theme', 'sessions', 'workspaces', 'sessionLogDownload']
    const React = require('react')

    const copy = {
      zh: {
        title: '便携版',
        updates: '自动检查更新', updatesHint: '默认关闭。开启后仅在启动时检查，仍由你决定是否更新。',
        notifications: '任务完成通知', notificationsHint: '任务在后台完成时显示系统通知。',
        close: '关闭窗口时', tray: '最小化到托盘', exit: '退出程序',
        on: '开启', off: '关闭',
        maintenance: '检查与修复', maintenanceHint: '检查不会修改文件；修复只重建可再生组件，并在下次启动时执行。',
        check: '运行检查', checking: '正在检查…', healthy: '未发现问题', issues: '发现 {0} 项问题',
        repair: '下次启动时安全修复', scheduled: '已安排，下次启动时执行', repaired: '上次修复已完成',
        fullPackage: '程序文件不完整，自动修复未改动用户数据。请使用完整版本覆盖安装。',
        report: '导出支持报告', exported: '支持报告已保存：{0}', failed: '操作失败：{0}',
      },
      en: {
        title: 'Portable',
        updates: 'Automatic update checks', updatesHint: 'Off by default. When enabled, startup only checks; you still choose whether to update.',
        notifications: 'Task completion notifications', notificationsHint: 'Show a system notification when a background task finishes.',
        close: 'When closing the window', tray: 'Minimize to tray', exit: 'Exit application',
        on: 'On', off: 'Off',
        maintenance: 'Check and repair', maintenanceHint: 'Checks are read-only. Repair only rebuilds generated components and runs on the next start.',
        check: 'Run check', checking: 'Checking…', healthy: 'No problems found', issues: '{0} issue(s) found',
        repair: 'Repair safely on next start', scheduled: 'Scheduled for the next start', repaired: 'The last repair completed',
        fullPackage: 'Program files are incomplete. Automatic repair preserved user data; reinstall the complete package.',
        report: 'Export support report', exported: 'Support report saved: {0}', failed: 'Operation failed: {0}',
      },
    }

    function format(template, value) { return String(template).replace('{0}', String(value)) }

    function PortableSettings(ctx, Button) {
      const h = React.createElement
      const useEffect = React.useEffect
      const useState = React.useState
      const lang = localeOf(ctx)
      const t = key => copy[lang][key] || key
      const [settings, setSettings] = useState(null)
      const [busy, setBusy] = useState('')
      const [message, setMessage] = useState('')
      useEffect(() => {
        let active = true
        fetch('/dsh-portable/settings', { cache: 'no-store' })
          .then(res => res.json()).then(body => {
            if (!active) return
            setSettings(body.settings)
            if (body.lastRepair?.needsFullPackage) setMessage(t('fullPackage'))
            else if (body.lastRepair?.ok) setMessage(t('repaired'))
          })
          .catch(error => { if (active) setMessage(format(t('failed'), error.message || error)) })
        return () => { active = false }
      }, [])

      const update = patch => {
        setSettings(current => ({ ...current, ...patch }))
        fetch('/dsh-portable/settings', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
        }).then(res => res.json()).then(body => {
          if (body.error) throw new Error(body.error)
          setSettings(body.settings)
          window.chrome?.webview?.postMessage?.({ type: 'dsh-portable/preferences', schemaVersion: 1, ...body.settings })
        }).catch(error => setMessage(format(t('failed'), error.message || error)))
      }
      const action = (name, path) => {
        setBusy(name); setMessage('')
        fetch(path, { method: 'POST' }).then(res => res.json()).then(body => {
          if (body.error) throw new Error(body.error)
          if (name === 'doctor') {
            const count = (body.checks || []).filter(item => item.status !== 'ok').length
            setMessage(body.needsFullPackage ? t('fullPackage') : count ? format(t('issues'), count) : t('healthy'))
          } else if (name === 'repair') setMessage(t('scheduled'))
          else setMessage(format(t('exported'), body.output || ''))
        }).catch(error => setMessage(format(t('failed'), error.message || error))).finally(() => setBusy(''))
      }
      const styles = {
        group: { borderBottom: '1px solid var(--dsw-alias-border-l2)', display: 'flex', flexDirection: 'column', padding: '16px 0' },
        heading: { color: 'var(--dsw-alias-label-primary)', fontSize: 14, fontWeight: 400, lineHeight: '22px', marginBottom: 0 },
        item: { display: 'flex', gap: 8, alignItems: 'center', padding: '16px 0' },
        text: { display: 'flex', flex: 1, minWidth: 0, paddingRight: 48, flexDirection: 'column', gap: 4 },
        label: { color: 'var(--dsw-alias-label-primary)', fontSize: 14, fontWeight: 400, lineHeight: '22px' },
        hint: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: '18px' },
        selector: { background: 'var(--dsw-alias-bg-module-platform)', height: 36, minWidth: 108, border: 0, borderRadius: 18, padding: '0 14px', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 14, lineHeight: '22px', cursor: 'pointer' },
        controls: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 },
        status: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: '18px', marginTop: 8, wordBreak: 'break-word' },
      }
      if (!settings) return h('div', { style: styles.group }, h('div', { style: styles.heading }, t('title')), h('div', { style: styles.hint }, t('checking')))
      const booleanRow = (key, title, hint) => h('div', { style: styles.item },
        h('div', { style: styles.text }, h('div', { style: styles.label }, title), h('div', { style: styles.hint }, hint)),
        h('select', { style: styles.selector, value: settings[key] ? 'on' : 'off', onChange: event => update({ [key]: event.target.value === 'on' }), 'aria-label': title },
          h('option', { value: 'off' }, t('off')), h('option', { value: 'on' }, t('on'))))
      return h('div', { style: styles.group },
        h('div', { style: styles.heading }, t('title')),
        booleanRow('updateCheckEnabled', t('updates'), t('updatesHint')),
        booleanRow('taskNotificationsEnabled', t('notifications'), t('notificationsHint')),
        h('div', { style: styles.item }, h('div', { style: styles.text }, h('div', { style: styles.label }, t('close'))),
          h('select', { style: styles.selector, value: settings.closeBehavior, onChange: event => update({ closeBehavior: event.target.value }), 'aria-label': t('close') },
            h('option', { value: 'tray' }, t('tray')), h('option', { value: 'exit' }, t('exit')))),
        h('div', { style: { ...styles.item, alignItems: 'flex-start' } },
          h('div', { style: { ...styles.text, paddingRight: 0 } },
            h('div', { style: styles.label }, t('maintenance')), h('div', { style: styles.hint }, t('maintenanceHint')),
            h('div', { style: styles.controls },
              h(Button, { size: 'sm', disabled: Boolean(busy), onClick: () => action('doctor', '/dsh-portable/doctor') }, busy === 'doctor' ? t('checking') : t('check')),
              h(Button, { size: 'sm', disabled: Boolean(busy), onClick: () => action('repair', '/dsh-portable/repair') }, t('repair')),
              h(Button, { size: 'sm', disabled: Boolean(busy), onClick: () => action('report', '/dsh-portable/support-report') }, t('report'))))),
        message && h('div', { style: styles.status, role: 'status' }, message))
    }

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
      if (React?.createElement && React?.useState && React?.useEffect) {
        try {
          const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
          if (primitives?.Button) {
            const SettingsSection = () => PortableSettings(ctx, primitives.Button)
            ctx.slots.inject('settings.general.item', () => ctx.slots.register({
              name: 'settings.general.item', id: 'portable', order: 60,
            }, SettingsSection))
          }
        } catch (error) { console.warn('[dsh-portable] settings section unavailable:', error) }
      }
      if (!webview?.postMessage || !webview?.addEventListener) return

      ctx.effect(() => {
        let active = true
        let workspaceRequestSequence = 0
        const pendingWorkspaceRequests = new Map()
        const originalPickDirectory = ctx.workspaces?.pickDirectory
        let nativePickDirectory = null
        if (ctx.workspaces && typeof originalPickDirectory === 'function') {
          nativePickDirectory = () => new Promise((resolve, reject) => {
            const requestId = `workspace-${Date.now().toString(36)}-${++workspaceRequestSequence}`
            pendingWorkspaceRequests.set(requestId, { resolve, reject })
            webview.postMessage({
              type: 'dsh-portable/pick-directory',
              schemaVersion: 1,
              requestId,
            })
          })
          ctx.workspaces.pickDirectory = nativePickDirectory
        }
        const publish = () => {
          if (active) webview.postMessage(sessionState(ctx))
        }
        const receive = event => {
          const message = event?.data
          if (!message) return
          if (message.type === 'dsh-portable/pick-directory-result' && message.schemaVersion === 1) {
            const requestId = String(message.requestId || '')
            const pending = pendingWorkspaceRequests.get(requestId)
            if (!pending) return
            pendingWorkspaceRequests.delete(requestId)
            if (message.error) pending.reject(new Error(String(message.error)))
            else pending.resolve(message.cancelled ? null : String(message.path || '') || null)
            return
          }
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
          if (ctx.workspaces?.pickDirectory === nativePickDirectory && typeof originalPickDirectory === 'function') {
            ctx.workspaces.pickDirectory = originalPickDirectory
          }
          for (const pending of pendingWorkspaceRequests.values()) pending.resolve(null)
          pendingWorkspaceRequests.clear()
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
