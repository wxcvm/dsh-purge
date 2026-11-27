/**
 * 审计日志管理器测试
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AuditLogManager } from '../lib/redteam/audit-log-manager.js';

test('audit-log-manager: initializes with config', () => {
  const manager = new AuditLogManager({
    logDir: '/tmp/audit',
    enableImmutable: true,
  });

  assert.equal(manager.config.logDir, '/tmp/audit');
  assert.equal(manager.config.enableImmutable, true);
  assert.deepEqual(manager.logs, []);
  assert.ok(manager.sessionId);
});

test('audit-log-manager: logs operations', () => {
  const manager = new AuditLogManager({ enableImmutable: false });

  const result = manager.logOperation({
    type: 'capability-execute',
    capabilityId: 'bash-history-clear',
    command: 'rm -f ~/.bash_history',
    status: 'success',
    duration: 1500,
  });

  assert.ok(result.id);
  assert.equal(result.type, 'capability-execute');
  assert.equal(result.status, 'success');
  assert.equal(manager.logs.length, 1);
});

test('audit-log-manager: timestamps are recorded', () => {
  const manager = new AuditLogManager({ enableImmutable: false });

  manager.logOperation({
    type: 'capability-execute',
    capabilityId: 'cmd-history-clear',
    status: 'success',
  });

  const log = manager.logs[0];
  assert.ok(log.timestamp);
  assert.ok(new Date(log.timestamp).getTime() > 0);
});

test('audit-log-manager: getHistory filters by type', () => {
  const manager = new AuditLogManager({ enableImmutable: false });

  manager.logOperation({ type: 'capability-execute', capabilityId: 'cap1', status: 'success' });
  manager.logOperation({ type: 'command-exec', capabilityId: 'cap1', status: 'success' });
  manager.logOperation({ type: 'capability-execute', capabilityId: 'cap2', status: 'failed' });

  const history = manager.getHistory({ type: 'capability-execute' });

  assert.equal(history.length, 2);
  assert.ok(history.every(h => h.type === 'capability-execute'));
});

test('audit-log-manager: getHistory filters by status', () => {
  const manager = new AuditLogManager({ enableImmutable: false });

  manager.logOperation({ type: 'capability-execute', status: 'success' });
  manager.logOperation({ type: 'capability-execute', status: 'failed' });
  manager.logOperation({ type: 'capability-execute', status: 'success' });

  const successful = manager.getHistory({ status: 'success' });

  assert.equal(successful.length, 2);
  assert.ok(successful.every(h => h.status === 'success'));
});

test('audit-log-manager: generateReport calculates statistics', () => {
  const manager = new AuditLogManager({ enableImmutable: false });

  manager.logOperation({ type: 'capability-execute', status: 'success', duration: 1000 });
  manager.logOperation({ type: 'capability-execute', status: 'success', duration: 2000 });
  manager.logOperation({ type: 'capability-execute', status: 'failed', duration: 500 });

  const report = manager.generateReport();

  assert.equal(report.totalOperations, 3);
  assert.equal(report.successCount, 2);
  assert.equal(report.failureCount, 1);
  assert.ok(report.successRate.includes('%'));
  assert.ok(report.totalDuration > 0);
});

test('audit-log-manager: session ID is consistent', () => {
  const manager = new AuditLogManager({ enableImmutable: false });

  const sessionId1 = manager.sessionId;
  manager.logOperation({ type: 'capability-execute', status: 'success' });
  const sessionId2 = manager.logs[0].sessionId;

  assert.equal(sessionId1, sessionId2);
});

test('audit-log-manager: each log entry has unique ID', () => {
  const manager = new AuditLogManager({ enableImmutable: false });

  manager.logOperation({ type: 'capability-execute', status: 'success' });
  manager.logOperation({ type: 'capability-execute', status: 'success' });

  const id1 = manager.logs[0].id;
  const id2 = manager.logs[1].id;

  assert.notEqual(id1, id2);
});
