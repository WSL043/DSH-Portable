window.__ModuleLoader__.load({
  id: '@wsl043/dsh-portable-desktop-bridge',
  factory: function (require) {
    const exports = {}
    const React = require('react')
    const inject = ['slots', 'locale', 'theme', 'sessions', 'sessionLogDownload']
    const EXTENSION_NS = 'dsh.portable.extensions'
    const extensionLocale = {
      zh: {
        tab: '便携扩展',
        title: '便携扩展',
        intro: '经过兼容性固定的可选扩展。安装和移除会排到下次正常启动，不会中断正在运行的任务。',
        loading: '正在读取扩展状态…',
        retry: '重试',
        install: '安装',
        remove: '移除',
        installed: '已安装',
        reviewed: '已复核',
        experimental: '实验性',
        incompatible: '与当前版本不兼容',
        queued: '已安排到下次启动',
        restart: '保存当前任务并在方便时手动退出、重新打开 DSH。',
        source: '来源',
        license: '许可证',
        access: '能力与数据边界',
        confirmTitle: '确认扩展变更',
        confirmInstall: '下次正常启动时安装此扩展。当前任务不会被重启。',
        confirmRemove: '下次正常启动时移除此扩展。扩展自行创建的数据不会被自动删除。',
        acknowledge: '我了解这是实验性功能，并已阅读上面的能力与数据边界。',
        cancel: '取消',
        confirm: '确认并安排',
        working: '正在安排…',
        failed: '扩展状态暂时不可用。',
        operationFailed: '无法安排这次变更。',
        lastChange: '上次扩展变更',
        changeInstalled: '安装完成。',
        changeRemoved: '移除完成。',
        changeRolledBack: '变更未生效，原配置已恢复。',
        recoveryRequired: '自动恢复未完成。为保护现有配置，DSH 会暂停启动；请保留 Portable 数据并提交反馈。',
        changeFailed: '变更未生效。请检查网络和扩展兼容性后重试。',
      },
      en: {
        tab: 'Portable extensions',
        title: 'Portable extensions',
        intro: 'Optional extensions pinned to this tested build. Install and removal wait for the next normal start and never interrupt a running task.',
        loading: 'Loading extension state…',
        retry: 'Retry',
        install: 'Install',
        remove: 'Remove',
        installed: 'Installed',
        reviewed: 'Reviewed',
        experimental: 'Experimental',
        incompatible: 'Not compatible with this build',
        queued: 'Queued for next start',
        restart: 'Save your work and quit, then reopen DSH when convenient.',
        source: 'Source',
        license: 'License',
        access: 'Capabilities and data boundary',
        confirmTitle: 'Confirm extension change',
        confirmInstall: 'Install this extension on the next normal start. The current task will not restart.',
        confirmRemove: 'Remove this extension on the next normal start. Data created by the extension is not deleted automatically.',
        acknowledge: 'I understand this is experimental and have read the capabilities and data boundary above.',
        cancel: 'Cancel',
        confirm: 'Confirm and queue',
        working: 'Queuing…',
        failed: 'Extension state is temporarily unavailable.',
        operationFailed: 'This change could not be queued.',
        lastChange: 'Last extension change',
        changeInstalled: 'Installation completed.',
        changeRemoved: 'Removal completed.',
        changeRolledBack: 'The change was not applied and the previous profile was restored.',
        recoveryRequired: 'Automatic recovery did not complete. DSH startup is paused to protect the existing profile; keep the Portable data and report the issue.',
        changeFailed: 'The change was not applied. Check the connection and extension compatibility, then try again.',
      },
    }

    function installExtensionStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="dsh-portable-extensions"]')) return
      const style = document.createElement('style')
      style.dataset.pluginCss = 'dsh-portable-extensions'
      style.textContent = `
        .dspx-root{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:16px}
        .dspx-head h3,.dspx-head p,.dspx-card p,.dspx-status{margin:0}.dspx-head{display:flex;flex-direction:column;gap:6px}
        .dspx-head h3{font-size:16px;line-height:24px}.dspx-head p,.dspx-status{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
        .dspx-list{display:flex;flex-direction:column;gap:10px}.dspx-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;padding:14px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px 18px}
        .dspx-main{min-width:0;display:flex;flex-direction:column;gap:7px}.dspx-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dspx-title strong{font-size:14px;line-height:20px}.dspx-tag{border-radius:5px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);padding:1px 6px;font-size:11px;line-height:18px}.dspx-tag[data-tone=warning]{color:var(--dsw-alias-state-warning-primary)}
        .dspx-summary{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.dspx-meta{display:flex;gap:12px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.dspx-meta a{color:inherit}.dspx-access{margin:3px 0 0;padding-left:18px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
        .dspx-action{align-self:start;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:7px;min-height:32px;padding:5px 12px;font:inherit;font-size:13px;cursor:pointer}.dspx-action:hover{background:var(--dsw-alias-interactive-bg-hover)}.dspx-action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.dspx-action:disabled{opacity:.55;cursor:not-allowed}
        .dspx-banner{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:8px;padding:10px 12px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.dspx-error{color:var(--dsw-alias-state-error-primary)}
        .dspx-dialog{border:0;padding:0;background:transparent;color:inherit;max-width:min(520px,calc(100vw - 32px));width:100%}.dspx-dialog::backdrop{background:color-mix(in srgb,#000 48%,transparent)}.dspx-dialog-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-3);box-shadow:var(--dsw-shadow-lv3);border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:13px}.dspx-dialog-card h3,.dspx-dialog-card p{margin:0}.dspx-dialog-card h3{font-size:16px;line-height:24px}.dspx-check{display:flex;gap:9px;align-items:flex-start;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.dspx-check input{margin-top:3px}.dspx-dialog-actions{display:flex;justify-content:flex-end;gap:8px}.dspx-primary{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-white,#fff);border-color:transparent}
        @media(max-width:620px){.dspx-card{grid-template-columns:minmax(0,1fr)}.dspx-action{justify-self:start}}
        @media(prefers-reduced-motion:reduce){.dspx-root *{scroll-behavior:auto!important;transition:none!important}}
      `
      document.head.appendChild(style)
    }

    async function extensionJson(url, options) {
      const response = await fetch(url, {
        credentials: 'same-origin',
        headers: options?.body ? { 'content-type': 'application/json' } : undefined,
        ...options,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(String(body.error || response.status))
      return body
    }

    function resultMessage(result, t) {
      if (!result || result.status === 'awaiting_host_health') return ''
      if (result.status === 'recovery_required') return t('recoveryRequired')
      if (result.status === 'rolled_back' || result.status === 'rolled_back_after_boot_failure') return t('changeRolledBack')
      if (result.status === 'applied') return t(result.code === 'removed' ? 'changeRemoved' : 'changeInstalled')
      if (result.status === 'failed') return t('changeFailed')
      return ''
    }

    function PortableExtensionsTab(props) {
      const t = props.t
      const [state, setState] = React.useState({ phase: 'loading' })
      const [intent, setIntent] = React.useState(null)
      const [acknowledged, setAcknowledged] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const dialogRef = React.useRef(null)

      const load = React.useCallback(() => {
        setState({ phase: 'loading' })
        extensionJson('/api/dsh-portable/extensions').then(
          value => setState({ phase: 'ready', value }),
          () => setState({ phase: 'error' }),
        )
      }, [])
      React.useEffect(load, [load])
      React.useEffect(() => {
        if (intent) dialogRef.current?.showModal()
        else if (dialogRef.current?.open) dialogRef.current.close()
      }, [intent])

      const requiresExperimentalAck = Boolean(intent
        && intent.preview.action === 'install'
        && intent.item.channel === 'experimental')

      const begin = async (item, action) => {
        setBusy(true)
        try {
          const preview = await extensionJson('/api/dsh-portable/extensions/preview', {
            method: 'POST', body: JSON.stringify({ id: item.id, action }),
          })
          setAcknowledged(false)
          setIntent({ item, preview })
        } catch { setState(current => ({ ...current, operationError: true })) }
        finally { setBusy(false) }
      }
      const confirm = async () => {
        if (!intent || requiresExperimentalAck && !acknowledged) return
        setBusy(true)
        try {
          await extensionJson('/api/dsh-portable/extensions/confirm', {
            method: 'POST', body: JSON.stringify({
              previewToken: intent.preview.previewToken,
              experimentalAcknowledged: requiresExperimentalAck ? acknowledged : false,
            }),
          })
          setIntent(null)
          load()
        } catch { setState(current => ({ ...current, operationError: true })); setIntent(null) }
        finally { setBusy(false) }
      }
      const closeIntent = () => { if (!busy) setIntent(null) }

      const items = state.phase === 'ready' ? state.value.items : []
      const locale = String(props.locale || '').startsWith('zh') ? 'zh' : 'en'
      return React.createElement('div', { className: 'dspx-root', 'aria-busy': state.phase === 'loading' || busy },
        React.createElement('div', { className: 'dspx-head' },
          React.createElement('h3', null, t('title')),
          React.createElement('p', null, t('intro')),
        ),
        state.phase === 'loading' ? React.createElement('p', { className: 'dspx-status' }, t('loading')) : null,
        state.phase === 'error' ? React.createElement('div', { className: 'dspx-banner dspx-error', role: 'alert' },
          t('failed'), ' ', React.createElement('button', { className: 'dspx-action', type: 'button', onClick: load }, t('retry')),
        ) : null,
        state.operationError ? React.createElement('div', { className: 'dspx-banner dspx-error', role: 'alert' }, t('operationFailed')) : null,
        state.phase === 'ready' && (state.value.pending?.status === 'queued' || state.value.result?.status === 'awaiting_host_health')
          ? React.createElement('div', { className: 'dspx-banner', role: 'status' }, t('queued'), ' ', t('restart')) : null,
        state.phase === 'ready' && resultMessage(state.value.result, t)
          ? React.createElement('div', {
            className: `dspx-banner${state.value.result?.status === 'failed' || state.value.result?.status === 'recovery_required' ? ' dspx-error' : ''}`,
            role: state.value.result?.status === 'failed' || state.value.result?.status === 'recovery_required' ? 'alert' : 'status',
          }, React.createElement('strong', null, `${t('lastChange')}: `), resultMessage(state.value.result, t)) : null,
        state.phase === 'ready' ? React.createElement('div', { className: 'dspx-list' }, ...items.map(item =>
          React.createElement('section', { className: 'dspx-card', key: item.id },
            React.createElement('div', { className: 'dspx-main' },
              React.createElement('div', { className: 'dspx-title' },
                React.createElement('strong', null, item.name?.[locale] || item.name?.en || item.packageName),
                React.createElement('span', { className: 'dspx-tag', 'data-tone': item.channel === 'experimental' ? 'warning' : undefined }, t(item.channel)),
                item.installed ? React.createElement('span', { className: 'dspx-tag' }, t('installed')) : null,
              ),
              React.createElement('p', { className: 'dspx-summary' }, item.summary?.[locale] || item.summary?.en),
              React.createElement('div', { className: 'dspx-meta' },
                React.createElement('span', null, `${item.packageName}@${item.version}`),
                React.createElement('a', { href: item.repository, target: '_blank', rel: 'noreferrer' }, t('source')),
                React.createElement('span', null, `${t('license')}: ${item.license}`),
              ),
              React.createElement('strong', { className: 'dspx-status' }, t('access')),
              React.createElement('ul', { className: 'dspx-access' }, ...(item.permissions?.[locale] || item.permissions?.en || []).map(value => React.createElement('li', { key: value }, value))),
            ),
            React.createElement('button', {
              className: 'dspx-action', type: 'button', disabled: busy || !item.compatible || Boolean(state.value.pending),
              onClick: () => begin(item, item.installed ? 'remove' : 'install'),
            }, item.compatible ? t(item.installed ? 'remove' : 'install') : t('incompatible')),
          ),
        )) : null,
        React.createElement('dialog', { className: 'dspx-dialog', ref: dialogRef, onCancel: event => { event.preventDefault(); closeIntent() } },
          intent ? React.createElement('div', { className: 'dspx-dialog-card' },
            React.createElement('h3', null, t('confirmTitle')),
            React.createElement('p', null, intent.preview.action === 'install' ? t('confirmInstall') : t('confirmRemove')),
            React.createElement('ul', { className: 'dspx-access' }, ...(intent.preview.permissions?.[locale] || intent.preview.permissions?.en || []).map(value => React.createElement('li', { key: value }, value))),
            requiresExperimentalAck ? React.createElement('label', { className: 'dspx-check' },
              React.createElement('input', { type: 'checkbox', checked: acknowledged, onChange: event => setAcknowledged(event.currentTarget.checked) }),
              React.createElement('span', null, t('acknowledge')),
            ) : null,
            React.createElement('div', { className: 'dspx-dialog-actions' },
              React.createElement('button', { className: 'dspx-action', type: 'button', disabled: busy, onClick: closeIntent }, t('cancel')),
              React.createElement('button', { className: 'dspx-action dspx-primary', type: 'button', disabled: busy || requiresExperimentalAck && !acknowledged, onClick: confirm }, busy ? t('working') : t('confirm')),
            ),
          ) : null,
        ),
      )
    }

    function installExtensionsTab(ctx) {
      installExtensionStyles()
      ctx.effect(() => ctx.locale.register(EXTENSION_NS, extensionLocale), 'dsh-portable: extension dictionaries')
      const t = ctx.locale.bind(EXTENSION_NS)
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab', id: 'portable-extensions', order: 20,
        label: () => t('tab'), locale: EXTENSION_NS,
        inject: () => ({ locale: ctx.locale.getLocale()?.active || 'en' }),
      }, PortableExtensionsTab))
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
      installExtensionsTab(ctx)
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
