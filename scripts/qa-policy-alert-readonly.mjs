/** Read-only, one-shot Harness policy-alert diagnostics.
 * Prints only allowlisted metadata. Never exports messages, prompts, paths or tokens.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { decodeArchive } from './review-trace-import.mjs';

const root = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'sessions');
const since = Date.now() - 4 * 60 * 60 * 1000;
const alert = /This content was flagged for possible cybersecurity risk/i;
const policy = /(?:policy:|cybersecurity risk|Daybreak access)/i;
const safeToken = x => typeof x === 'string' && /^[A-Za-z0-9_-]{2,80}$/.test(x) ? x : null;
const safeStatus = x => Number.isInteger(Number(x)) && Number(x) >= 100 && Number(x) <= 599 ? Number(x) : null;
const dirs = dir => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.isSymbolicLink()).map(d => path.join(dir, d.name)); }
  catch { return []; }
};
const entries = [];
for (const d of dirs(root)) {
  for (const leaf of [d, ...dirs(d)]) {
    for (const name of ['session.v4.jsonl.zstd', 'session.v4.jsonl']) {
      const file = path.join(leaf, name);
      try {
        const st = fs.lstatSync(file);
        if (st.isFile() && !st.isSymbolicLink() && st.mtimeMs >= since && st.size < 128 * 1024 * 1024) {
          entries.push({ file, modified: st.mtimeMs });
          break;
        }
      } catch {}
    }
  }
}
entries.sort((a, b) => b.modified - a.modified);
let inspected = 0, decodeFailures = 0, exactMatches = 0;
const matches = [];
const recentFailures = new Map();
for (const item of entries.slice(0, 180)) {
  let records;
  try { records = decodeArchive(fs.readFileSync(item.file)); inspected++; }
  catch { decodeFailures++; continue; }
  const id = crypto.createHash('sha256').update(path.dirname(item.file)).digest('hex').slice(0, 10);
  let matchEvents = 0, codes = new Set(), statuses = new Set(), errorKinds = new Set(), recentFailure = false;
  let route = { provider: null, model: null }, matchingTypes = new Set(), hasPurgeAnchor = false;
  const routeName = value => typeof value === 'string' && /^[A-Za-z0-9._:/+-]{2,100}$/.test(value) ? value : null;
  for (const raw of records) {
    const event = raw?.event && typeof raw.event.type === 'string' ? raw.event : raw;
    if (event?.type === 'turn/end' && /^(?:error|failed|blocked)$/i.test(event?.data?.reason?.kind || '')) recentFailure = true;
    if (event?.type === 'request/header') {
      route.provider = routeName(event?.data?.header?.config?.provider) ?? route.provider;
      route.model = routeName(event?.data?.header?.config?.model) ?? route.model;
    }
    if (event?.type === 'request/context') {
      route.provider = routeName(event?.data?.provider) ?? route.provider;
      route.model = routeName(event?.data?.model) ?? route.model;
    }
    if (event?.type === 'assistant/attempt' || event?.type === 'assistant/message') {
      route.provider = routeName(event?.data?.message?.source?.provider) ?? route.provider;
      route.model = routeName(event?.data?.message?.source?.model) ?? route.model;
    }
    let serial;
    try { serial = JSON.stringify(event); } catch { continue; }
    if (!alert.test(serial)) continue;
    matchEvents++;
    if (typeof event?.type === 'string' && /^[a-z/-]{2,60}$/i.test(event.type)) matchingTypes.add(event.type);
    hasPurgeAnchor ||= /dsh-purge:anchor|OPERATOR ANCHOR/i.test(serial);
    const objects = [event?.data, event?.data?.reason, event?.data?.reason?.failure, event?.data?.reason?.error,
      event?.data?.failure, event?.data?.error, event?.data?.finish?.reason];
    for (const o of objects) {
      if (!o || typeof o !== 'object') continue;
      const code = safeToken(o.code); if (code) codes.add(code);
      const status = safeStatus(o.status ?? o.statusCode); if (status) statuses.add(status);
      const kind = safeToken(o.kind); if (kind) errorKinds.add(kind);
    }
  }
  if (recentFailure) recentFailures.set(id, true);
  if (matchEvents) {
    exactMatches += matchEvents;
    matches.push({ session: id, modifiedUtc: new Date(item.modified).toISOString(),
      matchingEvents: matchEvents, matchingEventTypes: [...matchingTypes], codes: [...codes], statuses: [...statuses], reasonKinds: [...errorKinds], lastObservedRoute: route, anchorPresentInsideErrorEvent: hasPurgeAnchor });
  }
}
console.log(JSON.stringify({ stage: 'native-archive-policy-alert', readOnly: true, cutoffUtc: new Date(since).toISOString(),
  recentArchivesFound: entries.length, archivesInspected: inspected, decodeFailures,
  alertExactEventMatches: exactMatches, latestMatchingSessions: matches.slice(0, 8),
  recentSessionsWithErrorTurn: recentFailures.size, noRawContentExported: true }));
