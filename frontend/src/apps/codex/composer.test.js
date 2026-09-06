import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isEmptyComposer } from './composer.js'

function buffer(text, { cursorX = 2, dim = true, wrapped = false } = {}) {
  const line = {
    length: text.length, isWrapped: wrapped,
    translateToString: () => text,
    getCell: x => ({ getChars: () => text[x], isDim: () => x >= 2 && dim }),
  }
  return { baseY: 5, cursorY: 3, cursorX, length: 9, getLine: row => row === 8 ? line : undefined }
}

test('recognizes the dim empty placeholder at the live cursor despite scrollback', () => {
  assert.equal(isEmptyComposer(buffer('› Ask Codex to do anything')), true)
})

test('existing text, cursor moved home, multiline continuations and other screens are not empty', () => {
  assert.equal(isEmptyComposer(buffer('› hello', { cursorX: 7, dim: false })), false)
  assert.equal(isEmptyComposer(buffer('› hello', { dim: false })), false)
  assert.equal(isEmptyComposer(buffer('› Ask Codex', { wrapped: true })), false)
  assert.equal(isEmptyComposer(buffer('Trust this folder?')), false)
  assert.equal(isEmptyComposer(buffer('› ')), false)
  assert.equal(isEmptyComposer(null), false)
})

test('wrapped placeholder accepts only dim content on continuation rows', () => {
  const value = buffer('› Ask Codex')
  const first = value.getLine(8)
  value.length = 10
  const continuation = { isWrapped: true, length: 3, getCell: () => ({ getChars: () => 'a', isDim: () => true }) }
  value.getLine = row => row === 8 ? first : continuation
  assert.equal(isEmptyComposer(value), true)
  continuation.getCell = () => ({ getChars: () => 'a', isDim: () => false })
  assert.equal(isEmptyComposer(value), false)
})
