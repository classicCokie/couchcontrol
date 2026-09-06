const identity = 'translate3d(0, 0, 0) scale(1, 1)'

// Measure only at layout boundaries. Native transform interpolation can run on
// the compositor without JavaScript, layout, or terminal resizing on each frame.
export function rectTransform(from, to) {
  return `translate3d(${from.left - to.left}px, ${from.top - to.top}px, 0) scale(${from.width / to.width}, ${from.height / to.height})`
}

export function createLayoutMotion() {
  let revision = 0, running
  function cancel() {
    revision++
    if (!running) return
    running.animation.cancel()
    running.node.style.willChange = running.willChange
    running = undefined
  }
  function capture(node, reducedMotion = false) {
    // Capture the currently presented frame before canceling an interrupted move.
    const from = !reducedMotion && node?.isConnected ? node.getBoundingClientRect() : null
    cancel()
    const id = revision
    return () => {
      if (!from || id !== revision || !node.isConnected || typeof node.animate !== 'function') return
      const to = node.getBoundingClientRect()
      if (!from.width || !from.height || !to.width || !to.height) return
      if (['left', 'top', 'width', 'height'].every(key => from[key] === to[key])) return
      const transform = rectTransform(from, to)
      const willChange = node.style.willChange
      node.style.willChange = 'transform'
      const animation = node.animate([{ transform }, { transform: identity }], {
        duration: 440, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both',
      })
      running = { animation, node, willChange }
      animation.finished.then(() => { if (id === revision) cancel() }, () => { if (id === revision) cancel() })
    }
  }
  return { capture, cancel }
}
