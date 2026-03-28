import { diffLines } from 'diff'

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export interface DiffResult {
  hunks: DiffHunk[]
  linesAdded: number
  linesRemoved: number
  isBinaryFile: boolean
}

function isBinary(content: string | null): boolean {
  if (!content) return false
  const sample = content.slice(0, 8000)
  return sample.includes('\0')
}

export function computeDiff(
  before: string | null,
  after: string | null,
  operation: string
): DiffResult {
  if (isBinary(before) || isBinary(after)) {
    return { hunks: [], linesAdded: 0, linesRemoved: 0, isBinaryFile: true }
  }

  const oldStr = before ?? ''
  const newStr = after ?? ''

  const changes = diffLines(oldStr, newStr)

  const hunks: DiffHunk[] = []
  let linesAdded = 0
  let linesRemoved = 0

  let oldLine = 1
  let newLine = 1
  let currentHunk: DiffHunk | null = null

  for (const change of changes) {
    const lineCount = change.count ?? 0

    if (change.added || change.removed) {
      if (!currentHunk) {
        currentHunk = {
          oldStart: oldLine,
          oldLines: 0,
          newStart: newLine,
          newLines: 0,
          lines: [],
        }
      }

      const prefix = change.added ? '+' : '-'
      const changeLines = change.value.replace(/\n$/, '').split('\n')

      for (const line of changeLines) {
        currentHunk.lines.push(`${prefix}${line}`)
      }

      if (change.added) {
        linesAdded += lineCount
        currentHunk.newLines += lineCount
        newLine += lineCount
      } else {
        linesRemoved += lineCount
        currentHunk.oldLines += lineCount
        oldLine += lineCount
      }
    } else {
      if (currentHunk) {
        hunks.push(currentHunk)
        currentHunk = null
      }
      oldLine += lineCount
      newLine += lineCount
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk)
  }

  return { hunks, linesAdded, linesRemoved, isBinaryFile: false }
}
