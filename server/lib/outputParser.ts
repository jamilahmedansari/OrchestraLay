// outputParser.ts — parse <file_changes> XML from model output

export type FileChange = {
  path: string
  operation: 'create' | 'modify' | 'delete'
  content: string
}

export function parseFileChanges(raw: string): FileChange[] {
  const changes: FileChange[] = []
  // Matches <file path="..." operation="...">...</file> as used in the SYSTEM_PROMPT
  const blockRegex = /<file\s+path="([^"]+)"\s+operation="([^"]+)">([\s\S]*?)<\/file>/g
  let match: RegExpExecArray | null

  while ((match = blockRegex.exec(raw)) !== null) {
    const [, path, operation, innerContent] = match
    if (!path || !operation) continue
    const op = operation as FileChange['operation']
    if (!['create', 'modify', 'delete'].includes(op)) continue

    // Extract <after_content> if present, otherwise use raw inner content
    const afterMatch = /<after_content>([\s\S]*?)<\/after_content>/.exec(innerContent || '')
    const content = afterMatch?.[1] ? afterMatch[1].trim() : (innerContent || '').trim()

    changes.push({ path: path.trim(), operation: op, content })
  }

  return changes
}

export function hasFileChanges(raw: string): boolean {
  return /<file_changes>/.test(raw)
}
