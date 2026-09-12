window.__ModuleLoader__.load({
  id: 'dsh-portable-appshots',
  factory(require) {
    const React = require('react'), h = React.createElement
    const ui = require('@deepseek-ai/dsh-client-ui-primitives')

    // Deliberately isolated rc.2 compatibility seam. No DOM paste simulation or upstream patch.
    function addFilesToDraft(conversation, sessionId, actions, input, limits, files) {
      if (!conversation?.createDrafts || !conversation?.releaseDraftAttachments || !conversation?.resolveDraftAttachments || !actions?.addAttachments) throw new Error('This core does not expose the required attachment adapter.')
      if (!input || ['adjudicating', 'submitting'].includes(input.phase)) throw new Error('The composer is busy. Try again after it finishes submitting.')
      const images = files.filter(file => file.type === 'image/png')
      if (images.length) {
        if (!limits?.mediaTypes?.includes('image/png')) throw new Error('The current session has not enabled PNG image input.')
        const existing = conversation.resolveDraftAttachments(input.attachmentIds || []).filter(item => item.kind === 'image')
        if (existing.length + images.length > limits.maxImagesPerMessage || images.some(file => file.size > limits.maxImageBytes)
          || existing.reduce((n, item) => n + item.file.size, 0) + images.reduce((n, file) => n + file.size, 0) > limits.maxMessageImageBytes)
          throw new Error('The Appshot exceeds this session’s image limits.')
      }
      const drafts = []
      try {
        for (const file of files) drafts.push(...conversation.createDrafts(sessionId, [file]))
        if (!actions.addAttachments(drafts.map(draft => draft.id))) throw new Error('The composer could not accept attachments.')
      } catch (error) { conversation.releaseDraftAttachments(drafts); throw error }
    }

    function apply(ctx) {
      let snapshot = { ready: false, capture: null }, open = false, disposed = false, generation = 0
      const listeners = new Set(), composers = new Map()
      const notify = () => { for (const listener of listeners) listener() }
      const refresh = async autoOpen => {
        const sequence = ++generation
        try {
          const response = await fetch('/portable-appshots/pending', { cache: 'no-store' })
          if (!response.ok) return
          const next = await response.json()
          if (disposed || sequence !== generation) return
          snapshot = next; if (autoOpen && next.capture?.preview) open = true; notify()
        } catch { if (!disposed) { snapshot = { ...snapshot, ready: false }; notify() } }
      }
      const dismiss = async (id = snapshot.capture?.id) => {
        // Hide the consumed capture immediately: a cleanup failure must not duplicate attachments.
        if (snapshot.capture?.id === id) { snapshot = { ...snapshot, capture: null }; open = false; notify() }
        try { await fetch('/portable-appshots/dismiss', { method: 'POST', headers: { 'x-appshot-id': id || '' } }) } catch {}
      }
      const useRefresh = () => { const [, redraw] = React.useState(0); React.useEffect(() => { const update = () => redraw(n => n + 1); listeners.add(update); return () => listeners.delete(update) }, []) }
      const zh = () => String(ctx.locale.getLocale()?.active || '').startsWith('zh')
      const label = (cn, en) => zh() ? cn : en
      function Composer(props) {
        const input = props.useInput(s => s), limits = props.useProjection('imageLimits')
        const session = props.useSession(s => s)
        React.useEffect(() => {
          const entry = { input, limits, actions: props.inputActions, disabled: session.removed || session.subagent != null }
          composers.set(props.sessionId, entry); notify()
          return () => { if (composers.get(props.sessionId) === entry) composers.delete(props.sessionId) }
        }, [input, limits, props.inputActions, props.sessionId, session.removed, session.subagent])
        useRefresh()
        return h(ui.Button, { variant: 'ghost', title: label('应用快照 · 左右 Ctrl', 'Appshot · left + right Ctrl'), onClick: () => { open = true; notify() } }, 'Appshot')
      }
      function Preview() {
        useRefresh()
        const [tab, setTab] = React.useState('image'), [includeImage, setImage] = React.useState(true), [includeText, setText] = React.useState(true), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false)
        const capture = snapshot.capture
        React.useEffect(() => { setError(''); setTab('image'); setImage(true); setText(true) }, [capture?.id])
        if (!open) return null
        const sessionId = ctx.sessions.list.getSnapshot().current, composer = composers.get(sessionId)
        const canImage = composer?.limits?.mediaTypes?.includes('image/png') === true
        const ready = capture?.state === 'ready'
        const attach = async () => {
          setBusy(true); setError('')
          try {
            if (!composer || composer.disabled || !ctx.sessions.binding(sessionId)) throw new Error(label('请先打开一个可编辑的会话。', 'Open an editable conversation first.'))
            const files = [], stamp = new Date(capture.createdAt).toISOString().replaceAll(':', '-')
            if (includeImage && canImage && capture.image) {
              const bytes = Uint8Array.from(atob(capture.image.dataUrl.split(',')[1]), c => c.charCodeAt(0))
              files.push(new File([bytes], `Appshot-${stamp}.png`, { type: 'image/png' }))
            }
            if (includeText && capture.text) files.push(new File([`Application window: ${capture.title}\nCaptured: ${new Date(capture.createdAt).toISOString()}\nSource: application accessibility text (may be incomplete).\n\n${capture.text}`], `Appshot-${stamp}.txt`, { type: 'text/plain' }))
            if (!files.length) throw new Error(label('没有可添加的内容。', 'No content selected.'))
            addFilesToDraft(ctx.get('conversation'), sessionId, composer.actions, composer.input, composer.limits, files)
            await dismiss(capture.id)
          } catch (failure) { setError(failure.message) } finally { setBusy(false) }
        }
        const checkbox = (checked, onChange, text, disabled = false) => h('label', { style: { display: 'inline-flex', gap: 8, alignItems: 'center', marginRight: 20 } }, h('input', { type: 'checkbox', checked, disabled, onChange: event => onChange(event.target.checked) }), text)
        return h(ui.Modal, { open: true, onClose: () => { void dismiss() }, title: 'Appshot',
          description: capture?.title || label('实验功能 · 同时按左右 Ctrl，松开后预览当前应用。', 'Experimental · Press both Ctrl keys, then release to preview the foreground app.'),
          footer: h(React.Fragment, null,
            h(ui.Button, { variant: 'ghost', onClick: () => { open = false; notify() } }, label('稍后添加', 'Keep for later')),
            h(ui.Button, { variant: 'ghost', onClick: () => { void dismiss() } }, label('丢弃', 'Discard')),
            h(ui.Button, { variant: 'primary', disabled: busy || !ready || !composer || composer.disabled, onClick: attach }, label('添加到当前草稿', 'Add to current draft'))),
        }, h('div', { style: { display: 'grid', gap: 14, minWidth: 300 } },
          !snapshot.ready && h('p', { role: 'status' }, label('快捷键服务尚未就绪。', 'Hotkey service is not ready.')),
          capture?.image && h('div', { style: { display: 'flex', gap: 8 } }, h(ui.Button, { variant: 'ghost', onClick: () => setTab('image') }, label('图片', 'Image')), h(ui.Button, { variant: 'ghost', onClick: () => setTab('text') }, label('文字', 'Text'))),
          capture?.image && tab === 'image' && h('img', { src: capture.image.dataUrl, alt: label('应用窗口截图', 'Captured application window'), style: { maxWidth: '100%', maxHeight: '45vh', objectFit: 'contain', borderRadius: 10 } }),
          tab === 'text' && h('pre', { style: { whiteSpace: 'pre-wrap', maxHeight: '45vh', overflow: 'auto', font: 'inherit' } }, capture?.text || label('此应用未返回可读文字。', 'This app returned no readable text.')),
          capture && !ready && capture.state !== 'error' && h('p', { role: 'status' }, label('正在读取应用…', 'Reading application…')),
          capture?.error && h('p', { role: 'alert' }, capture.error),
          ready && h('div', null, checkbox(includeImage && canImage, setImage, label('图片', 'Image'), !canImage), checkbox(includeText, setText, label('文字', 'Text'), !capture.text)),
          capture?.textPartial && h('p', null, label('文字只读取到部分内容；可切换到“文字”检查。', 'Only part of the text is available; review it in the Text tab.')),
          !composer && h('p', null, label('可先保留快照，再打开目标会话。快照两分钟后自动清除。', 'Keep the capture, then open a conversation. Pending captures expire after two minutes.')),
          composer && !canImage && h('p', null, label('当前会话未启用图片输入，可添加文字。', 'Image input is unavailable in this session; text can still be added.')),
          h('p', { style: { fontSize: 12, opacity: 0.75 } }, label('仅添加到草稿，不会自动发送。图片和文字将交给你为此会话选择的模型。', 'Added to your draft only. Sending shares the image and text with the model selected for this session.')),
          error && h('p', { role: 'alert' }, error)))
      }
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: 'portable-appshots', order: 80 }, Composer))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'portable-appshots' }, Preview))
      ctx.effect(() => {
        const events = new EventSource('/portable-appshots/events')
        events.onmessage = () => { void refresh(true) }
        events.onerror = () => { snapshot = { ...snapshot, ready: false }; notify() }
        void refresh(false)
        const stop = ctx.sessions.list.subscribe(notify)
        return () => { disposed = true; generation++; events.close(); stop?.(); listeners.clear(); composers.clear(); snapshot = { ready: false, capture: null } }
      })
    }
    return { inject: ['slots', 'sessions', 'locale'], apply, addFilesToDraft }
  },
})
