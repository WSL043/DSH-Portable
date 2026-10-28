// Bundle lists moved out of app-boot in newer official runtimes. Resolve by capability.
export async function loadOfficialProfileBundles(load, boot) {
  const owner = boot.PROFILE_TEMPLATES === undefined && boot.DEFAULT_PROFILE_BUNDLES === undefined
    ? await load('@deepseek-ai/dsh-official-bundles') : boot
  const { PROFILE_TEMPLATES, DEFAULT_PROFILE_BUNDLES } = owner
  if (!PROFILE_TEMPLATES || typeof PROFILE_TEMPLATES !== 'object' || Array.isArray(PROFILE_TEMPLATES)
    || !Array.isArray(DEFAULT_PROFILE_BUNDLES)) {
    throw new Error('Selected runtime has no official profile bundle defaults.')
  }
  return { PROFILE_TEMPLATES, DEFAULT_PROFILE_BUNDLES }
}
