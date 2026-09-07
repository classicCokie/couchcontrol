import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAddress } from './address.js'

test('local development addresses use HTTP and preserve routes', () => {
  for (const host of ['localhost:3000', '127.0.0.1:5173', '192.168.1.40:8080', '[::1]:3000', 'workstation:8000', 'demo.local:3000']) {
    assert.equal(normalizeAddress(`${host}/review?q=one#two`), `http://${host}/review?q=one#two`)
  }
})

test('remote addresses default to HTTPS and explicit schemes stay intact', () => {
  assert.equal(normalizeAddress(' example.com/review '), 'https://example.com/review')
  assert.equal(normalizeAddress('https://localhost:3000'), 'https://localhost:3000/')
  assert.equal(normalizeAddress('http://example.com'), 'http://example.com/')
})

test('rejects executable URLs, files, credentials, malformed addresses and empty input', () => {
  for (const address of ['', '  ', 'javascript:alert(1)', 'data:text/html,test', 'file:///tmp/index.html', '/tmp/index.html', 'ftp://example.com', 'https://user:pass@example.com', 'http://', 'hello world', 'localhost:99999', 'https://[invalid]']) {
    assert.throws(() => normalizeAddress(address), Error, address)
  }
})
