import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Native reference only: do not import Purge or modify installed host files.
test('rc.5 native approval preserves denial and audit outcomes', {
  skip: !process.env.DSH_COMPAT_HOST_ROOT && 'requires pinned official host fixture',
}, async t => {
  const root = process.env.DSH_COMPAT_HOST_ROOT;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', '@deepseek-ai', 'dsh-user-approval', 'package.json'), 'utf8'));
  if (manifest.version !== '0.2.2-rc.5') {
    t.skip('requires exact rc.5 native approval package');
    return;
  }
  const req = createRequire(path.join(root, 'package.json'));
  const load = name => import(pathToFileURL(req.resolve(name)).href);
  const [{ Context }, { default: SessionStore }, { default: SessionProjectionRegistry },
    { default: ApprovalService, setApprovalPolicy }] = await Promise.all([
    load('@deepseek-ai/cordis'),
    load('@deepseek-ai/dsh-session'),
    load('@deepseek-ai/dsh-session-projection'),
    load('@deepseek-ai/dsh-user-approval'),
  ]);
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); });
  await ctx.plugin(SessionStore);
  await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(ApprovalService);

  const session = ctx.sessions.create();
  session.append('turn/start', { turn: 1 });
  const agent = { session };
  setApprovalPolicy(session, 'ask');
  const request = () => ctx.approval.request({ agent, toolName: 'inert-test-operation' });
  assert.equal(await request(), 'unavailable');

  let calls = 0;
  ctx.on('approval/request', async () => {
    calls++;
    return 'rejected';
  });
  assert.equal(await request(), 'rejected');
  assert.equal(calls, 1);

  setApprovalPolicy(session, 'never');
  assert.equal(await request(), 'rejected');
  assert.equal(calls, 1, 'never must not dispatch an approval question');

  const audit = session.snapshotEvents().filter(event =>
    event.type === 'approval/asked' || event.type === 'approval/decided');
  assert.equal(audit.length, 6);
  for (let i = 0; i < audit.length; i += 2) {
    assert.equal(audit[i].type, 'approval/asked');
    assert.equal(audit[i + 1].type, 'approval/decided');
    assert.equal(audit[i].data.id, audit[i + 1].data.id);
  }
  assert.deepEqual(audit.filter(event => event.type === 'approval/decided').map(event => event.data.outcome),
    ['unavailable', 'rejected', 'rejected']);

  // Model the documented non-interactive delegated session without spawning a
  // subagent. Its own approval policy must remain independent of the parent.
  const childSession = ctx.sessions.create();
  childSession.append('turn/start', { turn: 1 });
  setApprovalPolicy(childSession, 'never');
  const child = { session: childSession };
  setApprovalPolicy(session, 'ask');
  const before = calls;
  const decisions = await Promise.all([
    request(),
    ctx.approval.request({ agent: child, toolName: 'inert-child-operation' }),
  ]);
  assert.deepEqual(decisions, ['rejected', 'rejected']);
  assert.equal(calls, before + 1, 'only the interactive parent may dispatch a question');
  assert.equal(ctx.approval.effectivePolicy(session), 'ask');
  assert.equal(ctx.approval.effectivePolicy(childSession), 'never');

  const childAudit = childSession.snapshotEvents().filter(event =>
    event.type === 'approval/asked' || event.type === 'approval/decided');
  const parentAudit = session.snapshotEvents().filter(event =>
    event.type === 'approval/asked' || event.type === 'approval/decided');
  assert.equal(parentAudit.length, 8);
  assert.deepEqual(childAudit.map(event => event.type), ['approval/asked', 'approval/decided']);
  assert.equal(childAudit[0].data.id, childAudit[1].data.id);
  assert.equal(childAudit[1].data.outcome, 'rejected');
  assert.notEqual(childAudit[0].data.id, parentAudit[6].data.id);
  assert.equal(parentAudit[6].data.id, parentAudit[7].data.id);
  assert.ok(!parentAudit.some(event => event.data.id === childAudit[0].data.id));
});
