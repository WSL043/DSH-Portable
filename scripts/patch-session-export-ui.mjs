import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKER = 'dsh-portable-native-download-v1'

function replaceRequired(source, needle, replacement, label) {
  const matches = source.split(needle).length - 1
  if (matches !== 1) {
    throw new Error(`Session export client compatibility check failed (${label}): expected 1 match, found ${matches}`)
  }
  return source.replace(needle, replacement)
}

export function patchSessionExportClient(input) {
  if (input.includes(MARKER)) return input

  let output = replaceRequired(
    input,
    '\t\t\tconst error = status === "error" ? entry?.error || t("dialog.commandFailed") : null;\n\t\t\treturn (0, react_jsx_runtime.jsx)',
    `\t\t\tconst error = status === "error" ? entry?.error || t("dialog.commandFailed") : null;\n` +
      `\t\t\t/* ${MARKER} */\n` +
      '\t\t\tconst nativeDownload = entry?.nativeDownload;\n' +
      '\t\t\tconst nativeState = nativeDownload?.state;\n' +
      '\t\t\tconst nativeFileName = nativeDownload?.fileName || "Session.zip";\n' +
      '\t\t\tconst nativePercent = Number(nativeDownload?.percent);\n' +
      '\t\t\tconst nativeTitle = nativeState === "completed" ? t("dialog.nativeCompletedTitle") : nativeState === "cancelled" ? t("dialog.nativeCancelledTitle") : nativeState === "interrupted" ? t("dialog.nativeInterruptedTitle") : nativeState === "downloading" ? t("dialog.nativeDownloadingTitle") : null;\n' +
      '\t\t\tconst nativeDescription = nativeState === "completed" ? t("dialog.nativeCompletedDescription", { fileName: nativeFileName }) : nativeState === "cancelled" ? t("dialog.nativeCancelledDescription") : nativeState === "interrupted" ? t("dialog.nativeInterruptedDescription", { reason: nativeDownload?.reason || t("dialog.commandFailed") }) : nativeState === "downloading" && Number.isFinite(nativePercent) && nativePercent >= 0 ? t("dialog.nativeDownloadingProgress", { fileName: nativeFileName, percent: Math.min(100, Math.max(0, Math.floor(nativePercent))) }) : nativeState === "downloading" ? t("dialog.nativeDownloadingDescription", { fileName: nativeFileName }) : null;\n' +
      '\t\t\treturn (0, react_jsx_runtime.jsx)',
    'dialog state seam',
  )

  output = replaceRequired(
    output,
    '\t\t\t\ttitle: status === "downloading" ? t("dialog.preparingTitle") : status === "success" ? t("dialog.successTitle") : t("dialog.errorTitle"),\n\t\t\t\tdescription: status === "downloading" ? t("dialog.preparingDescription") : status === "success" ? t("dialog.successDescription") : error ?? t("dialog.commandFailed"),',
    '\t\t\t\ttitle: nativeTitle ?? (status === "downloading" ? t("dialog.preparingTitle") : status === "success" ? t("dialog.successTitle") : t("dialog.errorTitle")),\n\t\t\t\tdescription: nativeDescription ?? (status === "downloading" ? t("dialog.preparingDescription") : status === "success" ? t("dialog.successDescription") : error ?? t("dialog.commandFailed")),',
    'dialog presentation seam',
  )

  output = replaceRequired(
    output,
    '\t\t\t"dialog.commandFailed": "无法启动 Session 导出。"',
    '\t\t\t"dialog.commandFailed": "无法启动 Session 导出。",\n' +
      '\t\t\t"dialog.nativeDownloadingTitle": "正在下载 Session",\n' +
      '\t\t\t"dialog.nativeDownloadingDescription": "正在下载 {fileName}。",\n' +
      '\t\t\t"dialog.nativeDownloadingProgress": "{fileName} · {percent}%",\n' +
      '\t\t\t"dialog.nativeCompletedTitle": "Session 导出完成",\n' +
      '\t\t\t"dialog.nativeCompletedDescription": "{fileName} 已保存到你选择的位置。",\n' +
      '\t\t\t"dialog.nativeCancelledTitle": "Session 导出已取消",\n' +
      '\t\t\t"dialog.nativeCancelledDescription": "没有保存 Session ZIP 文件。",\n' +
      '\t\t\t"dialog.nativeInterruptedTitle": "Session 导出未完成",\n' +
      '\t\t\t"dialog.nativeInterruptedDescription": "{reason}"',
    'Chinese locale seam',
  )

  output = replaceRequired(
    output,
    '\t\t\t"dialog.commandFailed": "Could not start the Session export."',
    '\t\t\t"dialog.commandFailed": "Could not start the Session export.",\n' +
      '\t\t\t"dialog.nativeDownloadingTitle": "Downloading Session",\n' +
      '\t\t\t"dialog.nativeDownloadingDescription": "Downloading {fileName}.",\n' +
      '\t\t\t"dialog.nativeDownloadingProgress": "{fileName} · {percent}%",\n' +
      '\t\t\t"dialog.nativeCompletedTitle": "Session export complete",\n' +
      '\t\t\t"dialog.nativeCompletedDescription": "{fileName} was saved to the location you chose.",\n' +
      '\t\t\t"dialog.nativeCancelledTitle": "Session export cancelled",\n' +
      '\t\t\t"dialog.nativeCancelledDescription": "No Session ZIP was saved.",\n' +
      '\t\t\t"dialog.nativeInterruptedTitle": "Session export did not finish",\n' +
      '\t\t\t"dialog.nativeInterruptedDescription": "{reason}"',
    'English locale seam',
  )

  return output
}

export async function patchInstalledSessionExport(appRoot) {
  const target = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-session-log-export', 'lib', 'client.js')
  const source = await readFile(target, 'utf8')
  const output = patchSessionExportClient(source)
  if (output !== source) await writeFile(target, output, 'utf8')
  return target
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appRoot = process.argv[2]
  if (!appRoot) throw new Error('usage: node patch-session-export-ui.mjs <staged-app-directory>')
  process.stdout.write(`${await patchInstalledSessionExport(path.resolve(appRoot))}\n`)
}
