import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../app/package.json', import.meta.url))
const yaml = require('js-yaml')

test('failed candidate contracts remain reviewable without dispatching product qualification', async () => {
  const workflow = yaml.load(await readFile(new URL('../.github/workflows/official-preview-watch.yml', import.meta.url), 'utf8'))
  const steps = workflow.jobs.check.steps
  const contracts = steps.find(step => step.id === 'contracts')
  const review = steps.find(step => step.name === 'Open or refresh the official candidate review pull request')
  assert.equal(contracts['continue-on-error'], true)
  assert.equal(review.env.CONTRACT_RESULT, '${{ steps.contracts.outcome }}')
  assert.match(review.run, /gh pr create --draft/)
  assert.match(review.run, /Repository contracts: \$\{CONTRACT_RESULT\}/)
  assert.match(review.run, /if \[ "\$CONTRACT_RESULT" = success \]; then\s+gh workflow run ci.yml/)
  assert.match(review.run, /else[\s\S]*exit 1\s+fi/)
  assert.doesNotMatch(review.run, /gh pr merge|gh release create/)
})
