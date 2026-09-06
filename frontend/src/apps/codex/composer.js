// Codex paints its empty composer placeholder dim, with the cursor just after
// “› ”. Fail closed for other screens, existing text, or an unfamiliar UI.
export function isEmptyComposer(buffer) {
  if (!buffer || buffer.cursorX !== 2) return false
  const row = buffer.baseY + buffer.cursorY
  const line = buffer.getLine(row)
  if (!line || line.isWrapped || !line.translateToString(false).startsWith('› ')) return false
  let placeholder = false
  for (let y = row; y < buffer.length; y++) {
    const current = buffer.getLine(y)
    if (y > row && !current?.isWrapped) break
    for (let x = y === row ? 2 : 0; x < current.length; x++) {
      const cell = current.getCell(x)
      if (!cell || !cell.getChars().trim()) continue
      if (!cell.isDim()) return false
      placeholder = true
    }
  }
  return placeholder
}

// Codex renders hard line breaks with a two-column indent and soft wraps as
// wrapped terminal rows. Follow only that composer block back from its cursor.
export function composerState(buffer) {
  if (isEmptyComposer(buffer)) return 'empty'
  if (!buffer || buffer.cursorX < 2) return 'unknown'
  let row = buffer.baseY + buffer.cursorY
  let line = buffer.getLine(row)
  while (row >= buffer.baseY && line) {
    const text = line.translateToString(false)
    if (!line.isWrapped && text.startsWith('› ')) {
      // A non-placeholder glyph identifies a draft, including a cursor moved
      // back to its start. Never send Ctrl+C for a bare or unfamiliar prompt.
      for (let y = row; y <= buffer.baseY + buffer.cursorY; y++) {
        const current = buffer.getLine(y)
        for (let x = 2; x < current.length; x++) {
          const cell = current.getCell(x)
          if (cell?.getChars().trim() && !cell.isDim()) return 'draft'
        }
      }
      return 'unknown'
    }
    if (!line.isWrapped && !text.startsWith('  ')) return 'unknown'
    line = buffer.getLine(--row)
  }
  return 'unknown'
}
