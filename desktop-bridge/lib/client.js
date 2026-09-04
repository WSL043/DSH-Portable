window.__ModuleLoader__.load({
  id: '@wsl043/dsh-portable-desktop-bridge',
  factory: function (require) {
    const exports = {}
    const inject = ['slots', 'locale', 'theme', 'sessions', 'workspaces', 'sessionLogDownload']
    const React = require('react')

    const copy = {
      zh: {
        title: '便携版',
        updates: '更新',
        updateChannel: '更新通道', stableChannel: '稳定版', betaChannel: 'Beta 测试版',
        updateChannelHint: '稳定版适合日常使用；Beta 可提前体验正在验证的新版本。切换不会自动降级当前版本。',
        updateRecovery: '新版本无法正常启动时，会自动恢复更新前的程序；会话、设置、插件和工作区保持不变。',
        updateRolledBack: '上次更新未通过启动验证，已自动恢复到 {0}。',
        previousVersion: '上一版本',
        product: 'DSH-Portable', productHint: '桌面窗口、便携运行环境与集成功能。启动检查默认关闭。',
        engine: 'DeepSeek Harness', engineHint: '官方内核。仅推送通过 Portable 兼容验证的版本；启动检查默认关闭。',
        startupCheck: '启动时检查', checkUpdate: '检查更新', installVersion: '安装所选版本', versionChoice: '内核版本',
        currentVersion: '当前 {0}', current: '已是最新版本', available: '{0} 可用；可从系统托盘选择安装。',
        incompatible: '此内核需要先更新 DSH-Portable。', engineFollowsProduct: '预览版内核随 DSH-Portable 更新。', channelUnpublished: '此预览版尚未发布更新通道。', updateUnavailable: '暂时无法连接更新服务。',
        notifications: '任务完成通知', notificationsHint: '任务在后台完成时显示系统通知。', notificationsSystemDisabled: 'Windows 通知已关闭；开启后，后台和托盘任务完成提醒才会显示。',
        updateReady: '有可用更新', environmentActive: '当前独立环境：{0}',
        desktop: '桌面行为',
        close: '关闭窗口时', tray: '最小化到托盘', exit: '退出程序',
        environments: '环境', environmentTitle: '独立环境', environmentHint: '每个环境分别保存会话、设置、凭据、插件和工作区；打开另一个环境不会中断当前任务。',
        defaultEnvironment: '默认环境', newEnvironment: '新建环境', environmentName: '环境名称', createEnvironment: '创建并打开', environmentOpened: '已打开 {0}',
        on: '开启', off: '关闭',
        care: '维护', maintenance: '检查与修复', maintenanceHint: '检查不会修改文件；修复只重建可再生组件，并在下次启动时执行。',
        check: '运行检查', checking: '正在检查…', healthy: '未发现问题', issues: '发现 {0} 项问题',
        repair: '下次启动时安全修复', scheduled: '已安排，下次启动时执行', repaired: '上次修复已完成',
        fullPackage: '程序文件不完整，自动修复未改动用户数据。请使用完整版本覆盖安装。',
        report: '导出支持报告', more: '更多', cancel: '取消', exported: '支持报告已保存：{0}', failed: '操作失败：{0}',
        data: '数据', dataTitle: '迁移与备份', dataHint: '会话、设置、插件配置和 API 凭据；不包含缓存、运行环境和工作区文件。',
        dataStandard: '导出迁移包', dataStandardHint: '内容不加密，适合在你信任的设备之间迁移。',
        dataPrivate: '导出加密私密包', dataPrivateHint: '内容与迁移包相同，恢复时需要密码。',
        dataPrivateDialogHint: '为会话、设置、插件和 API 凭据设置恢复密码。密码不会保存在 DSH-Portable 中。',
        dataPassword: '密码（至少 8 位）', dataPasswordConfirm: '确认密码', dataPasswordMismatch: '两次输入的密码不一致。',
        chooseSaveLocation: '选择保存位置后开始导出。', exportNow: '选择位置并导出',
        dataSaved: '数据包已保存：{0}',
        dataImport: '导入数据包', dataImportHint: '选择另一份 DSH-Portable 导出的数据包；导入前会先检查内容。',
        dataImportPassword: '输入数据包密码', dataImportPasswordHint: '这个数据包已加密。密码只用于本次导入，不会保存。',
        dataImportReview: '确认导入', dataImportReviewHint: '将导入 {0} 个文件。冲突项会由数据包替换，同时自动保留回滚备份。',
        dataImportCategories: '包含：{0}', dataImportFiles: '文件明细', dataImportMoreFiles: '另有 {0} 个文件', dataImportRestart: '重启并导入', dataImporting: '正在重启并导入…',
      },
      en: {
        title: 'Portable',
        updates: 'Updates',
        updateChannel: 'Update channel', stableChannel: 'Stable', betaChannel: 'Beta',
        updateChannelHint: 'Stable is recommended for daily use. Beta offers versions still under validation. Switching never downgrades the installed version.',
        updateRecovery: 'If a new version cannot start normally, the previous program is restored automatically while sessions, settings, plugins, and workspaces stay intact.',
        updateRolledBack: 'The last update failed startup verification and automatically restored {0}.',
        previousVersion: 'the previous version',
        product: 'DSH-Portable', productHint: 'Desktop host, portable runtime, and integrations. Startup checks are off by default.',
        engine: 'DeepSeek Harness', engineHint: 'Official core. Only Portable-verified builds are offered; startup checks are off by default.',
        startupCheck: 'Check at startup', checkUpdate: 'Check for updates', installVersion: 'Install selected version', versionChoice: 'Engine version',
        currentVersion: 'Current {0}', current: 'Already up to date', available: '{0} is available; install it from the system tray.',
        incompatible: 'Update DSH-Portable before installing this core.', engineFollowsProduct: 'Preview core updates are delivered with DSH-Portable.', channelUnpublished: 'No update channel has been published for this preview yet.', updateUnavailable: 'The update service is unavailable right now.',
        notifications: 'Task completion notifications', notificationsHint: 'Show a system notification when a background task finishes.', notificationsSystemDisabled: 'Windows notifications are turned off. Enable them to receive background and tray task completion alerts.',
        updateReady: 'Update available', environmentActive: 'Current isolated environment: {0}',
        desktop: 'Desktop behavior',
        close: 'When closing the window', tray: 'Minimize to tray', exit: 'Exit application',
        environments: 'Environments', environmentTitle: 'Isolated environments', environmentHint: 'Each environment keeps separate sessions, settings, credentials, plugins, and workspace. Opening another environment does not interrupt this one.',
        defaultEnvironment: 'Default environment', newEnvironment: 'New environment', environmentName: 'Environment name', createEnvironment: 'Create and open', environmentOpened: 'Opened {0}',
        on: 'On', off: 'Off',
        care: 'Maintenance', maintenance: 'Check and repair', maintenanceHint: 'Checks are read-only. Repair only rebuilds generated components and runs on the next start.',
        check: 'Run check', checking: 'Checking…', healthy: 'No problems found', issues: '{0} issue(s) found',
        repair: 'Repair safely on next start', scheduled: 'Scheduled for the next start', repaired: 'The last repair completed',
        fullPackage: 'Program files are incomplete. Automatic repair preserved user data; reinstall the complete package.',
        report: 'Export support report', more: 'More', cancel: 'Cancel', exported: 'Support report saved: {0}', failed: 'Operation failed: {0}',
        data: 'Data', dataTitle: 'Migration and backup', dataHint: 'Sessions, settings, plugin configuration, and API credentials; caches, runtimes, and workspace files stay out.',
        dataStandard: 'Export migration package', dataStandardHint: 'Not encrypted; use it only between devices you trust.',
        dataPrivate: 'Export encrypted private package', dataPrivateHint: 'Contains the same data and requires its password to restore.',
        dataPrivateDialogHint: 'Set a recovery password for sessions, settings, plugins, and API credentials. DSH-Portable never stores it.',
        dataPassword: 'Password (8+ characters)', dataPasswordConfirm: 'Confirm password', dataPasswordMismatch: 'The passwords do not match.',
        chooseSaveLocation: 'Choose where to save the package before export starts.', exportNow: 'Choose location and export',
        dataSaved: 'Data package saved: {0}',
        dataImport: 'Import data package', dataImportHint: 'Choose a package exported by another DSH-Portable. Its contents are checked before import.',
        dataImportPassword: 'Enter package password', dataImportPasswordHint: 'This package is encrypted. The password is used for this import only and is never stored.',
        dataImportReview: 'Confirm import', dataImportReviewHint: 'Import {0} file(s). Package files replace conflicts and a rollback backup is created automatically.',
        dataImportCategories: 'Includes: {0}', dataImportFiles: 'Files', dataImportMoreFiles: '{0} more file(s)', dataImportRestart: 'Restart and import', dataImporting: 'Restarting to import…',
      },
    }

    function format(template, value) { return String(template).replace('{0}', String(value)) }

    let dataExportRequestSequence = 0
    const pendingDataExportRequests = new Map()
    const pendingDataImportRequests = new Map()
    const pendingHostRestartRequests = new Map()
    const pendingEnvironmentRequests = new Map()

    const completeHostCapabilities = Object.freeze({
      pickDirectory: true,
      saveDataPackage: true,
      openDataPackage: true,
      importData: true,
      restartHost: true,
      openEnvironment: false,
      openUpdate: false,
      preferences: true,
      sessionProjection: true,
    })

    const webView2HostCapabilities = Object.freeze({
      ...completeHostCapabilities,
      openEnvironment: true,
      openUpdate: true,
    })

    function nativeHostTransport() {
      const native = window.__DSH_PORTABLE_NATIVE__
      if (native?.postMessage && native?.addEventListener) {
        return {
          bridge: native,
          capabilities: Object.freeze({ ...completeHostCapabilities, ...(native.capabilities || {}) }),
        }
      }
      const webview = window.chrome?.webview
      if (webview?.postMessage && webview?.addEventListener) {
        return { bridge: webview, capabilities: webView2HostCapabilities }
      }
      return null
    }

    function postToNativeHost(message, capability) {
      const host = nativeHostTransport()
      if (!host || host.capabilities[capability] !== true) return false
      host.bridge.postMessage(message)
      return true
    }

    function chooseDataExportPath(kind) {
      const host = nativeHostTransport()
      if (!host || host.capabilities.saveDataPackage !== true) return Promise.resolve('')
      return new Promise((resolve, reject) => {
        const requestId = `data-export-${Date.now().toString(36)}-${++dataExportRequestSequence}`
        pendingDataExportRequests.set(requestId, { resolve, reject })
        host.bridge.postMessage({
          type: 'dsh-portable/pick-data-export',
          schemaVersion: 1,
          requestId,
          kind,
        })
      })
    }

    function chooseDataImportPath() {
      const host = nativeHostTransport()
      if (!host || host.capabilities.openDataPackage !== true) return Promise.resolve(null)
      return new Promise((resolve, reject) => {
        const requestId = `data-import-${Date.now().toString(36)}-${++dataExportRequestSequence}`
        pendingDataImportRequests.set(requestId, { resolve, reject })
        host.bridge.postMessage({ type: 'dsh-portable/pick-data-import', schemaVersion: 1, requestId })
      })
    }

    function restartPortableHost() {
      const host = nativeHostTransport()
      if (!host || host.capabilities.restartHost !== true) return Promise.reject(new Error('Portable restart is unavailable on this host.'))
      return new Promise((resolve, reject) => {
        const requestId = `host-restart-${Date.now().toString(36)}-${++dataExportRequestSequence}`
        const timeout = setTimeout(() => {
          pendingHostRestartRequests.delete(requestId)
          const error = new Error('Portable restart request timed out before the host reply was received.')
          error.code = 'DSH_PORTABLE_RESTART_UNCONFIRMED'
          reject(error)
        }, 10000)
        pendingHostRestartRequests.set(requestId, {
          resolve: value => { clearTimeout(timeout); resolve(value) },
          reject: error => { clearTimeout(timeout); reject(error) },
        })
        try {
          host.bridge.postMessage({ type: 'dsh-portable/restart-host', schemaVersion: 1, requestId })
        } catch (cause) {
          pendingHostRestartRequests.delete(requestId)
          clearTimeout(timeout)
          const error = new Error('Portable restart request could not be confirmed by the host.', { cause })
          error.code = 'DSH_PORTABLE_RESTART_UNCONFIRMED'
          reject(error)
        }
      })
    }

    function openPortableEnvironment(environment) {
      const host = nativeHostTransport()
      if (!host || host.capabilities.openEnvironment !== true) return Promise.reject(new Error('Portable environments are unavailable on this host.'))
      return new Promise((resolve, reject) => {
        const requestId = `environment-open-${Date.now().toString(36)}-${++dataExportRequestSequence}`
        const timeout = setTimeout(() => {
          pendingEnvironmentRequests.delete(requestId)
          reject(new Error('Portable environment did not open in time.'))
        }, 10000)
        pendingEnvironmentRequests.set(requestId, {
          resolve: value => { clearTimeout(timeout); resolve(value) },
          reject: error => { clearTimeout(timeout); reject(error) },
        })
        host.bridge.postMessage({ type: 'dsh-portable/open-environment', schemaVersion: 1, requestId, environment })
      })
    }

    function PortableSelector({ value, items, onSelect, label, primitives }) {
      const h = React.createElement
      const [open, setOpen] = React.useState(false)
      const selected = items.find(item => item.id === value)
      const anchor = h('button', {
        type: 'button', className: 'dshPortableSelector', 'aria-label': label,
        'aria-haspopup': 'menu', 'aria-expanded': open,
        onClick: () => setOpen(current => !current),
      }, selected?.label || value, h(primitives.IconChevronDownOutline14, { className: 'dshPortableSelectorChevron' }))
      return h(primitives.Menu, {
        open, anchor, items, selectedId: value, align: 'end', portal: true,
        onClose: () => setOpen(false),
        onSelect: id => { setOpen(false); onSelect(id) },
      })
    }

    let portableShellSummary = null
    let portableShellSummaryPromise = null
    const portableShellSummaryListeners = new Set()

    function loadPortableShellSummary() {
      if (portableShellSummary) return Promise.resolve(portableShellSummary)
      if (portableShellSummaryPromise) return portableShellSummaryPromise
      portableShellSummaryPromise = fetch('/dsh-portable/settings', { cache: 'no-store' })
        .then(response => response.json())
        .then(async body => {
          const enabled = [
            body.settings?.productUpdateCheckEnabled ? 'product' : '',
            body.settings?.engineUpdateCheckEnabled ? 'engine' : '',
          ].filter(Boolean)
          const checks = await Promise.all(enabled.map(scope => fetch('/dsh-portable/check-update', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope, background: true }),
          }).then(response => response.json()).catch(() => null)))
          portableShellSummary = {
            environments: body.environments,
            availableScopes: enabled.filter((_scope, index) => ['available', 'full-package-required'].includes(checks[index]?.status)),
          }
          for (const listener of portableShellSummaryListeners) listener(portableShellSummary)
          return portableShellSummary
        })
        .catch(() => {
          portableShellSummary = { environments: null, availableScopes: [] }
          for (const listener of portableShellSummaryListeners) listener(portableShellSummary)
          return portableShellSummary
        })
        .finally(() => { portableShellSummaryPromise = null })
      return portableShellSummaryPromise
    }

    function usePortableShellSummary() {
      const [summary, setSummary] = React.useState(null)
      React.useEffect(() => {
        let active = true
        const update = value => { if (active) setSummary(value) }
        portableShellSummaryListeners.add(update)
        loadPortableShellSummary().then(update)
        return () => { active = false; portableShellSummaryListeners.delete(update) }
      }, [])
      return summary
    }

    function PortableUpdateAction({ wide, primitives }) {
      const h = React.createElement
      const summary = usePortableShellSummary()
      const scopes = summary?.availableScopes || []
      if (scopes.length === 0) return null
      const lang = String(document.documentElement.lang || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
      const label = copy[lang].updateReady
      return h('div', { className: 'dshPortableFooterUpdate' },
        h(primitives.Tooltip, { label, side: 'top' }, h('button', {
          type: 'button', className: 'dshPortableFooterUpdateButton', 'aria-label': label,
          onClick: () => postToNativeHost({ type: 'dsh-portable/open-update', schemaVersion: 1, scope: scopes.includes('product') ? 'product' : 'engine' }, 'openUpdate'),
        }, h(primitives.IconDownloadOutline16, { size: 16 }), h('span', { className: 'dshPortableUpdateDot', 'aria-hidden': true }))))
    }

    function PortableEnvironmentChip({ primitives }) {
      const h = React.createElement
      const summary = usePortableShellSummary()
      const environments = summary?.environments
      if (!environments || environments.current === 'default') return null
      const current = environments.items?.find(item => item.id === environments.current)
      const name = current?.name || environments.current
      const lang = String(document.documentElement.lang || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
      const label = format(copy[lang].environmentActive, name)
      return h('span', { className: 'dshPortableEnvironmentChip', title: label, 'aria-label': label },
        h(primitives.IconFolderOpenOutline16, { size: 14 }), h('span', null, name))
    }

    function PortableSettings(ctx, primitives) {
      const h = React.createElement
      const useEffect = React.useEffect
      const useState = React.useState
      const lang = localeOf(ctx)
      const t = key => copy[lang][key] || key
      const [settings, setSettings] = useState(null)
      const [versions, setVersions] = useState({ portable: '', engine: '' })
      const [lastUpdate, setLastUpdate] = useState(null)
      const [notificationAvailability, setNotificationAvailability] = useState('unknown')
      const [engineVersions, setEngineVersions] = useState([])
      const [engineVersion, setEngineVersion] = useState('')
      const [engineVersionManifestUrls, setEngineVersionManifestUrls] = useState({})
      const [environments, setEnvironments] = useState({ current: 'default', items: [{ id: 'default', name: '' }] })
      const [busy, setBusy] = useState('')
      const [messages, setMessages] = useState({})
      const [privatePassword, setPrivatePassword] = useState('')
      const [privatePasswordConfirm, setPrivatePasswordConfirm] = useState('')
      const [importPassword, setImportPassword] = useState('')
      const [importState, setImportState] = useState(null)
      const [maintenanceMenuOpen, setMaintenanceMenuOpen] = useState(false)
      const [dataDialog, setDataDialog] = useState('')
      const [environmentDialog, setEnvironmentDialog] = useState(false)
      const [environmentName, setEnvironmentName] = useState('')
      const environmentsSupported = nativeHostTransport()?.capabilities.openEnvironment === true
      const statusRefs = React.useRef({})
      const setStatus = (key, value) => {
        setMessages(current => ({ ...current, [key]: value }))
        if (value) requestAnimationFrame(() => statusRefs.current[key]?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }))
      }
      useEffect(() => {
        let active = true
        fetch('/dsh-portable/settings', { cache: 'no-store' })
          .then(res => res.json()).then(body => {
            if (!active) return
            setSettings(body.settings)
            setVersions(body.versions || { portable: '', engine: '' })
            setLastUpdate(body.lastUpdate || null)
            setNotificationAvailability(body.notificationAvailability?.status || 'unknown')
            if (body.environments) setEnvironments(body.environments)
            if (body.lastRepair?.needsFullPackage) setStatus('maintenance', t('fullPackage'))
            else if (body.lastRepair?.ok) setStatus('maintenance', t('repaired'))
          })
          .catch(error => { if (active) setStatus('portable', format(t('failed'), error.message || error)) })
        return () => { active = false }
      }, [])
      useEffect(() => {
        let active = true
        fetch('/dsh-portable/engine-versions', { cache: 'no-store' }).then(res => res.json()).then(body => {
          if (!active || body.error) return
          const items = Array.isArray(body.versions) ? body.versions : []
          setEngineVersions(items)
          setEngineVersion(body.current || '')
          setEngineVersionManifestUrls(Object.fromEntries(items.map(item => [item.version, item.manifestUrl])))
        }).catch(() => {})
        return () => { active = false }
      }, [settings?.updateChannel])

      const update = patch => {
        setSettings(current => ({ ...current, ...patch }))
        fetch('/dsh-portable/settings', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
        }).then(res => res.json()).then(body => {
          if (body.error) throw new Error(body.error)
          setSettings(body.settings)
          postToNativeHost({ type: 'dsh-portable/preferences', schemaVersion: 1, ...body.settings }, 'preferences')
        }).catch(error => setStatus('portable', format(t('failed'), error.message || error)))
      }
      const openEnvironment = async id => {
        if (id === environments.current) return
        const item = environments.items.find(candidate => candidate.id === id)
        try {
          await openPortableEnvironment(id)
          setStatus('environment', format(t('environmentOpened'), item?.name || id))
        } catch (error) { setStatus('environment', format(t('failed'), error.message || error)) }
      }
      const createEnvironment = async () => {
        if (!environmentName.trim()) return
        setBusy('environment-create')
        try {
          const response = await fetch('/dsh-portable/environments', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: environmentName }),
          })
          const body = await response.json()
          if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
          const nextEnvironments = { current: body.current, items: body.items }
          setEnvironments(nextEnvironments)
          setEnvironmentDialog(false)
          setEnvironmentName('')
          await openPortableEnvironment(body.created.id)
          setStatus('environment', format(t('environmentOpened'), body.created.name || body.created.id))
        } catch (error) { setStatus('environment', format(t('failed'), error.message || error)) }
        finally { setBusy('') }
      }
      const action = (name, path) => {
        setBusy(name); setStatus('maintenance', '')
        fetch(path, { method: 'POST' }).then(res => res.json()).then(body => {
          if (body.error) throw new Error(body.error)
          if (name === 'doctor') {
            const count = (body.checks || []).filter(item => item.status !== 'ok').length
            setStatus('maintenance', body.needsFullPackage ? t('fullPackage') : count ? format(t('issues'), count) : t('healthy'))
          } else if (name === 'repair') setStatus('maintenance', t('scheduled'))
          else setStatus('maintenance', format(t('exported'), body.output || ''))
        }).catch(error => setStatus('maintenance', format(t('failed'), error.message || error))).finally(() => setBusy(''))
      }
      const exportSupportReport = async () => {
        setBusy('report'); setStatus('maintenance', '')
        try {
          const output = await chooseDataExportPath('support')
          if (!output) return
          const response = await fetch('/dsh-portable/support-report', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ output }),
          })
          const body = await response.json()
          if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
          setStatus('maintenance', format(t('exported'), body.output || output))
        } catch (error) { setStatus('maintenance', format(t('failed'), error.message || error)) }
        finally { setBusy('') }
      }
      const checkUpdate = scope => {
        if (scope === 'engine' && engineVersion && engineVersion !== versions.engine && engineVersionManifestUrls[engineVersion]) {
          postToNativeHost({
            type: 'dsh-portable/open-update', schemaVersion: 1, scope: 'engine',
            manifestUrl: engineVersionManifestUrls[engineVersion],
          }, 'openUpdate')
          return
        }
        const name = `update-${scope}`
        setBusy(name); setStatus(name, '')
        fetch('/dsh-portable/check-update', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope }),
        }).then(res => res.json()).then(body => {
          if (body.error) throw new Error(body.error)
          if (body.status === 'current') setStatus(name, t('current'))
          else if (body.status === 'available' || body.status === 'full-package-required') setStatus(name, format(t('available'), body.latest || ''))
          else if (body.status === 'core-incompatible') setStatus(name, t('incompatible'))
          else if (body.status === 'engine-follows-product') setStatus(name, t('engineFollowsProduct'))
          else if (body.status === 'channel-unpublished') setStatus(name, t('channelUnpublished'))
          else setStatus(name, t('updateUnavailable'))
        }).catch(error => setStatus(name, format(t('failed'), error.message || error))).finally(() => setBusy(''))
      }
      const closePrivateDialog = () => {
        setDataDialog('')
        setPrivatePassword('')
        setPrivatePasswordConfirm('')
      }
      const closeImportDialog = () => {
        setDataDialog('')
        setImportPassword('')
        setImportState(null)
      }
      const inspectImport = async (input, password = '') => {
        const response = await fetch('/dsh-portable/data-inspect', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input, password: password || undefined }),
        })
        const body = await response.json()
        return { response, body }
      }
      const beginImport = async () => {
        setBusy('data-import')
        setStatus('data', '')
        try {
          const input = await chooseDataImportPath()
          if (!input) return
          const { response, body } = await inspectImport(input)
          if (response.status === 401 && body.requiresPassword) {
            setImportState({ input, info: null })
            setDataDialog('import-password')
            return
          }
          if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
          setImportState({ input, info: body })
          setDataDialog('import-confirm')
        } catch (error) { setStatus('data', format(t('failed'), error.message || error)) }
        finally { setBusy('') }
      }
      const unlockImport = async () => {
        if (!importState?.input || importPassword.length < 8) return
        setBusy('data-import')
        try {
          const { response, body } = await inspectImport(importState.input, importPassword)
          if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
          setImportState({ ...importState, info: body })
          setDataDialog('import-confirm')
        } catch (error) { setStatus('data', format(t('failed'), error.message || error)) }
        finally { setBusy('') }
      }
      const runImport = () => {
        const host = nativeHostTransport()
        if (!host || host.capabilities.importData !== true || !importState?.input) {
          setStatus('data', format(t('failed'), 'desktop host unavailable'))
          return
        }
        setBusy('data-import-run')
        host.bridge.postMessage({
          type: 'dsh-portable/import-data', schemaVersion: 1,
          input: importState.input, password: importPassword || undefined, conflict: 'replace',
        })
      }
      const exportData = async kind => {
        const name = `data-${kind}`
        setBusy(name)
        setStatus('data', '')
        try {
          const output = await chooseDataExportPath(kind)
          if (output === null) return
          const res = await fetch('/dsh-portable/data-export', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind, output: output || undefined, password: kind === 'private' ? privatePassword : undefined }),
          })
          const body = await res.json()
          if (body.error) throw new Error(body.error)
          setStatus('data', format(t('dataSaved'), body.output || ''))
          if (kind === 'private') closePrivateDialog()
        } catch (error) {
          setStatus('data', format(t('failed'), error.message || error))
        } finally {
          setBusy('')
        }
      }
      const styles = {
        group: { borderBottom: '1px solid var(--dsw-alias-border-l2)', display: 'flex', flexDirection: 'column', padding: '20px 0 8px' },
        heading: { color: 'var(--dsw-alias-label-primary)', fontSize: 14, fontWeight: 500, lineHeight: '22px', marginBottom: 0 },
        section: { display: 'flex', flexDirection: 'column', gap: 0, marginTop: 18 },
        sectionHeading: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, fontWeight: 500, lineHeight: '18px', padding: 0 },
        item: { display: 'flex', gap: 16, alignItems: 'center', padding: '14px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)', flexWrap: 'wrap' },
        text: { display: 'flex', flex: '1 1 260px', minWidth: 0, flexDirection: 'column', gap: 4 },
        label: { color: 'var(--dsw-alias-label-primary)', fontSize: 14, fontWeight: 400, lineHeight: '22px' },
        hint: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: '18px' },
        controls: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 },
        status: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: '18px', marginTop: 8, wordBreak: 'break-word' },
        modalFields: { display: 'flex', flexDirection: 'column', gap: 14, width: '100%', minWidth: 0 },
        modalField: { display: 'flex', flexDirection: 'column', gap: 6, width: '100%', minWidth: 0 },
        modalInput: { width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' },
        modalLabel: { color: 'var(--dsw-alias-label-primary)', fontSize: 13, lineHeight: '20px' },
        modalError: { color: 'var(--dsw-alias-status-error)', fontSize: 12, lineHeight: '18px' },
        importFileHeading: { color: 'var(--dsw-alias-label-primary)', fontSize: 12, fontWeight: 500, lineHeight: '18px', marginTop: 12 },
        importFileList: { maxHeight: 160, overflowY: 'auto', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '8px 10px', marginTop: 6 },
        importFile: { color: 'var(--dsw-alias-label-secondary)', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 11, lineHeight: '18px', overflowWrap: 'anywhere' },
        version: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap' },
        rowActions: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flex: '0 1 auto' },
      }
      const inlineStatus = key => messages[key]
        ? h('div', { ref: node => { statusRefs.current[key] = node }, style: styles.status, role: 'status', 'aria-live': 'polite' }, messages[key])
        : null
      if (!settings) return h('div', { style: styles.group }, h('div', { style: styles.heading }, t('title')), h('div', { style: styles.hint }, t('checking')))
      const booleanRow = (key, title, hint) => h('div', { style: styles.item },
        h('div', { style: styles.text }, h('div', { style: styles.label }, title), h('div', { style: styles.hint }, hint)),
        h(PortableSelector, {
          primitives, value: settings[key] ? 'on' : 'off', label: title,
          items: [{ id: 'off', label: t('off') }, { id: 'on', label: t('on') }],
          onSelect: value => update({ [key]: value === 'on' }),
        }))
      const updateRow = (scope, key, title, version, hint) => h('div', { style: styles.item },
        h('div', { style: styles.text }, h('div', { style: styles.label }, title),
          h('div', { style: styles.hint }, hint),
          version && h('div', { style: styles.version }, format(t('currentVersion'), version)),
          inlineStatus(`update-${scope}`)),
        h('div', { style: styles.rowActions },
          scope === 'engine' && engineVersions.length > 0 && h(PortableSelector, {
            primitives, value: engineVersion || version, label: t('versionChoice'),
            items: [{ id: version, label: version }, ...engineVersions.filter(item => item.version !== version).map(item => ({ id: item.version, label: item.version }))],
            onSelect: setEngineVersion,
          }),
          h(PortableSelector, {
            primitives, value: settings[key] ? 'on' : 'off', label: `${title} · ${t('startupCheck')}`,
            items: [{ id: 'off', label: t('off') }, { id: 'on', label: t('on') }],
            onSelect: value => update({ [key]: value === 'on' }),
          }),
          h(primitives.Button, { size: 'sm', disabled: Boolean(busy), onClick: () => checkUpdate(scope) },
            busy === `update-${scope}` ? t('checking') : scope === 'engine' && engineVersion && engineVersion !== version ? t('installVersion') : t('checkUpdate'))))
      const updatesSection = h('section', { style: styles.section, 'aria-label': t('updates') },
        h('div', { style: styles.sectionHeading }, t('updates')),
        h('div', { style: styles.item },
          h('div', { style: styles.text },
            h('div', { style: styles.label }, t('updateChannel')),
            h('div', { style: styles.hint }, t('updateChannelHint')),
            h('div', { style: styles.hint }, t('updateRecovery')),
            lastUpdate?.status === 'rolled-back' && h('div', { style: styles.status, role: 'status' },
              format(t('updateRolledBack'), lastUpdate.restoredVersion || t('previousVersion')))),
          h(PortableSelector, {
            primitives, value: settings.updateChannel || 'stable', label: t('updateChannel'),
            items: [{ id: 'stable', label: t('stableChannel') }, { id: 'candidate', label: t('betaChannel') }],
            onSelect: updateChannel => {
              setMessages(current => ({ ...current, 'update-product': '', 'update-engine': '' }))
              update({ updateChannel })
            },
          })),
        updateRow('product', 'productUpdateCheckEnabled', t('product'), versions.portable, t('productHint')),
        updateRow('engine', 'engineUpdateCheckEnabled', t('engine'), versions.engine, t('engineHint')))
      const environmentItems = environments.items.map(item => ({
        id: item.id,
        label: item.id === 'default' ? t('defaultEnvironment') : item.name || item.id,
      }))
      const environmentSection = environmentsSupported && h('section', { style: styles.section, 'aria-label': t('environments') },
        h('div', { style: styles.sectionHeading }, t('environments')),
        h('div', { style: styles.item },
          h('div', { style: styles.text },
            h('div', { style: styles.label }, t('environmentTitle')),
            h('div', { style: styles.hint }, t('environmentHint')),
            inlineStatus('environment')),
          h('div', { style: styles.rowActions },
            h(PortableSelector, {
              primitives, value: environments.current, label: t('environmentTitle'), items: environmentItems,
              onSelect: openEnvironment,
            }),
            h(primitives.Button, { size: 'sm', variant: 'outline', disabled: Boolean(busy), onClick: () => setEnvironmentDialog(true) }, t('newEnvironment')))))
      const desktopSection = h('section', { style: styles.section, 'aria-label': t('desktop') },
        h('div', { style: styles.sectionHeading }, t('desktop')),
        booleanRow('taskNotificationsEnabled', t('notifications'), notificationAvailability === 'disabled-system' ? t('notificationsSystemDisabled') : t('notificationsHint')),
        h('div', { style: styles.item },
          h('div', { style: styles.text }, h('div', { style: styles.label }, t('close'))),
          h(PortableSelector, {
            primitives, value: settings.closeBehavior, label: t('close'),
            items: [{ id: 'tray', label: t('tray') }, { id: 'exit', label: t('exit') }],
            onSelect: closeBehavior => update({ closeBehavior }),
          })))
      const maintenanceMenu = h(primitives.Menu, {
        open: maintenanceMenuOpen,
        anchor: h(primitives.Button, { size: 'sm', variant: 'outline', disabled: Boolean(busy), onClick: () => setMaintenanceMenuOpen(current => !current) }, t('more')),
        align: 'end', portal: true,
        items: [{ id: 'repair', label: t('repair') }, { id: 'report', label: t('report') }],
        onClose: () => setMaintenanceMenuOpen(false),
        onSelect: id => {
          setMaintenanceMenuOpen(false)
          if (id === 'repair') action('repair', '/dsh-portable/repair')
          else if (id === 'report') exportSupportReport()
        },
      })
      const careSection = h('section', { style: styles.section, 'aria-label': t('care') },
        h('div', { style: styles.sectionHeading }, t('care')),
        h('div', { style: styles.item },
          h('div', { style: styles.text },
            h('div', { style: styles.label }, t('maintenance')),
            h('div', { style: styles.hint }, t('maintenanceHint')),
            inlineStatus('maintenance')),
          h('div', { style: styles.rowActions },
            h(primitives.Button, { size: 'sm', disabled: Boolean(busy), onClick: () => action('doctor', '/dsh-portable/doctor') }, busy === 'doctor' ? t('checking') : t('check')),
            maintenanceMenu)))
      const privatePasswordMismatch = privatePasswordConfirm.length > 0 && privatePassword !== privatePasswordConfirm
      const environmentCreateDialog = environmentDialog ? h(primitives.Modal, {
        open: true,
        onClose: () => { setEnvironmentDialog(false); setEnvironmentName('') },
        title: t('newEnvironment'),
        description: t('environmentHint'),
        footer: h(React.Fragment, null,
          h(primitives.Button, { variant: 'ghost', disabled: Boolean(busy), onClick: () => { setEnvironmentDialog(false); setEnvironmentName('') } }, t('cancel')),
          h(primitives.Button, { variant: 'primary', disabled: Boolean(busy) || !environmentName.trim(), onClick: createEnvironment }, busy === 'environment-create' ? t('checking') : t('createEnvironment'))),
      }, h('label', { style: styles.modalField },
        h('span', { style: styles.modalLabel }, t('environmentName')),
        h(primitives.Input, { style: styles.modalInput, maxLength: 40, value: environmentName, onChange: event => setEnvironmentName(event.target.value), autoFocus: true }))) : null
      const privateDialog = dataDialog === 'private' ? h(primitives.Modal, {
        open: true,
        onClose: closePrivateDialog,
        title: t('dataPrivate'),
        description: t('dataPrivateDialogHint'),
        footer: h(React.Fragment, null,
          h(primitives.Button, { variant: 'ghost', disabled: Boolean(busy), onClick: closePrivateDialog }, t('cancel')),
          h(primitives.Button, {
            variant: 'primary',
            disabled: Boolean(busy) || privatePassword.length < 8 || privatePassword !== privatePasswordConfirm,
            onClick: () => exportData('private'),
          }, busy === 'data-private' ? t('checking') : t('exportNow'))),
      }, h('div', { style: styles.modalFields },
        h('label', { style: styles.modalField },
          h('span', { style: styles.modalLabel }, t('dataPassword')),
          h(primitives.Input, { style: styles.modalInput, type: 'password', autoComplete: 'new-password', value: privatePassword, onChange: event => setPrivatePassword(event.target.value), autoFocus: true })),
        h('label', { style: styles.modalField },
          h('span', { style: styles.modalLabel }, t('dataPasswordConfirm')),
          h(primitives.Input, { style: styles.modalInput, type: 'password', autoComplete: 'new-password', value: privatePasswordConfirm, onChange: event => setPrivatePasswordConfirm(event.target.value) })),
        privatePasswordMismatch && h('div', { style: styles.modalError, role: 'alert' }, t('dataPasswordMismatch')),
        h('div', { style: styles.hint }, t('chooseSaveLocation')))) : null
      const importPasswordDialog = dataDialog === 'import-password' ? h(primitives.Modal, {
        open: true, onClose: closeImportDialog, title: t('dataImportPassword'), description: t('dataImportPasswordHint'),
        footer: h(React.Fragment, null,
          h(primitives.Button, { variant: 'ghost', disabled: Boolean(busy), onClick: closeImportDialog }, t('cancel')),
          h(primitives.Button, { variant: 'primary', disabled: Boolean(busy) || importPassword.length < 8, onClick: unlockImport }, busy ? t('checking') : t('dataImportReview'))),
      }, h('label', { style: styles.modalField },
        h('span', { style: styles.modalLabel }, t('dataPassword')),
        h(primitives.Input, { style: styles.modalInput, type: 'password', autoComplete: 'current-password', value: importPassword, onChange: event => setImportPassword(event.target.value), autoFocus: true }))) : null
      const importInfo = importState?.info
      const importPreviewFiles = Array.isArray(importInfo?.files) ? importInfo.files.map(String).slice(0, 80) : []
      const hiddenImportFileCount = Array.isArray(importInfo?.files) ? Math.max(0, importInfo.files.length - importPreviewFiles.length) : 0
      const importConfirmDialog = dataDialog === 'import-confirm' && importInfo ? h(primitives.Modal, {
        open: true, onClose: closeImportDialog, title: t('dataImportReview'),
        description: format(t('dataImportReviewHint'), Array.isArray(importInfo.files) ? importInfo.files.length : 0),
        footer: h(React.Fragment, null,
          h(primitives.Button, { variant: 'ghost', disabled: Boolean(busy), onClick: closeImportDialog }, t('cancel')),
          h(primitives.Button, { variant: 'primary', disabled: Boolean(busy), onClick: runImport }, busy === 'data-import-run' ? t('dataImporting') : t('dataImportRestart'))),
      }, h('div', null,
        h('div', { style: styles.hint }, format(t('dataImportCategories'), (importInfo.categories || []).join(', '))),
        h('div', { style: styles.importFileHeading }, t('dataImportFiles')),
        h('div', { style: styles.importFileList },
          importPreviewFiles.map(file => h('div', { key: file, style: styles.importFile }, file)),
          hiddenImportFileCount > 0 && h('div', { style: styles.importFile }, format(t('dataImportMoreFiles'), hiddenImportFileCount))))) : null
      const dataSection = h('section', { style: styles.section, 'aria-label': t('data') },
        h('div', { style: styles.sectionHeading }, t('data')),
        h('div', { style: styles.item },
          h('div', { style: styles.text }, h('div', { style: styles.label }, t('dataTitle')), h('div', { style: styles.hint }, t('dataHint')), inlineStatus('data')),
          h('div', { style: styles.rowActions },
            h(primitives.Button, { size: 'sm', variant: 'outline', title: t('dataImportHint'), disabled: Boolean(busy), onClick: beginImport }, t('dataImport')),
            h(primitives.Button, { size: 'sm', variant: 'outline', title: t('dataStandardHint'), disabled: Boolean(busy), onClick: () => exportData('standard') }, busy === 'data-standard' ? t('checking') : t('dataStandard')),
            h(primitives.Button, { size: 'sm', variant: 'outline', title: t('dataPrivateHint'), disabled: Boolean(busy), onClick: () => setDataDialog('private') }, t('dataPrivate')))))
      return h('div', { style: styles.group },
        h('div', { style: styles.heading }, t('title')),
        inlineStatus('portable'),
        environmentSection,
        updatesSection,
        desktopSection,
        careSection,
        dataSection,
        environmentCreateDialog,
        privateDialog,
        importPasswordDialog,
        importConfirmDialog)
    }

    function localeOf(ctx) {
      const active = String(ctx.locale.getLocale()?.active ?? '').toLowerCase()
      return active.startsWith('zh') ? 'zh' : 'en'
    }

    function themeOf(ctx) {
      return ctx.theme.getTheme()?.active?.colorScheme === 'dark' ? 'dark' : 'light'
    }

    function finalAssistantReply(ctx, sessionId) {
      const entries = ctx.sessions.binding?.(sessionId)?.eventSource?.getSnapshot?.()?.entries
      if (!Array.isArray(entries)) return ''
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        const event = entry?.type === 'event' ? entry.event : entry
        if (event?.type !== 'assistant/message') continue
        const content = event.data?.message?.content
        if (!Array.isArray(content)) continue
        const text = content
          .filter(block => block?.type === 'text' && typeof block.text === 'string')
          .map(block => block.text)
          .join('')
          .trim()
        if (text !== '') return text.slice(0, 32768)
      }
      return ''
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
        .map(item => {
          const completed = Boolean(item.completed)
          return {
            id: String(item.id),
            title: String(item.displayTitle || item.title || item.id),
            updatedAt: Number(item.updatedAt || 0),
            running: Boolean(item.running),
            completed,
            finalReply: completed ? finalAssistantReply(ctx, item.id) : '',
            pendingInteraction: item.pendingInteraction == null ? '' : String(item.pendingInteraction),
            agentPreset: item.agentPreset == null ? '' : String(item.agentPreset),
          }
        })
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

    async function ensurePortableWorkspace(ctx, workspacePath) {
      const target = String(workspacePath || '').trim()
      if (!target || !ctx.workspaces?.list?.getSnapshot || typeof ctx.workspaces.create !== 'function') return { status: 'unavailable' }
      let snapshot = ctx.workspaces.list.getSnapshot()
      if (!snapshot.baselinesReady) {
        snapshot = await new Promise(resolve => {
          const stop = ctx.workspaces.list.subscribe(() => {
            const next = ctx.workspaces.list.getSnapshot()
            if (!next.baselinesReady) return
            stop?.()
            resolve(next)
          })
        })
      }
      if ((snapshot.items || []).length > 0) return { status: 'preserved' }
      if (ctx.sessions?.list?.getSnapshot?.().current !== undefined) return { status: 'preserved' }
      const workspace = await ctx.workspaces.create({ path: target })
      if (workspace?.workspaceId && typeof ctx.workspaces.startSession === 'function') {
        ctx.workspaces.startSession(workspace.workspaceId)
      }
      return { status: 'created', workspaceId: workspace?.workspaceId }
    }

    function apply(ctx) {
      const host = nativeHostTransport()
      if (React?.createElement && React?.useState && React?.useEffect) {
        try {
          const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
          if (primitives?.Button && primitives?.Input && primitives?.Menu && primitives?.Modal && primitives?.Tooltip
            && primitives?.IconChevronDownOutline14 && primitives?.IconDownloadOutline16 && primitives?.IconFolderOpenOutline16) {
            if (!document.getElementById('dsh-portable-settings-controls')) {
              const style = document.createElement('style')
              style.id = 'dsh-portable-settings-controls'
              style.textContent = '.dshPortableSelector{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:18px;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex;white-space:nowrap}.dshPortableSelector:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshPortableSelectorChevron{flex:none}.dshPortableFooterUpdate{flex:none;align-items:center;align-self:flex-end;width:36px;height:36px;margin:0 0 -36px auto;display:flex;position:relative;z-index:1}.dshPortableFooterUpdateButton{width:36px;height:36px;color:var(--dsw-alias-label-primary);cursor:pointer;background:transparent;border:0;border-radius:50%;justify-content:center;align-items:center;padding:0;font:inherit;display:inline-flex;position:relative}.dshPortableFooterUpdateButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshPortableUpdateDot{position:absolute;right:4px;top:4px;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}.dshPortableEnvironmentChip{height:28px;max-width:180px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover-solid);border-radius:14px;align-items:center;gap:6px;padding:0 10px;font-size:13px;line-height:20px;display:inline-flex}.dshPortableEnvironmentChip span{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}'
              document.head.appendChild(style)
            }
            const SettingsSection = () => PortableSettings(ctx, primitives)
            ctx.slots.inject('settings.general.item', () => ctx.slots.register({
              name: 'settings.general.item', id: 'portable', order: 60,
            }, SettingsSection))
            const UpdateAction = props => PortableUpdateAction({ ...props, primitives })
            ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
              name: 'sidebar.footer.action', id: 'portable-update', order: 80, label: () => copy[localeOf(ctx)].updateReady,
            }, UpdateAction))
            const EnvironmentChip = () => PortableEnvironmentChip({ primitives })
            ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
              name: 'conversation.input.left', id: 'portable-environment', order: 80,
            }, EnvironmentChip))
          }
        } catch (error) { console.warn('[dsh-portable] settings section unavailable:', error) }
      }
      if (!host) return
      const webview = host.bridge

      window.__DSH_PORTABLE_HOST__ = { restart: restartPortableHost }
      window.__DSH_PORTABLE_HOST__.capabilities = host.capabilities

      ctx.effect(() => {
        let active = true
        const sessionEventStops = new Map()
        let workspaceRequestSequence = 0
        const pendingWorkspaceRequests = new Map()
        const originalPickDirectory = ctx.workspaces?.pickDirectory
        let nativePickDirectory = null
        if (host.capabilities.pickDirectory === true && ctx.workspaces && typeof originalPickDirectory === 'function') {
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
        const syncSessionEventSubscriptions = () => {
          const snapshot = ctx.sessions.list.getSnapshot()
          const desired = new Set((snapshot.ids ?? [])
            .map(id => snapshot.byId?.[id])
            .filter(item => item && !item.blank && item.origin !== 'subagent')
            .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
            .slice(0, 10)
            .map(item => String(item.id)))
          for (const [id, stop] of sessionEventStops) {
            if (desired.has(id)) continue
            stop?.()
            sessionEventStops.delete(id)
          }
          for (const id of desired) {
            if (sessionEventStops.has(id)) continue
            const eventSource = ctx.sessions.binding?.(id)?.eventSource
            if (typeof eventSource?.subscribe !== 'function') continue
            sessionEventStops.set(id, eventSource.subscribe(() => queueMicrotask(publish)))
          }
        }
        const publish = () => {
          syncSessionEventSubscriptions()
          if (active && host.capabilities.sessionProjection === true) webview.postMessage(sessionState(ctx))
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
          if (message.type === 'dsh-portable/pick-data-export-result' && message.schemaVersion === 1) {
            const requestId = String(message.requestId || '')
            const pending = pendingDataExportRequests.get(requestId)
            if (!pending) return
            pendingDataExportRequests.delete(requestId)
            if (message.error) pending.reject(new Error(String(message.error)))
            else pending.resolve(message.cancelled ? null : String(message.path || '') || null)
            return
          }
          if (message.type === 'dsh-portable/pick-data-import-result' && message.schemaVersion === 1) {
            const requestId = String(message.requestId || '')
            const pending = pendingDataImportRequests.get(requestId)
            if (!pending) return
            pendingDataImportRequests.delete(requestId)
            if (message.error) pending.reject(new Error(String(message.error)))
            else pending.resolve(message.cancelled ? null : String(message.path || '') || null)
            return
          }
          if (message.type === 'dsh-portable/restart-host-result' && message.schemaVersion === 1) {
            const requestId = String(message.requestId || '')
            const pending = pendingHostRestartRequests.get(requestId)
            if (!pending) return
            pendingHostRestartRequests.delete(requestId)
            if (message.ok === true) pending.resolve(message)
            else {
              const error = new Error(String(message.error || 'Portable restart was refused.'))
              error.code = 'DSH_PORTABLE_RESTART_REJECTED'
              pending.reject(error)
            }
            return
          }
          if (message.type === 'dsh-portable/open-environment-result' && message.schemaVersion === 1) {
            const requestId = String(message.requestId || '')
            const pending = pendingEnvironmentRequests.get(requestId)
            if (!pending) return
            pendingEnvironmentRequests.delete(requestId)
            if (message.ok === true) pending.resolve(message)
            else pending.reject(new Error(String(message.error || 'Portable environment could not be opened.')))
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
          if (message.action === 'reply-session') {
            const sessionId = String(message.sessionId || '')
            const reply = typeof message.reply === 'string' ? message.reply.trim() : ''
            if (reply === '' || reply.length > 8000 || reply.includes('\0')) return
            const snapshot = ctx.sessions.list.getSnapshot()
            if (!snapshot.byId?.[sessionId] || snapshot.byId[sessionId].origin === 'subagent') return
            const scoped = ctx.sessions.scope?.(sessionId)
            if (typeof scoped?.conversation?.send !== 'function') return
            void scoped.conversation.send(reply).catch(error => console.warn('[dsh-portable] notification reply failed:', error))
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

        if (typeof fetch === 'function') {
          fetch('/dsh-portable/settings', { cache: 'no-store' })
            .then(response => response.json())
            .then(body => active && ensurePortableWorkspace(ctx, body.workspacePath))
            .catch(error => { if (active) console.warn('[dsh-portable] default workspace unavailable:', error) })
        }

        return () => {
          active = false
          if (ctx.workspaces?.pickDirectory === nativePickDirectory && typeof originalPickDirectory === 'function') {
            ctx.workspaces.pickDirectory = originalPickDirectory
          }
          for (const pending of pendingWorkspaceRequests.values()) pending.resolve(null)
          pendingWorkspaceRequests.clear()
          for (const pending of pendingDataExportRequests.values()) pending.resolve(null)
          pendingDataExportRequests.clear()
          for (const pending of pendingDataImportRequests.values()) pending.resolve(null)
          pendingDataImportRequests.clear()
          for (const pending of pendingHostRestartRequests.values()) {
            const error = new Error('Portable host closed before the restart reply was received.')
            error.code = 'DSH_PORTABLE_RESTART_UNCONFIRMED'
            pending.reject(error)
          }
          pendingHostRestartRequests.clear()
          for (const pending of pendingEnvironmentRequests.values()) pending.reject(new Error('Portable host closed.'))
          pendingEnvironmentRequests.clear()
          if (window.__DSH_PORTABLE_HOST__?.restart === restartPortableHost) delete window.__DSH_PORTABLE_HOST__
          webview.removeEventListener?.('message', receive)
          stopSessions?.()
          for (const stop of sessionEventStops.values()) stop?.()
          sessionEventStops.clear()
          stopLocale?.()
          stopTheme?.()
        }
      })
    }

    exports.inject = inject
    exports.finalAssistantReply = finalAssistantReply
    exports.ensurePortableWorkspace = ensurePortableWorkspace
    exports.apply = apply
    return exports
  },
})
