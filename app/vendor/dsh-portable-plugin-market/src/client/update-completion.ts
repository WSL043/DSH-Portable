export type UpdateCompletion = 'restart' | 'refresh' | 'none' | 'unknown'

export function updateCompletion(result: { activationAction?: unknown }): UpdateCompletion {
  const action = result.activationAction
  return action === 'restart' || action === 'refresh' || action === 'none' ? action : 'unknown'
}

export function updateCompletionLabel(action: UpdateCompletion, zh: boolean): string {
  const labels = {
    restart: ['待重启生效', 'Restart to apply'],
    refresh: ['刷新页面后生效', 'Reload page to apply'],
    none: ['已更新', 'Updated'],
    unknown: ['已安装，生效状态待确认', 'Installed; activation unconfirmed'],
  }
  return labels[action][zh ? 0 : 1]
}
