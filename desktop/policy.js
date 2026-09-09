export function validURL(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\\]/.test(value)) return false
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !!u.hostname && !u.username && !u.password } catch { return false }
}
export function validID(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id) }
export function bounds(value, size) {
  if (!value || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(value[k]))) throw new Error('Invalid browser bounds.')
  const x = Math.max(0, Math.min(size[0], Math.round(value.x)))
  const y = Math.max(0, Math.min(size[1], Math.round(value.y)))
  return { x, y, width: Math.max(0, Math.min(size[0] - x, Math.round(value.width))), height: Math.max(0, Math.min(size[1] - y, Math.round(value.height))) }
}
export function validatePlan(plan, count) {
  if (!plan || typeof plan.message !== 'string' || plan.message.length > 1000 || !Array.isArray(plan.commands) || plan.commands.length > 4) throw new Error('Invalid browser plan.')
  for (const [i, c] of plan.commands.entries()) {
    if (!c || typeof c.value !== 'string') throw new Error('Invalid browser command.')
    const allowed = { viewport: ['full', '390', '768'], press: ['Enter', 'Tab', 'Escape', 'Backspace'], scroll: ['up', 'down', 'top', 'bottom'], back: [''], forward: [''], reload: [''], shelf: [''] }
    const ok = c.action === 'navigate' ? validURL(c.value) : c.action === 'click' ? /^\d+$/.test(c.value) && +c.value >= 1 && +c.value <= count : c.action === 'type' ? c.value.length > 0 && c.value.length <= 4000 : allowed[c.action]?.includes(c.value)
    if (!ok || (c.action === 'shelf' && i !== plan.commands.length - 1)) throw new Error('Invalid browser command.')
  }
  return plan
}
