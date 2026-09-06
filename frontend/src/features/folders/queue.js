// Opening a group can ask for two Codex folders at once. Present them in order.
export function createFolderQueue(changed) {
  let requests = []
  function remove(request, path) {
    const wasFirst = requests[0] === request
    requests = requests.filter(item => item !== request)
    request.cleanup()
    request.resolve(path)
    if (wasFirst) changed(requests[0] || null)
  }
  return {
    choose(options = {}) {
      return new Promise(resolve => {
        if (options.signal?.aborted) { resolve(null); return }
        const request = { ...options, resolve, cleanup: () => options.signal?.removeEventListener('abort', abort) }
        const abort = () => remove(request, null)
        options.signal?.addEventListener('abort', abort, { once: true })
        requests.push(request)
        if (requests.length === 1) changed(request)
      })
    },
    finish(path) { if (requests[0]) remove(requests[0], path) },
    cancelAll() {
      const pending = requests
      requests = []
      changed(null)
      for (const request of pending) { request.cleanup(); request.resolve(null) }
    },
  }
}
