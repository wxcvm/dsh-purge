/** Opt-in isolated-profile probe. Not installed by the production plugin. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { isAbsolute, dirname } from 'node:path';
import { installObedience } from '../lib/obedience.js';
import { installRuntimeObservations } from '../lib/runtime-observations.js';
export const name = 'purge-response-assessment-probe';
export function apply(ctx, config) {
  if (!isAbsolute(config.output || '')) throw new Error('probe requires absolute output');
  const home = dirname(config.output);
  mkdirSync(home, { recursive: true });
  const observer = installRuntimeObservations(ctx);
  const classifier = installObedience(ctx, { diagnosticsHome: home,
    getSettings: () => ({ enabled: true, anchorEachTurn: false, retryRefusal: true, maxRetries: 1, retryDelayMs: 10 }) });
  let followups = 0;
  const save = () => writeFileSync(config.output, JSON.stringify({ scope: 'response-layer-only-not-full-purge', followups, ...observer.snapshot() }, null, 2));
  ctx.on('session/event', (_session, event) => {
    const message = event.data?.message || event.data;
    if (event.type === 'user/message' && message?.source?.summary === 'obedience-retry') followups++;
    if (event.type === 'turn/end') save();
  }, { global: true });
  ctx.effect(() => () => { save(); classifier.dispose(); observer.dispose(); });
}
