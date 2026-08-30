import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('official DSH alpha discovery opens a review-only pull request', async () => {
  const [workflow, updater] = await Promise.all([
    read('.github/workflows/official-preview-watch.yml'),
    read('scripts/update-preview-upstream.mjs'),
  ])

  assert.match(workflow, /cron:\s*['"]41 \*\/6 \* \* \*['"]/)
  assert.match(workflow, /node scripts\/update-preview-upstream\.mjs/)
  assert.match(workflow, /automation\/official-preview/)
  assert.match(workflow, /gh pr (?:create|edit)/)
  assert.match(workflow, /manual review/i)
  assert.match(workflow, /gh workflow run ci\.yml[^\n]+--ref "\$BRANCH"/)
  assert.match(workflow, /actions:\s*write/)
  assert.doesNotMatch(workflow, /gh pr merge|workflow_run:/)
  assert.match(updater, /dist-tags/)
  assert.match(updater, /officialTagCommit/)
  assert.match(updater, /upstream\.preview\.lock\.json/)
  assert.doesNotMatch(updater, /upstream\.lock\.json/)
})

test('bot dependency branches run without pull-request workflow approval and merge only after qualification', async () => {
  const [ci, merge] = await Promise.all([
    read('.github/workflows/ci.yml'),
    read('.github/workflows/merge-verified-dependencies.yml'),
  ])

  assert.match(ci, /push:[\s\S]+branches:[\s\S]+main[\s\S]+automation\/verified-dependencies[\s\S]+automation\/official-preview/)
  assert.match(ci, /^  product-qualification:/m)
  assert.match(ci, /name:\s*Product qualification/)
  assert.match(ci, /if:\s*\$\{\{ always\(\) \}\}/)
  assert.match(ci, /toJSON\(needs\)/)
  assert.match(ci, /every\(\(\{ result \}\) => result === 'success'\)/)
  assert.match(merge, /workflow_run\.event == 'workflow_dispatch'/)
  assert.match(merge, /workflow_run\.name == 'Build and smoke test'/)
  assert.match(merge, /head_branch == 'automation\/verified-dependencies'/)
})
