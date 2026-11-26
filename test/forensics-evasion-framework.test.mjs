/**
 * 反溯源编排框架测试
 * 验证清除能力定义、策略配置、事件流转
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ForensicsEvasionOrchestrator,
  FORENSICS_CAPABILITIES,
  EVASION_STRATEGIES,
} from '../lib/redteam/forensics-evasion-orchestrator.js';

test('forensics-evasion: capabilities are well-defined', () => {
  assert.ok(Object.keys(FORENSICS_CAPABILITIES).length > 0, 'should have capabilities');
  
  for (const [capId, cap] of Object.entries(FORENSICS_CAPABILITIES)) {
    assert.equal(typeof capId, 'string', `capability id should be string`);
    assert.ok(cap.name, `${capId} should have name`);
    assert.ok(cap.description, `${capId} should have description`);
    assert.ok(['high', 'medium', 'low', 'none'].includes(cap.riskLevel), 
      `${capId} riskLevel should be valid`);
  }
});

test('forensics-evasion: strategies define valid capabilities', () => {
  for (const [stratId, strat] of Object.entries(EVASION_STRATEGIES)) {
    assert.ok(Array.isArray(strat.capabilities), `${stratId} should have capabilities array`);
    for (const capId of strat.capabilities) {
      assert.ok(FORENSICS_CAPABILITIES[capId], 
        `${stratId} references unknown capability: ${capId}`);
    }
  }
});

test('forensics-evasion: safe strategy has minimal capabilities', () => {
  const safe = EVASION_STRATEGIES.safe.capabilities;
  assert.ok(safe.length <= 5, 'safe strategy should be minimal');
  assert.ok(safe.includes('artifact-discovery'), 'should include discovery');
});

test('forensics-evasion: aggressive strategy covers all major areas', () => {
  const aggressive = EVASION_STRATEGIES.aggressive.capabilities;
  
  const hasFileOps = aggressive.some(c => c.includes('file'));
  const hasLogOps = aggressive.some(c => c.includes('log') || c.includes('eventlog') || c.includes('syslog'));
  const hasNetworkOps = aggressive.some(c => c.includes('network'));
  
  assert.ok(hasFileOps, 'aggressive should cover file operations');
  assert.ok(hasLogOps, 'aggressive should cover log operations');
  assert.ok(hasNetworkOps, 'aggressive should cover network operations');
});

test('forensics-evasion: orchestrator initializes with config', () => {
  const orch = new ForensicsEvasionOrchestrator({
    strategy: 'balanced',
    dryRun: true,
  });
  
  assert.equal(orch.config.strategy, 'balanced');
  assert.equal(orch.config.dryRun, true);
  assert.deepEqual(orch.state.completed, []);
  assert.deepEqual(orch.state.failed, []);
});

test('forensics-evasion: getCapabilities returns strategy capabilities', () => {
  const orch = new ForensicsEvasionOrchestrator({ strategy: 'safe' });
  const caps = orch.getCapabilities();
  
  assert.ok(Array.isArray(caps), 'should return array');
  assert.ok(caps.length > 0, 'safe strategy should have capabilities');
  assert.deepEqual(caps, EVASION_STRATEGIES.safe.capabilities);
});

test('forensics-evasion: getCapabilityDetails returns metadata', () => {
  const orch = new ForensicsEvasionOrchestrator();
  const detail = orch.getCapabilityDetails('shellhistory-cleanup');
  
  assert.ok(detail, 'should return capability details');
  assert.equal(detail.name, '命令历史清除');
  assert.ok(detail.description);
  assert.ok(Array.isArray(detail.targets));
});

test('forensics-evasion: orchestrate emits events in dry-run mode', async () => {
  const orch = new ForensicsEvasionOrchestrator({
    strategy: 'safe',
    dryRun: true,
  });
  
  let eventsFired = [];
  orch.on('start', () => eventsFired.push('start'));
  orch.on('capability-start', () => eventsFired.push('capability-start'));
  
  const result = await orch.orchestrate();
  
  assert.ok(eventsFired.includes('start'), 'should emit start event');
  assert.ok(eventsFired.includes('capability-start'), 'should emit capability-start event');
  assert.equal(result.dryRun, true);
  assert.ok(result.completed.length >= 0);
});

test('forensics-evasion: orchestrate returns compliant report when no failures', async () => {
  const orch = new ForensicsEvasionOrchestrator({
    strategy: 'safe',
    dryRun: true,
  });
  
  const result = await orch.orchestrate();
  assert.ok(result.completed, 'should have completed array');
  assert.ok(result.failed !== undefined, 'should have failed array');
});

test('forensics-evasion: dry-run simulates all operations without side effects', async () => {
  const orch = new ForensicsEvasionOrchestrator({
    strategy: 'aggressive',
    dryRun: true,
  });
  
  const result = await orch.orchestrate();
  
  // All results should be simulated
  for (const res of result.results) {
    assert.equal(res.dryRun, true, 'each result should be marked dryRun');
    assert.equal(res.status, 'simulated', 'should show simulated status');
  }
});

test('forensics-evasion: verify returns compliance report', async () => {
  const orch = new ForensicsEvasionOrchestrator({
    strategy: 'safe',
    dryRun: true,
  });
  
  await orch.orchestrate();
  const report = await orch.verify();
  
  assert.ok(report.timestamp, 'should have timestamp');
  assert.ok(Array.isArray(report.completedCapabilities), 'should list completed');
  assert.ok(Array.isArray(report.failedCapabilities), 'should list failed');
  assert.ok(['compliant', 'non-compliant'].includes(report.status));
});

test('forensics-evasion: reversible capabilities marked appropriately', () => {
  const reversible = Object.entries(FORENSICS_CAPABILITIES)
    .filter(([, cap]) => cap.reversible === true);
  
  assert.ok(reversible.length > 0, 'should have reversible capabilities');
  
  // Verify timestamp-spoofing is reversible
  const spoof = FORENSICS_CAPABILITIES['timestamp-spoofing'];
  assert.equal(spoof.reversible, true, 'timestamp spoofing should be reversible');
});

test('forensics-evasion: destructive capabilities marked with high/medium risk', () => {
  const destructive = Object.entries(FORENSICS_CAPABILITIES)
    .filter(([, cap]) => cap.reversible === false);
  
  for (const [capId, cap] of destructive) {
    assert.ok(
      ['high', 'medium'].includes(cap.riskLevel),
      `${capId} should have high/medium risk since not reversible`
    );
  }
});

test('forensics-evasion: OS-specific capabilities marked', () => {
  const windowsOnly = Object.values(FORENSICS_CAPABILITIES)
    .filter(cap => cap.osSpecific === 'Windows');
  
  const linuxOnly = Object.values(FORENSICS_CAPABILITIES)
    .filter(cap => cap.osSpecific === 'Linux');
  
  assert.ok(windowsOnly.length > 0, 'should have Windows-specific capabilities');
  assert.ok(linuxOnly.length > 0, 'should have Linux-specific capabilities');
});

test('forensics-evasion: privilege requirements tracked', () => {
  const adminRequired = Object.entries(FORENSICS_CAPABILITIES)
    .filter(([, cap]) => cap.requiresAdmin === true);
  
  const rootRequired = Object.entries(FORENSICS_CAPABILITIES)
    .filter(([, cap]) => cap.requiresRoot === true);
  
  assert.ok(adminRequired.length > 0, 'should have admin-requiring capabilities');
  assert.ok(rootRequired.length > 0, 'should have root-requiring capabilities');
});
