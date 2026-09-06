import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSessionOpener } from './session.js'

function host(initial = [], authenticated = false) {
  const sessions = [...initial], calls = []
  const api = async (path, method = 'GET', body) => {
    calls.push({ path, method, body })
    if (path === '/auth') return { authenticated }
    if (method === 'GET') return { sessions }
    const session = { id: String(sessions.length + 1), ...body, status: 'running' }
    sessions.push(session)
    return session
  }
  const opener = createSessionOpener(api)
  return { open: (title, choose = async () => '/chosen/folder') => opener(title, choose), calls, sessions }
}

test('opening Codex authenticates locally and starts in the selected folder', async () => {
  const { open, calls } = host()
  assert.equal((await open('Codex 1')).status, 'running')
  assert.deepEqual(calls, [
    { path: '/auth', method: 'GET', body: undefined },
    { path: '/auth', method: 'POST', body: {} },
    { path: '/sessions', method: 'GET', body: undefined },
    { path: '/sessions', method: 'POST', body: { title: 'Codex 1', cwd: '/chosen/folder' } },
  ])
})

test('returning to a card reconnects its running session and keeps cards separate', async () => {
  const { open, sessions } = host([], true)
  const first = await open('Codex 1')
  assert.equal(await open('Codex 1'), first)
  assert.notEqual(await open('Codex 2'), first)
  assert.equal(sessions.length, 2)
  first.status = 'exited'
  assert.notEqual(await open('Codex 1'), first)
})

test('rapid close and reopen shares the pending launch', async () => {
  const { open, sessions } = host()
  const first = open('Codex 1')
  assert.equal(open('Codex 1'), first)
  await first
  assert.equal(sessions.length, 1)
})

test('failed startup is retryable without caching a rejected launch', async () => {
  let failed = true
  const open = createSessionOpener(async path => {
    if (failed) throw new Error('offline')
    return path === '/auth' ? { authenticated: true } : { sessions: [{ id: 'live', title: 'Codex 1', status: 'running' }] }
  })
  await assert.rejects(open('Codex 1'), /offline/)
  failed = false
  assert.equal((await open('Codex 1')).id, 'live')
})

test('canceling folder selection creates no session and permits a later choice', async () => {
  const { open, sessions } = host()
  assert.equal(await open('Codex 1', async () => null), null)
  assert.equal(sessions.length, 0)
  assert.equal((await open('Codex 1', async () => '/another/folder')).cwd, '/another/folder')
})

test('reconnecting a live session never requests another folder', async () => {
  const session = { id: '1', title: 'Codex 1', status: 'running' }
  const { open } = host([session])
  assert.equal(await open('Codex 1', () => assert.fail('unexpected folder picker')), session)
})

test('closing waits for a pending launch and closes every saved session for only that card', async () => {
  let finishLaunch
  const launched = new Promise(resolve => { finishLaunch = resolve })
  const calls = [], sessions = [{ id: 'other', title: 'Codex 2', status: 'running' }, { id: 'old', title: 'Codex 1', status: 'exited' }]
  const open = createSessionOpener(async (path, method = 'GET') => {
    calls.push([path, method])
    if (path === '/auth') return { authenticated: true }
    if (path === '/sessions' && method === 'GET') return { sessions }
    if (path === '/sessions') { await launched; const next = { id: 'new', title: 'Codex 1', status: 'running' }; sessions.push(next); return next }
    if (path.endsWith('/close')) return { closed: true }
  })
  const opening = open('Codex 1', async () => '/folder')
  const closing = open.close('Codex 1')
  await Promise.resolve()
  assert.equal(calls.some(([path]) => path.endsWith('/close')), false)
  finishLaunch()
  await opening; await closing
  assert.deepEqual(calls.filter(([path]) => path.endsWith('/close')), [['/sessions/old/close', 'POST'], ['/sessions/new/close', 'POST']])
})

test('cleanup failures are reported and closing a never-opened card needs no process', async () => {
  const open = createSessionOpener(async path => path === '/auth' ? { authenticated: true } : { sessions: [] })
  await open.close('Codex 1')
  const failed = createSessionOpener(async path => {
    if (path === '/auth') return { authenticated: true }
    if (path === '/sessions') return { sessions: [{ id: '1', title: 'Codex 1' }] }
    throw new Error('Could not clean up')
  })
  await assert.rejects(failed.close('Codex 1'), /Could not clean up/)
})
