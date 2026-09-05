import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compareMarketVersions, evaluateMarketRelease } from '../scripts/check-market-upstream.mjs'

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('official DSH candidate discovery opens a review-only pull request', async () => {
  const [workflow, updater, state] = await Promise.all([
    read('.github/workflows/official-preview-watch.yml'),
    read('scripts/update-preview-upstream.mjs'),
    read('scripts/upstream-state.mjs'),
  ])

  assert.match(workflow, /cron:\s*['"]41 \*\/6 \* \* \*['"]/)
  assert.match(workflow, /official DSH candidate/i)
  assert.match(workflow, /node scripts\/update-preview-upstream\.mjs/)
  assert.match(workflow, /automation\/official-preview/)
  assert.match(workflow, /gh pr (?:create|edit)/)
  assert.match(workflow, /manual review/i)
  assert.match(workflow, /gh workflow run ci\.yml[^\n]+--ref "\$BRANCH"/)
  assert.match(workflow, /actions:\s*write/)
  assert.doesNotMatch(workflow, /gh pr merge|workflow_run:/)
  assert.match(state, /OFFICIAL_CANDIDATE_TAGS/)
  assert.match(state, /dist-tags/)
  assert.match(updater, /officialTagCommit/)
  assert.match(updater, /provisional\.version/)
  assert.doesNotMatch(updater, /const alphaVersion/)
  assert.match(updater, /upstream\.preview\.lock\.json/)
  assert.doesNotMatch(updater, /upstream\.lock\.json/)
})

test('bot dependency branches report qualification for a human merge', async () => {
  const [ci, merge, stableIntake] = await Promise.all([
    read('.github/workflows/ci.yml'),
    read('.github/workflows/merge-verified-dependencies.yml'),
    read('.github/workflows/upstream-watch.yml'),
  ])

  assert.match(ci, /push:\s*\n\s+branches:\s*\[main\]/)
  assert.match(ci, /^  product-qualification:/m)
  assert.match(ci, /name:\s*Product qualification/)
  assert.match(ci, /if:\s*\$\{\{ always\(\) \}\}/)
  assert.match(ci, /toJSON\(needs\)/)
  assert.match(ci, /eventName === 'pull_request'/)
  assert.match(merge, /workflow_run\.event == 'workflow_dispatch'/)
  assert.match(merge, /workflow_run\.name == 'Build and smoke test'/)
  assert.match(merge, /head_branch == 'automation\/verified-dependencies'/)
  assert.match(merge, /read-only acceptance summary/i)
  assert.match(merge, /app\/package\.json/)
  assert.match(merge, /app\/package-lock\.json/)
  assert.match(merge, /upstream\.lock\.json/)
  assert.match(merge, /actions:\s*read/)
  assert.match(merge, /contents:\s*read/)
  assert.match(merge, /pull-requests:\s*read/)
  assert.match(merge, /manual review and merge are required/i)
  assert.doesNotMatch(merge, /gh pr merge|gh workflow run|git push|contents:\s*write|pull-requests:\s*write/)
  assert.match(stableIntake, /actions:\s*write/)
  assert.match(stableIntake, /gh workflow run ci\.yml[^\n]+--ref "\$BRANCH"/)
  assert.match(stableIntake, /Manual review and merge are required/i)
  assert.match(stableIntake, /DSH-Portable release cadence/i)
  assert.match(stableIntake, /dsh-market-monitor:start/)
  assert.match(stableIntake, /dsh-market-monitor:end/)
  assert.match(stableIntake, /gh issue view/)
  assert.match(stableIntake, /bodyChanged/)
  assert.match(stableIntake, /assigned/)
  assert.doesNotMatch(stableIntake, /gh issue close/)
})

test('market release comparison distinguishes newer, equal, and older tags', () => {
  assert.equal(compareMarketVersions('v1.2.4', 'v1.2.3'), 1)
  assert.equal(compareMarketVersions('v1.3.0', 'v1.2.99'), 1)
  assert.equal(compareMarketVersions('v2.0.0', 'v1.99.99'), 1)
  assert.equal(compareMarketVersions('v1.2.3', 'v1.2.3'), 0)
  assert.equal(compareMarketVersions('v1.2.2', 'v1.2.3'), -1)

  assert.equal(evaluateMarketRelease({ pinned: 'v1.2.3', latest: 'v1.2.2' }).changed, false)
  assert.equal(evaluateMarketRelease({ pinned: 'v1.2.3', latest: 'v1.2.3' }).changed, false)
  assert.equal(evaluateMarketRelease({ pinned: 'v1.2.3', latest: 'v1.2.4' }).changed, true)
  assert.throws(
    () => evaluateMarketRelease({ pinned: 'v1.2.3', latest: 'v1.2.3-rc.1' }),
    /stable semantic version/i,
  )
})

test('unchanged open intake proposals do not force-push and rerun product qualification every poll', async () => {
  for (const file of ['upstream-watch.yml', 'official-preview-watch.yml']) {
    const workflow = await read(`.github/workflows/${file}`)
    assert.match(workflow, /gh pr list --state open --head/)
    assert.match(workflow, /git fetch --no-tags origin/)
    assert.match(workflow, /git diff --quiet "origin\/\$BRANCH"/)
    assert.match(workflow, /echo 'changed=false' >> "\$GITHUB_OUTPUT"/)
    assert.equal((workflow.match(/if: steps\.proposal\.outputs\.changed == 'true'/g) ?? []).length, 2)
  }
})

test('pull requests use one contract runner while main retains full product qualification', async () => {
  const ci = await read('.github/workflows/ci.yml')

  assert.match(ci, /preview-packed-runtime:\s*\n\s+name:[^\n]+\n\s+if:\s*\$\{\{ github\.event_name != 'pull_request' \}\}/)
  assert.match(ci, /include:\s*\$\{\{ fromJSON\(github\.event_name == 'pull_request'/)
  assert.match(ci, /"runner":"ubuntu-22\.04","label":"linux-x64"/)
  assert.match(ci, /EVENT_NAME:\s*\$\{\{ github\.event_name \}\}/)
  assert.match(ci, /nonRequiredResults\.every\(result => result === 'skipped'\)/)
})
