/**
 * Windows 反溯源 Agent 测试
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WindowsForensicsEvasionAgent,
  WINDOWS_FORENSICS_CAPABILITIES,
} from '../lib/redteam/agents/windows-forensics-evasion-agent.js';

test('windows-forensics: has 15+ cleanup capabilities', () => {
  const caps = Object.keys(WINDOWS_FORENSICS_CAPABILITIES);
  assert.ok(caps.length >= 15, `should have at least 15 capabilities, got ${caps.length}`);
});

test('windows-forensics: eventlog capabilities marked Windows-specific', () => {
  const eventlogCaps = Object.entries(WINDOWS_FORENSICS_CAPABILITIES)
    .filter(([k]) => k.startsWith('eventlog-'));
  
  assert.ok(eventlogCaps.length >= 3, 'should have Application/Security/System logs');
  
  for (const [, cap] of eventlogCaps) {
    assert.ok(cap.requiresAdmin, `${cap.name} should require admin`);
    assert.equal(cap.reversible, false, `${cap.name} should not be reversible`);
  }
});

test('windows-forensics: browser history capabilities cover major browsers', () => {
  const browsers = ['chrome', 'firefox', 'edge'];
  for (const browser of browsers) {
    const capId = `browser-history-${browser}`;
    assert.ok(WINDOWS_FORENSICS_CAPABILITIES[capId], `should have ${browser} capability`);
  }
});

test('windows-forensics: agent initializes with config', () => {
  const agent = new WindowsForensicsEvasionAgent({
    dryRun: true,
    requireAdmin: true,
  });
  
  assert.equal(agent.config.dryRun, true);
  assert.equal(agent.config.requireAdmin, true);
  assert.deepEqual(agent.state.executed, []);
  assert.deepEqual(agent.state.failed, []);
});

test('windows-forensics: getCapabilities returns all capability ids', () => {
  const agent = new WindowsForensicsEvasionAgent();
  const caps = agent.getCapabilities();
  
  assert.ok(Array.isArray(caps));
  assert.ok(caps.includes('eventlog-application'));
  assert.ok(caps.includes('cmd-history-clear'));
  assert.ok(caps.includes('powershell-history-clear'));
});

test('windows-forensics: getCapabilityDetails returns metadata', () => {
  const agent = new WindowsForensicsEvasionAgent();
  const detail = agent.getCapabilityDetails('cmd-history-clear');
  
  assert.ok(detail, 'should return capability details');
  assert.equal(detail.name, 'CMD 历史清除');
  assert.ok(detail.command);
});

test('windows-forensics: executeCapability in dry-run returns simulated status', async () => {
  const agent = new WindowsForensicsEvasionAgent({ dryRun: true });
  const result = await agent.executeCapability('cmd-history-clear');
  
  assert.equal(result.status, 'simulated');
  assert.equal(result.capId, 'cmd-history-clear');
  assert.ok(result.message.includes('DRY RUN'));
});

test('windows-forensics: executeCapability tracks executed capabilities', async () => {
  const agent = new WindowsForensicsEvasionAgent({ dryRun: true });
  
  await agent.executeCapability('cmd-history-clear');
  await agent.executeCapability('powershell-history-clear');
  
  assert.deepEqual(agent.state.executed, ['cmd-history-clear', 'powershell-history-clear']);
});

test('windows-forensics: orchestrate executes all capabilities in dry-run', async () => {
  const agent = new WindowsForensicsEvasionAgent({ dryRun: true });
  const result = await agent.orchestrate(['cmd-history-clear', 'powershell-history-clear']);
  
  assert.equal(result.agent, 'windows-forensics-evasion');
  assert.equal(result.dryRun, true);
  assert.equal(result.executedCapabilities.length, 2);
  assert.deepEqual(result.failedCapabilities, []);
});

test('windows-forensics: verify returns compliance report', async () => {
  const agent = new WindowsForensicsEvasionAgent({ dryRun: true });
  
  await agent.orchestrate(['cmd-history-clear']);
  const report = await agent.verify();
  
  assert.ok(report.timestamp);
  assert.equal(report.platform, 'Windows');
  assert.ok(Array.isArray(report.executedCapabilities));
  assert.ok(['compliant', 'partial-compliance'].includes(report.status));
});

test('windows-forensics: pagefile-clear capability is marked reversible', () => {
  const cap = WINDOWS_FORENSICS_CAPABILITIES['pagefile-clear'];
  assert.ok(cap, 'should have pagefile-clear capability');
  assert.equal(cap.reversible, true, 'page file clearing should be reversible');
});

test('windows-forensics: mru-clear capability has registry paths', () => {
  const cap = WINDOWS_FORENSICS_CAPABILITIES['mru-clear'];
  assert.ok(cap, 'should have mru-clear capability');
  assert.ok(Array.isArray(cap.registryPaths));
  assert.ok(cap.registryPaths.length > 0);
});

test('windows-forensics: capabilities marked with actual Windows commands', () => {
  const withCommands = Object.entries(WINDOWS_FORENSICS_CAPABILITIES)
    .filter(([, cap]) => cap.command);
  
  assert.ok(withCommands.length > 0, 'should have capabilities with actual commands');
  
  for (const [, cap] of withCommands) {
    // Verify commands look like Windows commands
    assert.ok(
      cap.command.includes('del') || 
      cap.command.includes('reg') || 
      cap.command.includes('wevtutil') ||
      cap.command.includes('fsutil') ||
      cap.command.includes('rd '),
      `${cap.name} command should use Windows utilities (got: ${cap.command.substring(0, 30)})`
    );
  }
});

test('windows-forensics: sensitive operations require admin', () => {
  const adminRequired = Object.entries(WINDOWS_FORENSICS_CAPABILITIES)
    .filter(([, cap]) => cap.requiresAdmin);
  
  assert.ok(adminRequired.length >= 5, 'should have several admin-required operations');
  
  // Check that high-impact operations require admin
  const critical = ['eventlog-security', 'prefetch-clear', 'wmi-logs-clear'];
  for (const capId of critical) {
    const cap = WINDOWS_FORENSICS_CAPABILITIES[capId];
    assert.equal(cap.requiresAdmin, true, `${capId} should require admin`);
  }
});
