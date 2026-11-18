/** Run real DeepSeek MAX A/B via installed official dsh headless; output summaries only. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const patch = join(repo, 'scripts', 'qa-deepseek-live.patch.yml');
const root = mkdtempSync(join(tmpdir(), 'dsh-max-injection-'));
const initial = '这是一项纯文本逻辑核验，不使用工具。完成依赖规则：项目A当且仅当X、Y、Z全部完成。X已经完成；Y当且仅当P和Q均完成，现在P和Q均已完成；Z当且仅当R和S均完成，现在R已完成、S尚未完成。请把这些规则逐条代入，检查必要和充分条件是否同时满足，避免把完成一部分误判为整体完成。最终只输出一行：A=未完成 或 A=已完成。';
const followup = '只复述上一条助手最终答复中最后出现的A状态，不重新核算原始日志。只输出一行：A=未完成 或 A=已完成。';
function verdict(value) {
  const text = String(value || '');
  const matches = [...text.matchAll(/A\s*=\s*(未完成|已完成)/g)];
  return matches.length ? matches.at(-1)[1] : '未知';
}
function run(mode, prompt, sessionId) {
  return new Promise(resolve => {
    const args = ['--profile', 'headless', '--patch', patch, '--json', ...(sessionId ? ['--session-id', sessionId] : []), '-'];
    const child = spawn('dsh', args, {
      cwd: repo,
      env: { ...process.env, QA_STREAM_MODE: mode, QA_SESSIONS_ROOT: root },
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let stdout = '', stderr = '', spawnError = null;
    const cap = (s, chunk) => (s + chunk.toString('utf8')).slice(-2000000);
    child.stdout.on('data', chunk => { stdout = cap(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = cap(stderr, chunk); });
    child.on('error', error => { spawnError = error?.code || 'SPAWN_ERROR'; });
    child.on('close', code => {
      const records = stdout.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      const session = records.find(x => x?.type === 'session');
      const last = records.filter(x => x?.type === 'final').at(-1);
      const hook = stderr.match(/QA_HOOK (\{[^\r\n]+\})/);
      let meta = null;
      try { if (hook) meta = JSON.parse(hook[1]); } catch {}
      const err = stderr.match(/dsh:\s*([A-Z_][A-Z0-9_-]{1,60}):/);
      resolve({
        code, spawnError, errorCode: err?.[1] || null,
        sessionId: session?.sessionId || last?.sessionId || null,
        recordCount: records.length,
        thinkingEvents: records.filter(x => x?.type === 'thinking').length,
        textEvents: records.filter(x => x?.type === 'text').length,
        verdict: verdict(last?.text),
        markerInFinal: String(last?.text || '').includes('实验注入'),
        finalReason: typeof last?.reason === 'string' ? last.reason : last?.reason?.kind || null,
        hook: meta,
      });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt, 'utf8');
  });
}
let failed = false;
try {
  for (const mode of ['control', 'thinking', 'after']) {
    let first, attempt = 0;
    do {
      attempt++;
      first = await run(mode, initial);
      const { sessionId: sid, ...firstSafe } = first;
      console.log(JSON.stringify({ mode, stage: 'first', attempt, ...firstSafe, sessionCreated: !!sid }));
    } while (mode === 'thinking' && first.code === 0 && first.hook && !first.hook.injected && attempt < 3);
    const sessionId = first.sessionId;
    if (first.code !== 0 || !sessionId || !first.hook || first.hook.route?.provider !== 'deepseek-account' || first.hook.route?.reasoningEffort !== 'max') { failed = true; continue; }
    const follow = await run('off', followup, sessionId);
    const { sessionId: ignored, ...followSafe } = follow;
    console.log(JSON.stringify({ mode, stage: 'followup', ...followSafe }));
    if (follow.code !== 0) failed = true;
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
