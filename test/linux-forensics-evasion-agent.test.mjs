/**
 * Linux 反溯源 Agent 测试
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LinuxForensicsEvasionAgent,
  LINUX_FORENSICS_CAPABILITIES,
} from '../lib/redteam/agents/linux-forensics-evasion-agent.js';

test('linux-forensics: has 20+ cleanup capabilities', () => {
  const caps = Object.keys(LINUX_FORENSICS_CAPABILITIES);
  assert.ok(caps.length >= 20, `should have at least 20 capabilities, got ${caps.length}`);
});

test('linux-forensics: syslog capabilities cover major logs', () => {
  const logs = ['syslog', 'auth', 'audit'];
  for (const log of logs) {
    const capId = `syslog-${log}-erase`;
    assert.ok(LINUX_FORENSICS_CAPABILITIES[capId], `should have ${log} capability`);
  }
});

test('linux-forensics: shell history covers all major shells', () => {
  const shells = ['bash', 'zsh', 'ksh', 'tcsh'];
  for (const shell of shells) {
    const capId = `${shell}-history-clear`;
    assert.ok(LINUX_FORENSICS_CAPABILITIES[capId], `should have ${shell} history capability`);
  }
});

test('linux-forensics: agent initializes with config', () => {
  const agent = new LinuxForensicsEvasionAgent({
    dryRun: true,
    requireRoot: true,
  });
  
  assert.equal(agent.config.dryRun, true);
  assert.equal(agent.config.requireRoot, true);
  assert.deepEqual(agent.state.executed, []);
  assert.deepEqual(agent.state.failed, []);
});

test('linux-forensics: getCapabilities returns all capability ids', () => {
  const agent = new LinuxForensicsEvasionAgent();
  const caps = agent.getCapabilities();
  
  assert.ok(Array.isArray(caps));
  assert.ok(caps.includes('syslog-auth-erase'));
  assert.ok(caps.includes('bash-history-clear'));
  assert.ok(caps.includes('journal-erase-systemd'));
});

test('linux-forensics: getCapabilityDetails returns metadata', () => {
  const agent = new LinuxForensicsEvasionAgent();
  const detail = agent.getCapabilityDetails('bash-history-clear');
  
  assert.ok(detail, 'should return capability details');
  assert.equal(detail.name, 'Bash 历史清除');
  assert.ok(detail.command);
});

test('linux-forensics: executeCapability in dry-run returns simulated status', async () => {
  const agent = new LinuxForensicsEvasionAgent({ dryRun: true });
  const result = await agent.executeCapability('bash-history-clear');
  
  assert.equal(result.status, 'simulated');
  assert.equal(result.capId, 'bash-history-clear');
  assert.ok(result.message.includes('DRY RUN'));
});

test('linux-forensics: executeCapability tracks executed capabilities', async () => {
  const agent = new LinuxForensicsEvasionAgent({ dryRun: true });
  
  await agent.executeCapability('bash-history-clear');
  await agent.executeCapability('zsh-history-clear');
  
  assert.deepEqual(agent.state.executed, ['bash-history-clear', 'zsh-history-clear']);
});

test('linux-forensics: orchestrate executes all capabilities in dry-run', async () => {
  const agent = new LinuxForensicsEvasionAgent({ dryRun: true });
  const result = await agent.orchestrate(['bash-history-clear', 'journal-erase-systemd']);
  
  assert.equal(result.agent, 'linux-forensics-evasion');
  assert.equal(result.dryRun, true);
  assert.equal(result.executedCapabilities.length, 2);
  assert.deepEqual(result.failedCapabilities, []);
});

test('linux-forensics: verify returns compliance report', async () => {
  const agent = new LinuxForensicsEvasionAgent({ dryRun: true });
  
  await agent.orchestrate(['bash-history-clear']);
  const report = await agent.verify();
  
  assert.ok(report.timestamp);
  assert.equal(report.platform, 'Linux');
  assert.ok(Array.isArray(report.executedCapabilities));
  assert.ok(['compliant', 'partial-compliance'].includes(report.status));
});

test('linux-forensics: syslog capabilities require root', () => {
  const syslogCaps = Object.entries(LINUX_FORENSICS_CAPABILITIES)
    .filter(([k]) => k.startsWith('syslog-'));
  
  assert.ok(syslogCaps.length >= 3, 'should have multiple syslog capabilities');
  
  for (const [, cap] of syslogCaps) {
    assert.equal(cap.requiresRoot, true, `${cap.name} should require root`);
  }
});

test('linux-forensics: capabilities use Linux commands (sed/rm/shred)', () => {
  const withCommands = Object.entries(LINUX_FORENSICS_CAPABILITIES)
    .filter(([, cap]) => cap.command);
  
  assert.ok(withCommands.length > 0, 'should have capabilities with commands');
  
  for (const [, cap] of withCommands) {
    assert.ok(
      cap.command.includes('rm') || 
      cap.command.includes('sed') || 
      cap.command.includes('shred') ||
      cap.command.includes('truncate') ||
      cap.command.includes('journalctl') ||
      cap.command.includes('systemctl') ||
      cap.command.includes('auditctl') ||
      cap.command.includes('find'),
      `${cap.name} command should use Linux utilities (got: ${cap.command.substring(0, 30)})`
    );
  }
});

test('linux-forensics: swap-wipe capability is marked high-risk', () => {
  const cap = LINUX_FORENSICS_CAPABILITIES['swap-wipe'];
  assert.ok(cap, 'should have swap-wipe capability');
  assert.equal(cap.riskLevel, 'high', 'swap wipe is high-risk operation');
  assert.equal(cap.requiresRoot, true);
});

test('linux-forensics: file-secure-delete supports multiple algorithms', () => {
  const cap = LINUX_FORENSICS_CAPABILITIES['file-secure-delete'];
  assert.ok(cap, 'should have file-secure-delete capability');
  assert.ok(Array.isArray(cap.algorithms), 'should have algorithm options');
  assert.ok(cap.algorithms.includes('shred') || cap.algorithms.includes('wipe'));
});

test('linux-forensics: audit log capabilities handle auditd', () => {
  const auditCaps = Object.entries(LINUX_FORENSICS_CAPABILITIES)
    .filter(([k]) => k.includes('audit'));
  
  assert.ok(auditCaps.length >= 2, 'should have audit-related capabilities');
  
  for (const [, cap] of auditCaps) {
    assert.ok(cap.command && (cap.command.includes('auditctl') || cap.command.includes('service')),
      `audit capability should use auditctl or service commands`);
  }
});
