/**
 * Shell 执行器测试
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ShellExecutor } from '../lib/redteam/shell-executor.js';

test('shell-executor: initializes with platform config', () => {
  const executor = new ShellExecutor({
    platform: 'linux',
    dryRun: true,
    timeout: 60000,
  });

  assert.equal(executor.config.platform, 'linux');
  assert.equal(executor.config.dryRun, true);
  assert.equal(executor.config.timeout, 60000);
  assert.deepEqual(executor.state.executed, []);
  assert.deepEqual(executor.state.failed, []);
});

test('shell-executor: dry-run returns simulated results', async () => {
  const executor = new ShellExecutor({ dryRun: true });
  const result = await executor.executeCommand('echo "test"');

  assert.equal(result.status, 'simulated');
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes('DRY RUN'));
});

test('shell-executor: dry-run does not execute actual commands', async () => {
  const executor = new ShellExecutor({ dryRun: true });
  
  const result = await executor.executeCommand('rm -rf /');
  
  assert.equal(result.status, 'simulated', 'dangerous command should still be simulated in dry-run');
});

test('shell-executor: tracks executed commands', async () => {
  const executor = new ShellExecutor({ dryRun: true });
  
  await executor.executeCommand('cmd1');
  await executor.executeCommand('cmd2');
  
  assert.equal(executor.state.executed.length, 2);
});

test('shell-executor: getState returns summary', async () => {
  const executor = new ShellExecutor({ dryRun: true });
  
  await executor.executeCommand('test1');
  await executor.executeCommand('test2');
  
  const state = executor.getState();
  
  assert.equal(state.successCount, 2);
  assert.equal(state.failureCount, 0);
  assert.equal(state.dryRun, true);
});

test('shell-executor: timeout config is respected', () => {
  const executor = new ShellExecutor({ timeout: 15000 });
  
  assert.equal(executor.config.timeout, 15000);
});

test('shell-executor: captureOutput can be disabled', async () => {
  const executor = new ShellExecutor({ 
    dryRun: true,
    captureOutput: false 
  });
  
  const result = await executor.executeCommand('echo "test"');
  
  // In dry-run, stdout still contains the simulated message
  assert.ok(result.stdout);
});
