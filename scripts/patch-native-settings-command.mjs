import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKER = 'dsh-portable-native-settings-command-v1'

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
\t\t\t\tconst openSettings = () => {
\t\t\t\t\tsetOpen(true);
\t\t\t\t};
\t\t\t\twindow.addEventListener("dsh-portable/open-settings", openSettings);
\t\t\t\treturn () => {
\t\t\t\t\twindow.removeEventListener("dsh-portable/open-settings", openSettings);
\t\t\t\t};
\t\t\t}, []);`
  return replaceRequired(source, seam, replacement, 'native settings command seam changed upstream')
}

export function patchPortableUpdatesIcon(source) {
  const marker = 'dsh-portable-updates-nav-icon-v1'
  if (source.includes(marker)) return source
  const seam = 'function navIcon(id) {'
  return replaceRequired(source, seam, `${seam}
            /* ${marker} */
            if (id === "portable-updates") return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutline16, {
                className: SettingsRoot_module_css_default.navIcon,
                size: 16
            });`, 'settings navigation icon seam changed upstream')
}

async function main() {
  if (!process.argv[2]) throw new Error('usage: node patch-native-settings-command.mjs <app-root>')
  const appRoot = path.resolve(process.argv[2])
  const filename = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-general', 'lib', 'client.js')
  const source = await readFile(filename, 'utf8')
  await writeFile(filename, patchPortableUpdatesIcon(patchNativeSettingsCommand(source)), 'utf8')
  const pluginsFile = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-plugins', 'lib', 'client.js')
  let plugins = await readFile(pluginsFile, 'utf8')
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
