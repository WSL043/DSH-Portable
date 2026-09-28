import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../app/package.json', import.meta.url))
const yaml = require('js-yaml')

test('failed candidate contracts remain reviewable without dispatching product qualification', async () => {
  const workflow = yaml.load(await readFile(new URL('../.github/workflows/official-preview-watch.yml', import.meta.url), 'utf8'))
  const steps = workflow.jobs.check.steps
  const intake = steps.find(step => step.id === 'intake')
  const contracts = steps.find(step => step.id === 'contracts')
  const review = steps.find(step => step.name === 'Open or refresh the official candidate review pull request')
  assert.equal(intake['continue-on-error'], true)
  assert.ok(steps.indexOf(intake) < steps.indexOf(contracts))
  assert.match(intake.run, /intake-upstream-core\.mjs "\$VERSION" --lock upstream\.preview\.lock\.json --record-shape --markdown intake-report\.md/)
  assert.match(review.env.INTAKE_VERDICT, /steps\.intake\.outputs\.verdict/)
  assert.match(review.run, /git add upstream\.preview\.lock\.json config\/historical-descriptor-versions\.json/)
  assert.match(review.run, /cat intake-report\.md/)
  assert.match(review.run, /需要人工审查：第 %s 项/)
  assert.equal(contracts['continue-on-error'], true)
  assert.equal(review.env.CONTRACT_RESULT, '${{ steps.contracts.outcome }}')
  assert.match(review.run, /gh pr create --draft/)
  assert.match(review.run, /Repository contracts: \$\{CONTRACT_RESULT\}/)
  assert.match(review.run, /if \[ "\$CONTRACT_RESULT" = success \]; then\s+gh workflow run ci.yml/)
  assert.match(review.run, /else[\s\S]*exit 1\s+fi/)
  assert.doesNotMatch(review.run, /gh pr merge|gh release create/)
})
