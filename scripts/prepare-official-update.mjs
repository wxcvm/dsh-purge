/** Read-only checks before or after a Windows desktop update. */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { auditUpdate } from '../maintenance/update-health.mjs';

try {
  const { values } = parseArgs({ options: {
    'install-root': { type: 'string' }, 'profile-root': { type: 'string' },
    'target-archive': { type: 'string' }, 'expect-version': { type: 'string' },
    'dry-run': { type: 'boolean' },
  } });
  const result = auditUpdate({
    installRoot: values['install-root'] ?? 'D:/dsh',
    profileRoot: values['profile-root'] ?? join(homedir(), '.dsh', 'profiles', 'desktop'),
    targetArchive: values['target-archive'], expectedVersion: values['expect-version'],
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.blockers.length || result.pluginWarnings.length) process.exitCode = 2;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
