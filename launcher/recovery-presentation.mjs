// Human output for the independent recovery entry. JSON contracts stay unchanged.
export function formatRecoveryResult(result, command) {
  if (!['doctor', 'repair'].includes(command) || !Array.isArray(result?.checks)) return null
  const repair = command === 'repair'
  let summary
  if (result.deferred) summary = '未执行修复：Portable 仍在运行，请从托盘完全退出后重试。\nRepair not performed: quit Portable from the system tray, then retry.'
  else if (result.needsFullPackage) summary = '运行文件不完整，当前修复无法补齐。请使用完整产品包恢复运行文件，保留原数据目录。\nRuntime files are incomplete. Restore from a full product package and retain the original data folder.'
  else if (result.ok === true) summary = repair
    ? (result.actions?.length ? '可重建组件已修复。\nGenerated components repaired.' : '检查完成，无需修复可重建组件。\nChecked: no generated components need repair.')
    : '运行文件与可重建组件检查通过。\nRuntime and generated-component checks passed.'
  else summary = '检查未通过。请导出支持报告查看原因，不要删除会话或工作区。\nChecks failed. Export a support report; retain sessions and workspaces.'
  const failures = result.checks.filter(check => check.status !== 'ok')
    .map(check => `${check.id}: ${check.status}${check.detail ? ` — ${check.detail}` : ''}`)
  return [summary, ...failures,
    '此检查不代表模型凭据、插件运行或全部历史会话均正常。\nThis check does not validate model credentials, plugin activation or every historical session.'].join('\n')
}
