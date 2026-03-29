// outputParser.ts — parse <file_changes> XML from model output

export type FileChange = {
  path: string
  operation: 'create' | 'modify' | 'delete'
  content: string
}

export function parseFileChanges(raw: string): FileChange[] {
  const changes: FileChange[] = []
  const blockRegex = /<file_change\s+path="([^"]+)"\s+operation="([^"]+)">([\s\S]*?)<\/file_change>/g
  let match: RegExpExecArray | null

  while ((match = blockRegex.exec(raw)) !== null) {
    const [, path, operation, content] = match
    if (!path || !operation) continue
    const op = operation as FileChange['operation']
    if (!['create', 'modify', 'delete'].includes(op)) continue
    changes.push({ path: path.trim(), operation: op, content: content.trim() })
  }

  return changes
}

export function hasFileChanges(raw: string): boolean {
  return /<file_changes>/.test(raw)
}
