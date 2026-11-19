#!/usr/bin/env node
/**
 * Refusal decision-table baseline.
 *
 * Runs the corpus through both classifiers and prints expected vs observed.
 * Report tool: always exits 0. The enforcing gate is
 * test/refusal-decision-table.test.mjs (node --test).
 *
 *   node scripts/refusal-baseline.mjs            # full table + summary
 *   node scripts/refusal-baseline.mjs --gaps     # only mismatches
 *   node scripts/refusal-baseline.mjs --json     # machine-readable
 */
import { refusalCorpus } from '../test/fixtures/refusal-corpus.mjs';
import { evaluateCorpus, gapRows, tagSummary, actionSummary } from '../test/fixtures/refusal-eval.mjs';

const rows = evaluateCorpus(refusalCorpus);
const gaps = gapRows(rows);
const pad = (s, n) => String(s).padEnd(n).slice(0, n);

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({
    total: rows.length, pass: rows.length - gaps.length, gaps: gaps.length,
    byTag: tagSummary(rows), byAction: actionSummary(rows), rows,
  }, null, 2)}\n`);
} else {
  if (!process.argv.includes('--gaps')) {
    console.log(`refusal corpus: ${rows.length} cases\n`);
    console.log(`${pad('case', 30)} ${pad('tags', 24)} ${pad('expect', 24)} ${pad('observed', 24)} gap`);
    console.log('-'.repeat(122));
    for (const r of rows) {
      console.log(`${pad(r.id, 30)} ${pad(r.tags.join(','), 24)} ${pad(`${r.expect.action} / ${r.expect.assessment}`, 24)} ${pad(`${r.action} / ${r.assessment}`, 24)} ${r.gaps.length ? 'GAP' : ''}`);
    }
    console.log('');
  }
  console.log(`pass ${rows.length - gaps.length} / gap ${gaps.length} / total ${rows.length}`);
  console.log('\nby tag:');
  for (const [tag, s] of Object.entries(tagSummary(rows))) console.log(`  ${pad(tag, 16)} ${s.pass}/${s.total} pass`);
  console.log('\nby action:');
  for (const [action, n] of Object.entries(actionSummary(rows))) console.log(`  ${pad(action, 16)} ${n}`);
  if (gaps.length) {
    console.log('\ngap detail:');
    for (const g of gaps) console.log(`  ${pad(g.id, 30)} ${g.gaps.join(' | ')}  [category=${g.category} hits=${g.hits.join(',') || '-'}]`);
  }
}
