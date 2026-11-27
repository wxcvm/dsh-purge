import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { INTEL_SOURCES, normalizeIntelSources } from '../lib/redteam/intel-sources.js'
import { loadPlatformConfig, savePlatformConfig, platformSummary,
  DEFAULT_INTEL_SURVEY_PREFERENCES, normalizeIntelSurveyPreferences } from '../lib/redteam/platform-config.js'
import { dispatch } from '../lib/redteam/store-core.js'

test('internet asset search sources have distinct official browser entries and honest execution states', () => {
  assert.deepEqual(INTEL_SOURCES.map((x) => x.id),
    ['local', 'fofa', 'shodan', 'censys', 'zoomeye', 'quake', 'hunter', 'netlas'])
  assert.equal(INTEL_SOURCES[0].mode, 'local')
  assert.equal(INTEL_SOURCES.find((x) => x.id === 'fofa').mode, 'existing-skill')
  assert.equal(INTEL_SOURCES.find((x) => x.id === 'shodan').mode, 'scoped-api')
  assert.equal(INTEL_SOURCES.find((x) => x.id === 'censys').mode, 'scoped-api')
  assert.match(INTEL_SOURCES.find((x) => x.id === 'censys').details, /1 credit/)
  for (const src of INTEL_SOURCES.filter((x) => !['local', 'fofa', 'shodan', 'censys'].includes(x.id))) {
    assert.equal(src.mode, 'website-only')
    assert.ok(src.url.startsWith('https://'))
    assert.match(src.details, /没有直连 .* API/)
  }
  assert.deepEqual(normalizeIntelSources(), { selected: ['local'], preferred: 'local' })
  assert.deepEqual(normalizeIntelSources({
    selected: ['shodan', 'local', 'shodan', 'fake', 44], preferred: 'shodan',
  }), { selected: ['shodan', 'local'], preferred: 'shodan' })
  assert.deepEqual(normalizeIntelSources({ selected: ['invalid'], preferred: 'invalid' }),
    { selected: [], preferred: 'local' })
})

test('multi-provider preferences persist through existing platform API without losing FOFA key or tool paths', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'redteam-intel-sources-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  savePlatformConfig({ env: { FOFA_KEY: 'fixture-key' }, tools: { nmap: '/mock/nmap' } }, root)
  const store = { root }
  const response = dispatch(store, { op: 'platformConfigSave', config: {
    intelSources: { selected: ['local', 'censys', 'shodan', 'quake'], preferred: 'shodan' },
  } })
  assert.equal(response.ok, true)
  assert.deepEqual(response.config.intelSources,
    { selected: ['local', 'censys', 'shodan', 'quake'], preferred: 'shodan' })
  assert.deepEqual(response.config.env, {})
  assert.equal(response.config.fofaKeyConfigured, true)
  assert.equal(response.config.tools.nmap, '/mock/nmap')
  const roundTrip = dispatch(store, { op: 'platformConfigGet' })
  assert.deepEqual(roundTrip.config.intelSources, response.config.intelSources)
  assert.deepEqual(platformSummary(root).intelSources.map((x) => x.id), INTEL_SOURCES.map((x) => x.id))
  assert.deepEqual(loadPlatformConfig(root).intelSources, response.config.intelSources)
  assert.equal(readFileSync(join(root, 'config.json'), 'utf8').includes('fixture-key'), true)
})

test('workbench shows four keyless operations and FOFA without unused provider cards', () => {
  const load = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const src = load(path)
    const view = src.slice(src.indexOf('function LocalAssetSearchTab(props)'), src.indexOf('function EnvTab(props)'))
    assert.match(view, /surveyCard\('overview'/)
    assert.match(view, /surveyCard\('sources'/)
    assert.match(view, /surveyCard\('query'/)
    assert.match(view, /fofaConnectionGet/)
    assert.match(view, /fofaConnectionSave/)
    assert.match(view, /fofaConnectionTest/)
    assert.match(view, /fofaSearch/)
    assert.match(view, /scopedIntelLookup/)
    assert.match(view, /scopedCtLookup/)
    assert.match(view, /scopedDnsLookup/)
    assert.doesNotMatch(view, /选择常用测绘平台|官网入口 · API 未接入|简洁且可用|开箱即用/)
  }
})

test('dedicated selection API persists repeated updates and preserves unrelated config', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'redteam-intel-dedicated-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  savePlatformConfig({ env: { FOFA_KEY: 'fixture-key' } }, root)
  for (const selection of [
    { selected: ['local', 'shodan'], preferred: 'local' },
    { selected: ['local', 'shodan', 'censys'], preferred: 'censys' },
    { selected: [], preferred: 'local' },
  ]) {
    assert.deepEqual(dispatch({ root }, { op: 'intelSourcesSave', selection }).selection, selection)
    assert.deepEqual(dispatch({ root }, { op: 'intelSourcesGet' }).selection, selection)
  }
  assert.equal(loadPlatformConfig(root).env.FOFA_KEY, 'fixture-key')
  assert.equal(dispatch({ root }, { op: 'intelSourcesSave' }).ok, false)
})

test('dedicated preference save does not overwrite an unreadable configuration', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'redteam-intel-invalid-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'config.json')
  writeFileSync(file, '{ broken')
  assert.equal(dispatch({ root }, { op: 'intelSourcesSave', selection: { selected: ['local'], preferred: 'local' } }).ok, false)
  assert.equal(readFileSync(file, 'utf8'), '{ broken')
})

test('survey preferences persist in existing config and never include external consent', t => {
  const root = mkdtempSync(join(tmpdir(), 'redteam-survey-preferences-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  savePlatformConfig({ env: { FOFA_KEY: 'fixture-secret' }, tools: { nmap: '/fixture/nmap' } }, root)
  assert.deepEqual(dispatch({ root }, { op: 'intelSurveyPreferencesGet' }).preferences,
    DEFAULT_INTEL_SURVEY_PREFERENCES)
  let response = dispatch({ root }, { op: 'intelSurveyPreferencesSave', preferences: {
    useSubfinder: true, saveCt: true, saveDns: true,
  } })
  assert.equal(response.ok, true)
  assert.deepEqual(response.preferences, {
    ...DEFAULT_INTEL_SURVEY_PREFERENCES, useSubfinder: true, saveCt: true, saveDns: true,
  })
  response = dispatch({ root }, { op: 'intelSurveyPreferencesSave', preferences: {
    includeShodan: true, saveCt: false,
  } })
  assert.equal(response.ok, true)
  assert.equal(response.preferences.useSubfinder, true, 'partial updates preserve unrelated preferences')
  assert.equal(response.preferences.saveCt, false)
  assert.equal(response.preferences.includeShodan, true)
  assert.deepEqual(dispatch({ root }, { op: 'intelSourcesGet' }).surveyPreferences, response.preferences)
  assert.deepEqual(loadPlatformConfig(root).intelSurveyPreferences, response.preferences)
  assert.equal(loadPlatformConfig(root).env.FOFA_KEY, 'fixture-secret')
  assert.equal(loadPlatformConfig(root).tools.nmap, '/fixture/nmap')
  assert.equal(readFileSync(join(root, 'config.json'), 'utf8').includes('confirmExternal'), false)
  const refetch = dispatch({ root }, { op: 'platformConfigGet' })
  assert.deepEqual(refetch.config.intelSurveyPreferences, response.preferences)
  // A completely independent platform config save does not erase survey preferences.
  savePlatformConfig({ toolkitDir: '/new/toolbox' }, root)
  assert.deepEqual(loadPlatformConfig(root).intelSurveyPreferences, response.preferences)
})

test('external permission and arbitrary checkbox fields cannot be persisted as survey preferences', t => {
  const root = mkdtempSync(join(tmpdir(), 'redteam-survey-consent-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const store = { root }
  const illegal = [
    { confirmExternal: true }, { consent: true }, { confirm: true },
    { saveCt: 'true' }, { saveCt: 1 }, { useSubfinder: null }, {},
    null, [], 'anything',
  ]
  for (const preferences of illegal) {
    const result = dispatch(store, { op: 'intelSurveyPreferencesSave', preferences })
    assert.equal(result.ok, false)
  }
  assert.deepEqual(dispatch(store, { op: 'intelSurveyPreferencesGet' }).preferences,
    DEFAULT_INTEL_SURVEY_PREFERENCES)
  assert.deepEqual(normalizeIntelSurveyPreferences({ saveCt: true, confirmExternal: true }),
    { ...DEFAULT_INTEL_SURVEY_PREFERENCES, saveCt: true })
})

test('survey UI persists defaults but never stores per-operation external confirmations', () => {
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const src = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    const survey = src.slice(src.indexOf('function LocalAssetSearchTab(props)'), src.indexOf('function EnvTab(props)'))
    assert.match(survey, /op: 'intelSurveyPreferencesSave'/)
    assert.match(survey, /surveyPreferencesReady/)
    assert.match(survey, /测绘偏好已保存/)
    assert.match(survey, /surveyPreferences\.useSubfinder/)
    assert.doesNotMatch(survey, /加查 Shodan API/)
    assert.match(survey, /sources: \['internetdb'\]/)
    assert.match(survey, /surveyPreferences\.saveCt/)
    assert.match(survey, /surveyPreferences\.saveDns/)
    assert.match(survey, /surveyPreferences\.saveIntel/)
    assert.match(survey, /confirmExternal: subConsent/)
    assert.match(survey, /confirmExternal: ctConsent/)
    assert.match(survey, /confirmExternal: dnsConsent/)
    assert.match(survey, /setSubConsent\(false\).*Consu(med|me)/)
    assert.match(survey, /setCtConsent\(false\)/)
    assert.match(survey, /setDnsConsent\(false\)/)
    assert.match(survey, /setIntelConsent\(false\)/)
    assert.match(survey, /setSurveyConfirm\(false\)/)
    assert.doesNotMatch(survey, /preferences: \{[^}]*Consent/)
    assert.match(src, /保存环境配置/)
  }
})
