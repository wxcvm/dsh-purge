/**
 * Harness alpha.2 version compatibility checks.
 * Verifies that version comparison logic correctly handles Harness alpha.2
 * semantic versioning and Node runtime requirement ranges.
 *
 * alpha.2 engines field: "^24.22.3 || >=26.13.1" (Semver OR union)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Mock version comparison logic (extracted from lib/version-compare.js)
function parseVersionRange(rangeStr) {
  // Simple parser for "^X.Y.Z || >=A.B.C" format
  if (!rangeStr || typeof rangeStr !== 'string') return null;
  const parts = rangeStr.split('||').map(s => s.trim());
  return parts;
}

function compareVersions(v1, v2) {
  // Simple numeric version comparison: "24.22.3" vs "26.13.1"
  const parts1 = String(v1).split('.').map(Number);
  const parts2 = String(v2).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((parts1[i] || 0) !== (parts2[i] || 0)) {
      return (parts1[i] || 0) - (parts2[i] || 0);
    }
  }
  return 0;
}

function matchesCaretRange(currentVersion, minVersion) {
  // ^24.22.3 means >= 24.22.3 and < 25.0.0
  const current = String(currentVersion).split('.').map(Number);
  const min = String(minVersion).split('.').map(Number);
  
  if (current[0] !== min[0]) return current[0] > min[0] && current[0] < min[0] + 1;
  if (current[1] !== min[1]) return current[1] >= min[1];
  return current[2] >= min[2];
}

function matchesGreaterEqual(currentVersion, minVersion) {
  return compareVersions(currentVersion, minVersion) >= 0;
}

function satisfiesRange(nodeVersion, rangeStr) {
  // Check if nodeVersion satisfies "^24.22.3 || >=26.13.1"
  const ranges = parseVersionRange(rangeStr);
  if (!ranges) return false;
  
  for (const range of ranges) {
    if (range.startsWith('^')) {
      const minV = range.slice(1);
      if (matchesCaretRange(nodeVersion, minV)) return true;
    } else if (range.startsWith('>=')) {
      const minV = range.slice(2);
      if (matchesGreaterEqual(nodeVersion, minV)) return true;
    }
  }
  return false;
}

test('alpha.2 compatibility: parse version range with OR union', () => {
  const ranges = parseVersionRange('^24.22.3 || >=26.13.1');
  assert.deepEqual(ranges, ['^24.22.3', '>=26.13.1']);
});

test('alpha.2 compatibility: caret range ^24.22.3 matches valid versions', () => {
  assert.ok(matchesCaretRange('24.22.3', '24.22.3'), '24.22.3 matches ^24.22.3');
  assert.ok(matchesCaretRange('24.23.0', '24.22.3'), '24.23.0 matches ^24.22.3');
  assert.ok(matchesCaretRange('24.99.9', '24.22.3'), '24.99.9 matches ^24.22.3');
  assert.ok(!matchesCaretRange('25.0.0', '24.22.3'), '25.0.0 does not match ^24.22.3');
  assert.ok(!matchesCaretRange('23.0.0', '24.22.3'), '23.0.0 does not match ^24.22.3');
});

test('alpha.2 compatibility: >= range >=26.13.1 matches valid versions', () => {
  assert.ok(matchesGreaterEqual('26.13.1', '26.13.1'), '26.13.1 >= 26.13.1');
  assert.ok(matchesGreaterEqual('26.14.0', '26.13.1'), '26.14.0 >= 26.13.1');
  assert.ok(matchesGreaterEqual('27.0.0', '26.13.1'), '27.0.0 >= 26.13.1');
  assert.ok(!matchesGreaterEqual('26.13.0', '26.13.1'), '26.13.0 !>= 26.13.1');
  assert.ok(!matchesGreaterEqual('25.0.0', '26.13.1'), '25.0.0 !>= 26.13.1');
});

test('alpha.2 compatibility: OR union satisfies either range', () => {
  const range = '^24.22.3 || >=26.13.1';
  
  // ^24.22.3 matches
  assert.ok(satisfiesRange('24.22.3', range), 'Node 24.22.3 satisfies');
  assert.ok(satisfiesRange('24.99.9', range), 'Node 24.99.9 satisfies');
  
  // >=26.13.1 matches
  assert.ok(satisfiesRange('26.13.1', range), 'Node 26.13.1 satisfies');
  assert.ok(satisfiesRange('27.0.0', range), 'Node 27.0.0 satisfies');
  
  // Neither matches
  assert.ok(!satisfiesRange('23.0.0', range), 'Node 23.0.0 does not satisfy');
  assert.ok(!satisfiesRange('25.0.0', range), 'Node 25.0.0 does not satisfy (gap)');
  assert.ok(!satisfiesRange('26.0.0', range), 'Node 26.0.0 does not satisfy (before 26.13.1)');
});

test('alpha.2 compatibility: CI environment should use Node 24+', () => {
  // This test verifies that alpha.2 can run on Node 24.22.3+ (CI version)
  const ciNodeVersion = '24.22.3';
  const alpha2Range = '^24.22.3 || >=26.13.1';
  assert.ok(satisfiesRange(ciNodeVersion, alpha2Range), 'CI Node 24.22.3 is compatible');
});

test('alpha.2 compatibility: gap detection between caret and >= ranges', () => {
  // Gap is [25.0.0, 26.13.0] - this is intentional in alpha.2
  const range = '^24.22.3 || >=26.13.1';
  
  // Confirm gap exists
  assert.ok(!satisfiesRange('25.0.0', range), 'gap: 25.0.0 not supported');
  assert.ok(!satisfiesRange('26.0.0', range), 'gap: 26.0.0 not supported');
  assert.ok(!satisfiesRange('26.13.0', range), 'gap: 26.13.0 not supported');
});

test('alpha.2 compatibility: diagnostic message for unsupported versions', () => {
  const getDiagnostic = (nodeVersion, range) => {
    if (!satisfiesRange(nodeVersion, range)) {
      return `当前 Node ${nodeVersion} 不支持本版本 Harness。需要 ${range}`;
    }
    return null;
  };

  assert.equal(getDiagnostic('24.22.3', '^24.22.3 || >=26.13.1'), null);
  assert.equal(getDiagnostic('25.0.0', '^24.22.3 || >=26.13.1'),
    '当前 Node 25.0.0 不支持本版本 Harness。需要 ^24.22.3 || >=26.13.1');
});
