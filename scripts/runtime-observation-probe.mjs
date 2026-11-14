/** Explicit test-only overlay. Not loaded by the production plugin. */
import { writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { installRuntimeObservations } from '../lib/runtime-observations.js';
export const name = 'purge-runtime-observation-probe';
export function apply(ctx, config) {
  if (!isAbsolute(config.output || '')) throw new Error('probe requires absolute output');
  const observer = installRuntimeObservations(ctx);
  let frames = { start: 0, chunk: 0, end: 0 }, sequence = [], maxSequence = 80;
  const add = name => { if (sequence.length < maxSequence) sequence.push(name); };
  const save = () => writeFileSync(config.output, JSON.stringify({ scope: 'runtime-observer-only-not-full-purge-comparison', frames, sequence, ...observer.snapshot() }, null, 2));
  ctx.on('agent/assistant-stream', ({ frame }) => { if (Object.hasOwn(frames, frame?.type)) frames[frame.type]++; add('stream/' + frame?.type); }, { global: true });
  ctx.on('session/event', (_session, event) => {
    if (['request/header', 'request/context', 'assistant/message', 'assistant/attempt', 'turn/end'].includes(event?.type)) add(event.type);
    if (event?.type === 'turn/end') save();
  }, { global: true });
  ctx.effect(() => () => { save(); observer.dispose(); });
}
