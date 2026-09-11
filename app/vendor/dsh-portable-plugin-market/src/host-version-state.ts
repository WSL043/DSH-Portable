/** Disk observations are not proof that an already loaded host module changed. */
export class HostVersionState {
  private versions = new Map<string, string>()
  private changed = new Set<string>()

  observe(name: string, version: string | null, hostHalf: boolean): boolean {
    if (!hostHalf || version === null) return this.changed.has(name)
    const previous = this.versions.get(name)
    if (previous !== undefined && previous !== version) this.changed.add(name)
    if (previous === undefined) this.versions.set(name, version)
    // Rollback on disk does not clear modules already cached in this process.
    return this.changed.has(name)
  }
}
