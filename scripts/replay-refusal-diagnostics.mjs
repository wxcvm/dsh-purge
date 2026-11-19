#!/usr/bin/env node
/**
 * Offline refusal-classifier replay. Reads JSON fixtures and writes only categorical diagnostics;
 * it does not call a model, change runtime policy, or emit source text.
 *
 * Usage: node scripts/replay-refusal-diagnostics.mjs <cases.json>
 * Input: [{ id, taskText, text, reasoningText?, reviewedDecision? }]
 * reviewedDecision is counted only when explicitly set to 'refusal' or 'not-refusal'.
 */
import fs from 'node:fs';
import { replayRefusalCases } from '../lib/refusal-diagnostics.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/replay-refusal-diagnostics.mjs <cases.json>');
  process.exitCode = 2;
} else {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('Input must be a file no larger than 2 MiB.');
  const input = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(input)) throw new Error('Input JSON must be an array of cases.');
  const report = replayRefusalCases(input);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
