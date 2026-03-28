export interface ParsedFileOperation {
  filePath: string
  operation: 'create' | 'modify' | 'delete'
  beforeContent: string | null
  afterContent: string | null
}

function sanitizePath(raw: string): string | null {
  let p = raw.trim()
  p = p.replace(/\\/g, '/')
  p = p.replace(/\.\.\//g, '')
  p = p.replace(/^\/+/, '')

  if (!p || p.includes('\0')) return null
  return p
}

export function parseModelOutput(content: string): ParsedFileOperation[] {
  const results: ParsedFileOperation[] = []

  const fileChangesMatch = content.match(/<file_changes>([\s\S]*?)<\/file_changes>/g)
  if (!fileChangesMatch) return results

  for (const block of fileChangesMatch) {
    const inner = block.replace(/<\/?file_changes>/g, '')
    const fileBlocks = inner.match(/<file>([\s\S]*?)<\/file>/g)
    if (!fileBlocks) continue

    for (const fileBlock of fileBlocks) {
      const fileInner = fileBlock.replace(/<\/?file>/g, '')

      const pathMatch = fileInner.match(/<path>([\s\S]*?)<\/path>/)
      const opMatch = fileInner.match(/<operation>([\s\S]*?)<\/operation>/)
      const beforeMatch = fileInner.match(/<before_content>([\s\S]*?)<\/before_content>/)
      const afterMatch = fileInner.match(/<after_content>([\s\S]*?)<\/after_content>/)

      if (!pathMatch || !opMatch) continue

      const filePath = sanitizePath(pathMatch[1])
      if (!filePath) continue

      const operation = opMatch[1].trim() as ParsedFileOperation['operation']
      if (!['create', 'modify', 'delete'].includes(operation)) continue

      results.push({
        filePath,
        operation,
        beforeContent: beforeMatch ? beforeMatch[1] : null,
        afterContent: afterMatch ? afterMatch[1] : null,
      })
    }
  }

  return results
}
