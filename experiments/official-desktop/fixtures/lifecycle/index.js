import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export const name = 'portable-acceptance-fixture';
export function apply(ctx) {
  if (!process.env.DSH_HOME) throw new Error('Expected isolated Harness home');
  const target = join(process.env.DSH_HOME, 'acceptance-plugin-state.txt');
  ctx.effect(() => {
    writeFileSync(target, 'enabled');
    return () => writeFileSync(target, 'disabled');
  });
}
