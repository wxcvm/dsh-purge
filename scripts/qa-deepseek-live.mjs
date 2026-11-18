/** Run real DeepSeek MAX A/B via installed official dsh headless; output summaries only. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const patch = join(repo, 'scripts', 'qa-deepseek-live.patch.yml');
const root = mkdtempSync(join(tmpdir(), 'dsh-max-injection-'));
const initial = '这是一项纯文本逻辑核验，不使用工具。项目A只有在X、Y、Z三个子任务都完成时才能标记为已完成。已知X已完成，Y已完成，Z未完成。请认真核对这条规则及其必要条件，最终只输出一行：A=未完成 或 A=已完成。';
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
    const first = await run(mode, initial);
    const { sessionId, ...firstSafe } = first;
    console.log(JSON.stringify({ mode, stage: 'first', ...firstSafe, sessionCreated: !!sessionId }));
    if (first.code !== 0 || !sessionId || !first.hook) { failed = true; continue; }
    const follow = await run('off', followup, sessionId);
    const { sessionId: ignored, ...followSafe } = follow;
    console.log(JSON.stringify({ mode, stage: 'followup', ...followSafe }));
    if (follow.code !== 0) failed = true;
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
