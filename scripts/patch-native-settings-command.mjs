import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKER = 'dsh-portable-native-settings-command-v3'

function replaceRequired(source, needle, replacement, label) {
  const matches = source.split(needle).length - 1
  if (matches !== 1) throw new Error(`${label}: expected 1 match, found ${matches}`)
  return source.replace(needle, replacement)
}

export function patchNativeSettingsCommand(source) {
  if (source.includes(MARKER)) return source

  const legacySeam = `\t\t\t(0, react.useEffect)(() => {
\t\t\t\tif (wasOpen.current && !open) triggerButton.current?.focus();
\t\t\t\twasOpen.current = open;
\t\t\t}, [open]);`
  const modernSeam = legacySeam.replace('triggerButton.current?.focus()', 'triggerRow.current?.querySelector("button")?.focus()')
  const seams = [legacySeam, modernSeam].filter(candidate => source.includes(candidate))
  if (seams.length !== 1) throw new Error('native settings command seam changed upstream: expected one recognized focus effect')
  const seam = seams[0]
  const replacement = `${seam}
\t\t\t/* ${MARKER} */
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tconst openSettings = (event) => {
\t\t\t\t\tif (event?.detail?.probe) return;
\t\t\t\t\tif (typeof event?.detail?.section === "string") setActiveId(event.detail.section);
\t\t\t\t\tsetOpen(true);
\t\t\t\t};
                const api = { open: (section) => openSettings({ detail: { section } }) };
                window.__DSH_PORTABLE_SETTINGS__ = api;
                try {
                    const saved = JSON.parse(sessionStorage.getItem("dsh-portable-settings-view") || "null");
                    if (saved?.open === true) openSettings({ detail: { section: saved.section } });
                } catch {}
                window.dispatchEvent(new Event("dsh-portable/settings-ready"));
\t\t\t\twindow.addEventListener("dsh-portable/open-settings", openSettings);
\t\t\t\treturn () => {
                    if (window.__DSH_PORTABLE_SETTINGS__ === api) delete window.__DSH_PORTABLE_SETTINGS__;
\t\t\t\t\twindow.removeEventListener("dsh-portable/open-settings", openSettings);
\t\t\t\t};
\t\t\t}, []);
            (0, react.useEffect)(() => {
                if (!open) return;
                try { sessionStorage.setItem("dsh-portable-settings-view", JSON.stringify({open:true,section:activeId})); } catch {}
            }, [open, activeId]);`
  source = replaceRequired(source, seam, replacement, 'native settings command seam changed upstream')
  // The slot ledger includes shadowed entries; the navigation must list each
  // effective page once, matching the slot renderer's priority selection.
  source = source.replace('ctx.slots.entries("settings.section").map(', 'ctx.slots.entries("settings.section").filter((entry, index, all) => all.findIndex((candidate) => candidate.options.id === entry.options.id) === index).map(')
  const close = 'const close = (0, react.useCallback)(() => {\n\t\t\t\tsetOpen(false);'
  return replaceRequired(source, close, `${close}\n                try { sessionStorage.removeItem("dsh-portable-settings-view"); } catch {}`, 'settings close seam changed upstream')
}

export function patchPluginSettingsNavigation(source) {
  const marker = 'dsh-portable-plugin-tab-state-v1'
  if (source.includes(marker)) return source
  return replaceRequired(source, 'const [activeId, setActiveId] = (0, react.useState)();', `/* ${marker} */
            const [activeId, setActiveId] = (0, react.useState)(() => {
                try { return sessionStorage.getItem("dsh-portable-plugin-tab") || void 0; } catch { return void 0; }
            });
            (0, react.useEffect)(() => {
                if (!activeId) return;
                try { sessionStorage.setItem("dsh-portable-plugin-tab", activeId); } catch {}
            }, [activeId]);`, 'plugin settings navigation seam changed upstream')
}

export function patchPortableUpdatesIcon(source) {
  const marker = 'dsh-portable-updates-nav-icon-v1'
  const seam = 'function navIcon(id) {'
  if (!source.includes(marker)) source = replaceRequired(source, seam, `${seam}
            /* ${marker} */
            if (id === "portable-updates") return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutlineRegular ?? _deepseek_ai_dsh_client_ui_primitives.IconDownloadOutline16, {
                className: SettingsRoot_module_css_default.navIcon,
                size: 16
            });`, 'settings navigation icon seam changed upstream')
  const desktopMarker = 'dsh-portable-desktop-nav-icon-v1'
  if (source.includes(desktopMarker)) return source
  return replaceRequired(source, seam, `${seam}
            /* ${desktopMarker} */
            if (id === "portable") return (0, react_jsx_runtime.jsx)("svg", {
                className: SettingsRoot_module_css_default.navIcon,
                width: 16, height: 16, viewBox: "0 0 16 16", fill: "none",
                stroke: "currentColor", strokeWidth: 1.25, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
                children: (0, react_jsx_runtime.jsx)("path", { d: "M2.5 2.5h11v8h-11zM8 10.5v3m-3 0h6" })
            });`, 'Portable navigation icon seam changed upstream')
}

export function patchPluginInstallationGuidance(plugins, report = () => {}) {
  // Copy is optional presentation, unlike the required interaction seams below.
  // Never partially rewrite an unfamiliar locale pair or block a core release.
  const officialCopy = ['Inspect the plugins this deployment ships.', '查看内置部署的插件列表']
  const pairs = [
    ['Configure and inspect the plugins installed in this deployment.',
      'Install plugins in Plugin Market; update or remove them in Installed. Plugin configuration changes their settings.'],
    ['配置和查看本部署已安装的插件。',
      '在「插件市场」安装插件，在「已安装」中更新或卸载；「插件配置」用于修改插件设置。'],
  ]
  const once = text => plugins.split(text).length === 2
  if (officialCopy.every(once)) { report('upstream-owned'); return plugins }
  if (pairs.every(([, after]) => once(after))) { report('already-applied'); return plugins }
  if (!pairs.every(([before]) => once(before))) {
    report('skipped-unrecognized-copy')
    return plugins
  }
  report('legacy-copy-updated')
  for (const [before, after] of pairs) plugins = plugins.replace(before, after)
  return plugins
}

function patchPluginManagerToolbar(source) {
  const marker = 'dsh-portable-plugin-manager-actions-v2'
  if (source.includes(marker)) return source
  if (source.includes('dsh-portable-plugin-manager-actions-v1')) {
    source = source.replace('dsh-portable-plugin-manager-actions-v1', marker)
    return replaceRequired(source, 'renderSlot("plugins.portable.actions", { refresh: props.refresh })',
      'renderSlot("plugins.portable.actions", { refresh: props.refresh, openInstall: props.openInstall, editInstallSpec: props.editInstallSpec })',
      'previous Portable plugin action adapter changed')
  }
  // A bounded presentation extension: the official manager still owns its
  // inventory and every existing action. No profile or controller is replaced.
  source = replaceRequired(source, '"plugins.bundle.config": {',
    `/* ${marker} */\n                    "plugins.portable.actions": { kind: "list", scope: "root" },\n                    "plugins.bundle.config": {`,
    'official plugin manager action declaration changed upstream')
  return replaceRequired(source,
    'className: PluginManagerPage_module_css_default.toolbar,\n\t\t\t\t\t\t\tchildren: [',
    'className: PluginManagerPage_module_css_default.toolbar,\n\t\t\t\t\t\t\tchildren: [renderSlot("plugins.portable.actions", { refresh: props.refresh, openInstall: props.openInstall, editInstallSpec: props.editInstallSpec }), ',
    'official plugin manager toolbar changed upstream')
}

export function patchPluginManagerActions(source) {
  source = patchPluginManagerToolbar(source)
  const refreshMarker = 'dsh-portable-plugin-refresh-v1'
  if (!source.includes(refreshMarker)) {
    const start = source.indexOf('title: t("refresh"),')
    const end = source.indexOf('onClick: props.refresh,', start)
    if (start < 0 || end < start || end - start > 180) throw new Error('official plugin refresh action changed upstream')
    source = source.slice(0, end) + source.slice(end).replace('onClick: props.refresh,',
      `onClick: () => { /* ${refreshMarker} */ window.dispatchEvent(new Event("dsh-portable/refresh-plugins")); props.refresh(); },`)
  }

  const marker = 'dsh-portable-plugin-card-updates-v1'
  if (source.includes(marker)) return source
  source = replaceRequired(source, '"plugins.portable.actions": { kind: "list", scope: "root" },',
    `"plugins.portable.actions": { kind: "list", scope: "root" },\n/* ${marker} */ "plugins.portable.update": { kind: "list", scope: "root" },`, 'plugin update slot declaration')
  const cardSignatures = [
    'function PackageCard({ pkg, t, busy, highlighted, onOpen, onSetEnabled })',
    'function PackageCard({ pkg, t, resolveText, busy, highlighted, onOpen, onSetEnabled })',
  ].filter(signature => source.includes(signature))
  if (cardSignatures.length !== 1) throw new Error('plugin card signature changed upstream')
  source = replaceRequired(source, cardSignatures[0], cardSignatures[0].replace('onSetEnabled })', 'onSetEnabled, renderSlot })'), 'plugin card signature')
  source = replaceRequired(source, 'const packageCard = (pkg) => (0, react_jsx_runtime.jsx)(PackageCard, {',
    'const packageCard = (pkg) => (0, react_jsx_runtime.jsx)(PackageCard, { renderSlot,', 'plugin card slot forwarding')
  // Only extend the card footer; native identity, toggles and details stay owned by DSH.
  const start = source.indexOf('function PackageCard(')
  const end = source.indexOf('function ItemCard(', start)
  if (start < 0 || end < start) throw new Error('plugin card boundaries changed upstream')
  let card = source.slice(start, end)
  card = replaceRequired(card, 'children: [beta ?',
    'children: [renderSlot("plugins.portable.update", { name: pkg.name, busy, view: "summary" }), beta ?', 'plugin version summary')
  card = replaceRequired(card, 'end: (0, react_jsx_runtime.jsx)(EnableSwitch, {',
    'end: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderSlot("plugins.portable.update", { name: pkg.name, busy, view: "action" }), (0, react_jsx_runtime.jsx)(EnableSwitch, {', 'plugin update action')
  card = replaceRequired(card, '\n\t\t\t\t\t})\n\t\t\t\t})',
    '\n\t\t\t\t\t})] })\n\t\t\t\t})', 'plugin update action end')
  return source.slice(0, start) + card + source.slice(end)
}

export function patchWorkspaceHeaderActions(source) {
  const marker = 'dsh-portable-workspace-header-actions-v1'
  // Older cores use their existing qualified plugin view adapter.
  if (!source.includes('"sidebar.workspaces.session.menu.item"') || source.includes(marker)) return source
  source = replaceRequired(source, '"sidebar.workspaces.session.menu.item": {',
    `/* ${marker} */ "sidebar.workspaces.header.action": { kind: "list", scope: "root" },\n"sidebar.workspaces.session.menu.item": {`, 'workspace header slot declaration')
  source = replaceRequired(source, 'children: [wide && (0, react_jsx_runtime.jsx)(ViewOptionsMenu, {',
    'children: [wide && renderSlot("sidebar.workspaces.header.action", { className: WorkspaceBrowser_module_css_default.iconButton }), wide && (0, react_jsx_runtime.jsx)(ViewOptionsMenu, {', 'workspace header action position')
  // Three header actions need their real width; leave the separate search
  // control and the collapsed/search-hidden state entirely official-owned.
  const widths = [...source.matchAll(/\.\w+_headerActions\{[^}]*?max-width:60px/g)]
  if (widths.length !== 1) throw new Error('workspace header action width changed upstream')
  return source.replace(widths[0][0], widths[0][0].replace('max-width:60px', 'max-width:92px'))
}

async function main() {
  if (!process.argv[2]) throw new Error('usage: node patch-native-settings-command.mjs <app-root>')
  const appRoot = path.resolve(process.argv[2])
  const filename = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-general', 'lib', 'client.js')
  const source = await readFile(filename, 'utf8')
  await writeFile(filename, patchPortableUpdatesIcon(patchNativeSettingsCommand(source)), 'utf8')
  const pluginsFile = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-plugins', 'lib', 'client.js')
  let plugins = patchPluginSettingsNavigation(await readFile(pluginsFile, 'utf8'))
  plugins = patchPluginInstallationGuidance(plugins, status => {
    console.log(JSON.stringify({ adapter: 'plugin-installation-guidance', required: false, status }))
    if (status === 'skipped-unrecognized-copy') console.warn('Optional plugin installation copy changed upstream; original text retained. Required interaction checks remain enabled.')
  })
  await writeFile(pluginsFile, plugins, 'utf8')
  const managerFile = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-plugin-manager', 'lib', 'client.js')
  let manager
  try { manager = await readFile(managerFile, 'utf8') } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (manager !== undefined) await writeFile(managerFile, patchPluginManagerActions(manager), 'utf8')
  const workspaceFile = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js')
  await writeFile(workspaceFile, patchWorkspaceHeaderActions(await readFile(workspaceFile, 'utf8')), 'utf8')
  console.log(filename)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
