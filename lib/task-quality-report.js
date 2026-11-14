/** Browser/CLI shared report projection. No responses or user-supplied markup escape into the UI. */
export function qualityReportSummary(report) {
  if (!report || typeof report !== 'object') throw new Error('Expected a quality report object');
  const reports = report.comparisons ? Object.entries(report.comparisons) : [['paired', report]];
  if (!reports.length || reports.length > 3) throw new Error('Invalid comparisons');
  const count = value => { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid report count'); return value; };
  const comparisons = reports.map(([name, value]) => {
    if (!['paired', 'hostToCurrent', 'currentToCandidate', 'hostToCandidate'].includes(name)) throw new Error('Unknown comparison');
    const total = count(value.totalCases);
    const groups = Object.fromEntries(['baseline', 'candidate'].map(key => {
      const c = value[key];
      if (!c || typeof c !== 'object') throw new Error('Missing report counts');
      const counts = Object.fromEntries(['correct', 'incorrect', 'invalid-json', 'not-completed', 'missing'].map(s => [s, count(c[s] ?? 0)]));
      if (Object.values(counts).reduce((a, b) => a + b, 0) !== total) throw new Error('Report totals do not match');
      return [key, counts];
    }));
    const pairedCases = count(value.pairedCases);
    if (pairedCases > total) throw new Error('Invalid paired count');
    const diagnostics = value.diagnostics ? Object.fromEntries(['baseline', 'candidate'].map(key => {
      const d = value.diagnostics[key];
      if (!d) throw new Error('Missing diagnostics');
      const capturedCount = count(d.capturedCount), reviewedCount = count(d.reviewedCount), confirmedOverRefusals = count(d.confirmedOverRefusals);
      if (capturedCount > total || reviewedCount > capturedCount || confirmedOverRefusals > reviewedCount) throw new Error('Invalid diagnostic counts');
      return [key, { normalTaskCount: total, capturedCount, reviewedCount, confirmedOverRefusals,
        overRefusalRate: reviewedCount ? confirmedOverRefusals / reviewedCount : null,
        denominator: 'human-reviewed-normal-responses' }];
    })) : null;
    const efficiency = Object.fromEntries(['totalTokens', 'toolCalls', 'elapsedMs', 'firstTextMs'].map(key => {
      const m = value.efficiency?.[key];
      if (!m) return [key, null];
      const paired = count(m.pairedCases);
      if (paired > total) throw new Error('Invalid metric coverage');
      for (const k of ['baseline', 'candidate']) if (m[k] !== null && (!Number.isFinite(m[k]) || m[k] < 0)) throw new Error('Invalid metric');
      return [key, { pairedCases: paired, baseline: m.baseline, candidate: m.candidate }];
    }));
    return { name, totalCases: total, ...groups, pairedCases, diagnostics, efficiency };
  });
  return { captureKind: ['real', 'synthetic'].includes(report.captureKind) ? report.captureKind : 'unspecified',
    provenance: 'collector-declared', comparisons };
}
