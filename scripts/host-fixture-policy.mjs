/** Reviewed official API versions. Fixture creation and test selection share this list. */
export const HOSTS = Object.freeze(['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.1-rc.5', '0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3']);
export const FULL_HOST = '0.2.2-rc.3';

export function fixtureDependencies(version, tools, llm) {
  if (!HOSTS.includes(version)) throw new Error('Select one of the explicitly reviewed fixture versions.');
  for (const [metadata, name] of [[tools, '@deepseek-ai/dsh-tools'], [llm, '@deepseek-ai/dsh-llm']]) {
    if (metadata?.name !== name || metadata.version !== version) throw new Error('Official fixture metadata name/version mismatch.');
  }
  const cordis = String(tools.peerDependencies?.['@deepseek-ai/cordis'] || '').replace(/^~/, '');
  if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(cordis)) throw new Error('Expected an exact Cordis fixture baseline.');
  const dependencies = {
    '@deepseek-ai/dsh-tools': version,
    '@deepseek-ai/dsh-system-prompt': version,
    '@deepseek-ai/dsh-scope': version,
    '@deepseek-ai/dsh-llm': version,
    '@deepseek-ai/cordis': cordis,
  };
  // --legacy-peer-deps skips peers, including llm's runtime import on rc.2+.
  const error = llm.peerDependencies?.['@deepseek-ai/dsh-error'];
  if (error) {
    if (error !== version) throw new Error('Expected a same-version dsh-error peer.');
    dependencies['@deepseek-ai/dsh-error'] = error;
  }
  if (tools.peerDependencies?.['@deepseek-ai/dsh-sandbox']) {
    dependencies['@deepseek-ai/dsh-sandbox'] = version;
    dependencies['@deepseek-ai/dsh-sandbox-policy'] = version;
    dependencies['@deepseek-ai/dsh-working-directory'] = version;
  }
  return dependencies;
}
