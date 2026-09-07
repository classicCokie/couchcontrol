// Text ranges expose actual wrapped preview lines without changing the Markdown DOM.
export function renderedLines(root) {
  if (!root) return []
  const origin = root.getBoundingClientRect()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  const rectangles = []
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent.trim()) continue
    range.selectNodeContents(walker.currentNode)
    for (const rect of range.getClientRects()) {
      if (rect.width && rect.height) rectangles.push({
        top: rect.top - origin.top, bottom: rect.bottom - origin.top,
        left: rect.left - origin.left, right: rect.right - origin.left,
      })
    }
  }
  rectangles.sort((a, b) => a.top - b.top || a.left - b.left)
  const lines = []
  for (const rect of rectangles) {
    const last = lines.at(-1)
    const overlap = last && Math.min(last.bottom, rect.bottom) - Math.max(last.top, rect.top)
    if (last && overlap > Math.min(last.bottom - last.top, rect.bottom - rect.top) * .5) {
      last.top = Math.min(last.top, rect.top); last.bottom = Math.max(last.bottom, rect.bottom)
      last.left = Math.min(last.left, rect.left); last.right = Math.max(last.right, rect.right)
    } else lines.push({ ...rect })
  }
  return lines
}

// Only inspect text nodes that touch this row, then retain characters on that row.
// This keeps wrapped paragraphs and inline emphasis aligned with what is highlighted.
export function renderedLineText(root, line) {
  if (!root || !line) return ''
  const origin = root.getBoundingClientRect()
  const matches = rect => {
    const center = (rect.top + rect.bottom) / 2 - origin.top
    return rect.width > 0 && center >= line.top && center <= line.bottom
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let text = ''
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!node.textContent.trim()) continue
    range.selectNodeContents(node)
    if (![...range.getClientRects()].some(matches)) continue
    for (let i = 0; i < node.length; i++) {
      range.setStart(node, i); range.setEnd(node, i + 1)
      if ([...range.getClientRects()].some(matches)) text += node.textContent[i]
    }
  }
  return text.trim()
}
