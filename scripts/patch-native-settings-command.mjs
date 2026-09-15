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

  const seam = `\t\t\t(0, react.useEffect)(() => {
\t\t\t\tif (wasOpen.current && !open) triggerButton.current?.focus();
\t\t\t\twasOpen.current = open;
\t\t\t}, [open]);`
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
                    const restart = JSON.parse(localStorage.getItem("dsh-portable-settings-restart") || "null");
                    localStorage.removeItem("dsh-portable-settings-restart");
                    if (restart?.expires > Date.now()) {
                        sessionStorage.setItem("dsh-portable-settings-view", JSON.stringify({open:true,section:"plugins"}));
                        sessionStorage.setItem("dsh-portable-plugin-tab", "installed");
                    }
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
  return replaceRequired(source, 'setOpen(false);', 'setOpen(false);\n                try { sessionStorage.removeItem("dsh-portable-settings-view"); } catch {}', 'settings close seam changed upstream')
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
            if (id === "portable-updates") return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutline16, {
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

async function main() {
  if (!process.argv[2]) throw new Error('usage: node patch-native-settings-command.mjs <app-root>')
  const appRoot = path.resolve(process.argv[2])
  const filename = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-general', 'lib', 'client.js')
  const source = await readFile(filename, 'utf8')
  await writeFile(filename, patchPortableUpdatesIcon(patchNativeSettingsCommand(source)), 'utf8')
  const pluginsFile = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-plugins', 'lib', 'client.js')
  let plugins = patchPluginSettingsNavigation(await readFile(pluginsFile, 'utf8'))
  for (const [before, after] of [
    ['Configure and inspect the plugins installed in this deployment.',
      'Install plugins in Plugin Market; update or remove them in Installed. Plugin configuration changes their settings.'],
    ['配置和查看本部署已安装的插件。',
      '在「插件市场」安装插件，在「已安装」中更新或卸载；「插件配置」用于修改插件设置。'],
  ]) {
    if (!plugins.includes(after)) plugins = replaceRequired(plugins, before, after, 'Portable plugin installation guidance')
  }
  await writeFile(pluginsFile, plugins, 'utf8')
  console.log(filename)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
