// Claude's composer is bounded by horizontal rules and starts with ❯ plus a
// space (or NBSP). Requiring both rules excludes trust and permission pickers.
function prompt(buffer) {
  if (!buffer) return null
  const cursorRow = buffer.baseY + buffer.cursorY
  let start = cursorRow
  while (start >= buffer.baseY) {
    const line = buffer.getLine(start)
    const text = line?.translateToString(false) || ''
    if (!line?.isWrapped && /^❯[ \u00a0]/.test(text)) break
    if (!line || (!line.isWrapped && !text.startsWith('  '))) return null
    start--
  }
  const rule = row => /^─{4,}\s*$/.test(buffer.getLine(row)?.translateToString(false) || '')
  if (!rule(start - 1)) return null
  let end = start + 1
  while (end < buffer.length && !rule(end)) {
    const line = buffer.getLine(end)
    if (!line || (!line.isWrapped && !line.translateToString(false).startsWith('  '))) return null
    end++
  }
  return end < buffer.length && cursorRow < end ? { start, end, cursorRow } : null
}
function placeholder(cell) {
  if (cell.isDim()) return true
  // Claude themes use gray foreground for suggestions rather than ANSI dim.
  if (cell.isFgPalette?.()) return [8, 244, 245, 246].includes(cell.getFgColor())
  if (!cell.isFgRGB?.()) return false
  const color = cell.getFgColor(), r = color >> 16 & 255, g = color >> 8 & 255, b = color & 255
  return r === g && g === b && r >= 80 && r <= 180
}
export function composerState(buffer) {
  const block = prompt(buffer)
  if (!block) return 'unknown'
  let draft = false
  for (let y = block.start; y < block.end; y++) {
    const line = buffer.getLine(y)
    for (let x = line.isWrapped ? 0 : 2; x < line.length; x++) {
      const cell = line.getCell(x)
      if (cell?.getChars().trim() && !placeholder(cell)) draft = true
    }
  }
  if (draft) return 'draft'
  return block.cursorRow === block.start && buffer.cursorX === 2 ? 'empty' : 'unknown'
}
export const isEmptyComposer = buffer => composerState(buffer) === 'empty'
