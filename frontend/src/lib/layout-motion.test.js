import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLayoutMotion, rectTransform } from './layout-motion.js'

const full = { left: 0, top: 0, width: 1200, height: 800 }
const half = { left: 604, top: 8, width: 588, height: 730 }
function element() {
  const calls = { reads: 0, animations: [] }
  const node = { isConnected: true, rect: full, style: { willChange: '' },
    getBoundingClientRect() { calls.reads++; return this.rect },
    animate(frames, options) {
      let finish, reject
      const animation = { frames, options, canceled: false,
        finished: new Promise((resolve, fail) => { finish = resolve; reject = fail }),
        cancel() { this.canceled = true; reject(new Error('canceled')) },
        finish() { finish() },
      }
      calls.animations.push(animation)
      return animation
    },
  }
  return { node, calls }
}

test('pane motion measures once before and after layout and animates only transforms', async () => {
  const { node, calls } = element(), motion = createLayoutMotion()
  const play = motion.capture(node)
  node.rect = half
  play()
  assert.equal(calls.reads, 2)
  const animation = calls.animations[0]
  assert.equal(animation.frames[0].transform, rectTransform(full, half))
  assert.deepEqual(animation.frames.map(frame => Object.keys(frame)), [['transform'], ['transform']])
  assert.equal(node.style.willChange, 'transform')
  animation.finish()
  await animation.finished
  assert.equal(animation.canceled, true)
  assert.equal(node.style.willChange, '')
  assert.equal(calls.reads, 2)
})

test('interrupted splits start at the visible frame and old completion cannot cancel the new motion', async () => {
  const { node, calls } = element(), motion = createLayoutMotion()
  const first = motion.capture(node)
  node.rect = half; first()
  const midway = { left: 302, top: 4, width: 894, height: 765 }
  node.rect = midway
  const second = motion.capture(node)
  node.rect = full; second()
  await Promise.resolve()
  assert.equal(calls.animations[0].canceled, true)
  assert.equal(calls.animations[1].canceled, false)
  assert.equal(calls.animations[1].frames[0].transform, rectTransform(midway, full))
  motion.cancel()
  assert.equal(node.style.willChange, '')
})

test('reduced motion, stale updates, detached panes, and unchanged layouts do not animate', () => {
  const { node, calls } = element(), motion = createLayoutMotion()
  motion.capture(node, true)()
  assert.equal(calls.reads, 0)
  const stale = motion.capture(node)
  motion.cancel()
  node.rect = half; stale()
  motion.capture(node)()
  const detached = motion.capture(node)
  node.isConnected = false; detached()
  assert.equal(calls.animations.length, 0)
})
