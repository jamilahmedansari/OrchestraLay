export type DiffOperation = 'create' | 'modify' | 'delete'

export interface ParsedFileOperation {
  filePath: string
  operation: DiffOperation
  beforeContent: string | null
  afterContent: string | null
}

/** Strip ../, leading /, and backslashes from paths */
function sanitizePath(rawPath: string): string | null {
  let p = rawPath
    .replace(/\\/g, '/')       // backslashes → forward
    .replace(/\.\.\//g, '')    // strip ../
    .replace(/^\/+/, '')       // strip leading /

  p = p.trim()
  if (!p || p === '.' || p === '..') return null
  return p
}

function extractTagContent(xml: string, tag: string): string {
  const openTag = `<${tag}>`
  const closeTag = `</${tag}>`
  const startIdx = xml.indexOf(openTag)
  const endIdx = xml.indexOf(closeTag)
  if (startIdx === -1 || endIdx === -1) return ''
  return xml.slice(startIdx + openTag.length, endIdx).trim()
}

/** Parse <file_changes> XML from model output. Invalid entries silently skipped. */
export function parseModelOutput(content: string): ParsedFileOperation[] {
  const results: ParsedFileOperation[] = []

  // Find <file_changes> block
  const changesStart = content.indexOf('<file_changes>')
  const changesEnd = content.indexOf('</file_changes>')
  if (changesStart === -1 || changesEnd === -1) return results

  const changesBlock = content.slice(changesStart, changesEnd + '</file_changes>'.length)

  // Match each <file ...> block
  const fileRegex = /<file\s+path="([^"]+)"\s+operation="([^"]+)">([\s\S]*?)<\/file>/g
  let match: RegExpExecArray | null

  while ((match = fileRegex.exec(changesBlock)) !== null) {
    const rawPath = match[1]
    const operation = match[2] as DiffOperation
    const fileBlock = match[3]

    if (!['create', 'modify', 'delete'].includes(operation)) continue

    const sanitized = sanitizePath(rawPath)
    if (!sanitized) continue

    const beforeContent = extractTagContent(fileBlock, 'before_content') || null
    const afterContent = extractTagContent(fileBlock, 'after_content') || null

    results.push({
      filePath: sanitized,
      operation,
      beforeContent,
      afterContent,
    })
  }

  return results
}
