import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical } from '../core/canonical.js';
import { projectSupport } from '../core/capabilities.js';
import { createNodePlanner } from '../node/planner.js';

export async function runCapabilityGate(): Promise<{ profiles: number; plans: number; claims: number; status: 'passed' }> {
  const planner = createNodePlanner();
  const profiles = await planner.list('profiles');
  let plans = 0;
  let claims = 0;
  for (const profile of profiles) {
    for (const kind of ['run', 'capture'] as const) {
      const result = await planner.inspect({ profile, job: { kind, code: '42', trace: kind === 'capture' } });
      if (canonical(projectSupport(result.capabilities.entries)) !== canonical(result.plan.support)) throw new Error(`Support projection mismatch:${profile}`);
      for (const [name, value] of Object.entries(result.capabilities.entries)) {
        if (value.coverage === 'unknown') throw new Error(`Unreviewed built-in behavior:${profile}:${name}`);
        claims++;
      }
      plans++;
    }
  }
  if (!profiles.length) throw new Error('Empty capability corpus');
  return { profiles: profiles.length, plans, claims, status: 'passed' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runCapabilityGate()));
}
