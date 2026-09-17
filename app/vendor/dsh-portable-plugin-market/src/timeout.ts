/** Reject invalid overrides and cap timers before Node can overflow them to 1ms. */
export function boundedTimeout(value: unknown, fallback: number, maximum: number): number {
  const duration = Number(value)
  return Number.isFinite(duration) && duration >= 1
    ? Math.min(Math.floor(duration), maximum)
    : fallback
}
