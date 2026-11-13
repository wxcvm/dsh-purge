import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionObservation } from '../lib/redteam/session-observation.js'

test('manual, legacy and TCP-only observations do not imply application health', () => {
  const stamp = '2026-11-13T00:00:00Z'
  assert.equal(sessionObservation({status:'active'},'tunnel').kind,'unverified')
  assert.equal(sessionObservation({status:'active',last_check:stamp,check_note:'界面手动标记'},'tunnel').kind,'manual')
  assert.equal(sessionObservation({status:'active',last_check:stamp,check_note:''},'tunnel').kind,'recorded')
  assert.deepEqual(sessionObservation({status:'active',last_check:stamp,check_note:'TCP connected (listener only)'},'tunnel'),
    {kind:'tcp_connected',checked:true,application:'not_tested',udp:'not_tested'})
  assert.equal(sessionObservation({status:'offline',last_check:stamp,check_note:'HTTP 503'},'webshell').kind,'http_response')
  assert.equal(sessionObservation({status:'online',last_check:stamp,check_note:'HTTP 401'},'webshell').application,'not_tested')
})
