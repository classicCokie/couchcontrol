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
