import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPlan, createCommandSession } from './commands.js'

const command = (action, value = '') => ({ action, value })
const plan = (...commands) => ({ commands, message: 'Requested action' })
const empty = () => ({ history: [], index: -1, width: 'full', revision: 0 })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function setup(interpret = async () => plan(command('navigate', 'http://localhost:3000/'))) {
  const navigations = []; let enabled = true
  const session = createCommandSession({ interpret, enabled: () => enabled, changed: () => {}, navigate: url => navigations.push(url), leave: () => {}, readClipboard: async () => 'reload' })
  return { session, navigations, disable: () => { enabled = false } }
}
test('plans navigate, resize, reload and traverse only commanded history', () => {
  let state = applyPlan(empty(), plan(command('navigate', 'http://localhost:3000'), command('viewport', '390')))
  assert.equal(state.width, '390')
  state = applyPlan(state, plan(command('navigate', 'https://example.com')))
  state = applyPlan(state, plan(command('back')))
  assert.equal(state.history[state.index], 'http://localhost:3000/')
  state = applyPlan(state, plan(command('forward'), command('reload')))
  assert.equal(state.history[state.index], 'https://example.com/')
  state = applyPlan(state, plan(command('back'), command('navigate', 'https://example.org')))
  assert.equal(state.history.length, 2)
  assert.throws(() => applyPlan(state, plan(command('forward'))))
})
test('invalid plan never partly changes browser state', () => {
  const state = empty()
  for (const invalid of [command('eval', 'alert(1)'), command('navigate', 'javascript:alert(1)'), command('viewport', '99999'), command('reload', 'extra')]) {
    assert.throws(() => applyPlan(state, plan(command('navigate', 'https://example.com'), invalid)))
    assert.deepEqual(state, empty())
  }
  assert.throws(() => applyPlan(state, plan(command('shelf'), command('viewport', '390'))))
  assert.throws(() => applyPlan(state, plan(command('back'))))
})
test('voice pastes only into an unchanged empty draft and does not submit', () => {
  const { session, navigations } = setup()
  const snapshot = session.captureEmptyInput()
  assert.equal(session.pasteIfEmpty('open localhost port 3000', snapshot), true)
  assert.equal(navigations.length, 0)
  assert.equal(session.pasteIfEmpty('replace it', snapshot), false)
  session.edit(''); const old = session.captureEmptyInput(); session.edit('');
  assert.equal(session.pasteIfEmpty('stale', old), false)
})
test('submit sends context, suppresses duplicates, executes and clears draft', async () => {
  const pending = deferred(); let calls = 0
  const { session, navigations } = setup(async (body) => { calls++; assert.equal(body.text, 'open local app'); assert.equal(body.currentUrl, ''); return pending.promise })
  session.edit('open local app'); const running = session.submit(); await session.submit()
  pending.resolve(plan(command('navigate', 'http://localhost:3000'))); await running
  assert.equal(calls, 1); assert.deepEqual(navigations, ['http://localhost:3000/']); assert.equal(session.state.draft, ''); assert.equal(session.state.busy, false)
})
test('canceled, disposed, edited and unfocused requests cannot execute late', async () => {
  for (const invalidate of [s => s.session.cancel(), s => s.session.dispose(), s => s.session.edit('different'), s => s.disable()]) {
    const pending = deferred(); const fixture = setup(() => pending.promise)
    fixture.session.edit('open app'); const running = fixture.session.submit(); invalidate(fixture)
    pending.resolve(plan(command('navigate', 'http://localhost:3000'))); await running
    assert.deepEqual(fixture.navigations, []); assert.equal(fixture.session.state.busy, false)
  }
})
test('clarification and API errors preserve the draft for retry', async () => {
  const { session, navigations } = setup(async () => ({ commands: [], message: 'Which port?' }))
  session.edit('open my app'); await session.submit()
  assert.equal(session.state.draft, 'open my app'); assert.equal(session.state.message, 'Which port?'); assert.deepEqual(navigations, [])
  const failed = setup(async () => { throw new Error('Add your OpenAI key') }).session
  failed.edit('reload'); await failed.submit(); assert.equal(failed.state.draft, 'reload'); assert.equal(failed.state.error, 'Add your OpenAI key')
})

test('clipboard paste appends without submitting and discards late reads after draft changes', async () => {
  const pending = deferred(); const navigations = []
  const session = createCommandSession({ interpret: async () => plan(), enabled: () => true, changed: () => {}, navigate: url => navigations.push(url), leave: () => {}, readClipboard: () => pending.promise })
  session.edit('open'); const pasting = session.pasteClipboard(); session.edit('reload')
  pending.resolve('localhost'); await pasting
  assert.equal(session.state.draft, 'reload'); assert.deepEqual(navigations, [])
  await session.pasteClipboard(); assert.equal(session.state.draft, 'reload localhost')
})
