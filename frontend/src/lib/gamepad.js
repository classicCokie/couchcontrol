// Standard browser mapping: south/east face buttons, D-pad, left stick.
export function createGamepadReader() {
  let direction = ''
  let nextRepeat = 0
  let wasConfirm = false
  let wasBack = false
  let wasTrigger = false
  let wasPaste = false

  return (pad, now) => {
    const pressed = index => pad.buttons[index]?.pressed ?? false
    const x = pad.axes[0] ?? 0
    const y = pad.axes[1] ?? 0
    const horizontal = Number(pressed(15)) - Number(pressed(14))
    const vertical = Number(pressed(13)) - Number(pressed(12))
    let nextDirection = ''
    if (horizontal) nextDirection = horizontal > 0 ? 'right' : 'left'
    else if (vertical) nextDirection = vertical > 0 ? 'down' : 'up'
    else if (Math.max(Math.abs(x), Math.abs(y)) > 0.55) {
      nextDirection = Math.abs(x) >= Math.abs(y)
        ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up')
    }

    const confirm = pressed(0)
    const back = pressed(1)
    const paste = pressed(2)
    const value = pad.buttons[7]?.value ?? 0
    const trigger = pressed(7) || value > (wasTrigger ? 0.2 : 0.55)
    const actions = []
    if (trigger && !wasTrigger) actions.push('record-start')
    if (back && !wasBack) actions.push('back')
    else if (confirm && !wasConfirm) actions.push('confirm')
    else if (paste && !wasPaste) actions.push('paste')
    else if (nextDirection && (nextDirection !== direction || now >= nextRepeat)) {
      actions.push(nextDirection)
    }
    // Cancel takes priority over a release in the same frame: never upload it.
    if (!trigger && wasTrigger) actions.push('record-end')
    wasTrigger = trigger
    if (nextDirection !== direction) nextRepeat = now + 400
    else if (actions.includes(nextDirection)) nextRepeat = now + 180
    direction = nextDirection
    wasConfirm = confirm
    wasBack = back
    wasPaste = paste
    return actions
  }
}

export function startGamepadControls({ onAction, onConnection, win = window, doc = document, nav = navigator }) {
  if (typeof nav.getGamepads !== 'function') return () => {}
  let request
  let identity = null
  let reader = createGamepadReader()
  let armed = false
  let connected = false
  let triggerHeld = false
  const cancelTrigger = () => { if (triggerHeld) onAction('record-cancel'); triggerHeld = false }

  function poll(now) {
    let pads
    try { pads = Array.from(nav.getGamepads()) } catch {
      // Browsers may disable controller access through their permissions policy.
      cancelTrigger()
      onConnection(false)
      return
    }
    const pad = pads.find(pad => pad?.connected && pad.mapping === 'standard')
    const nextIdentity = pad ? `${pad.index}:${pad.id}` : null
    if (nextIdentity !== identity) {
      cancelTrigger()
      identity = nextIdentity
      reader = createGamepadReader()
      armed = false
    }
    if (Boolean(pad) !== connected) {
      connected = Boolean(pad)
      onConnection(connected)
    }
    if (!pad || doc.hidden || !doc.hasFocus()) {
      cancelTrigger()
      armed = false
      reader = createGamepadReader()
    } else if (!armed) {
      // Require release after connection/refocus so a held button cannot open a title.
      armed = !pad.buttons.some(button => button.pressed)
        && pad.axes.every(axis => Math.abs(axis) < 0.3)
    } else {
      for (const action of reader(pad, now)) {
        if (action === 'record-start') triggerHeld = true
        if (action === 'record-end') triggerHeld = false
        onAction(action)
      }
    }
    request = win.requestAnimationFrame(poll)
  }

  request = win.requestAnimationFrame(poll)
  return () => { cancelTrigger(); win.cancelAnimationFrame(request) }
}
