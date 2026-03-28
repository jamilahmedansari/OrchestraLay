import { diffLines, type Change } from 'diff'
import type { DiffOperation } from './outputParser.js'

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  content: string
}

export interface DiffResult {
  hunks: DiffHunk[]
  linesAdded: number
  linesRemoved: number
  isBinaryFile: boolean
}

/** Check for null bytes in first 8000 chars — binary detection */
function isBinary(content: string | null): boolean {
  if (!content) return false
  const sample = content.slice(0, 8000)
  return sample.includes('\0')
}

export function computeDiff(
  before: string | null,
  after: string | null,
  operation: DiffOperation
): DiffResult {
  // Binary detection
  if (isBinary(before) || isBinary(after)) {
    return { hunks: [], linesAdded: 0, linesRemoved: 0, isBinaryFile: true }
  }

  const oldText = before ?? ''
  const newText = after ?? ''

  if (operation === 'create') {
    const lines = newText.split('\n')
    return {
      hunks: [{
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: lines.length,
        content: lines.map((l) => `+${l}`).join('\n'),
      }],
      linesAdded: lines.length,
      linesRemoved: 0,
      isBinaryFile: false,
    }
  }

  if (operation === 'delete') {
    const lines = oldText.split('\n')
    return {
      hunks: [{
        oldStart: 1,
        oldLines: lines.length,
        newStart: 0,
        newLines: 0,
        content: lines.map((l) => `-${l}`).join('\n'),
      }],
      linesAdded: 0,
      linesRemoved: lines.length,
      isBinaryFile: false,
    }
  }

  // modify
  const changes: Change[] = diffLines(oldText, newText)
  const hunks: DiffHunk[] = []
  let linesAdded = 0
  let linesRemoved = 0
  let oldLine = 1
  let newLine = 1

  let currentHunk: DiffHunk | null = null

  for (const change of changes) {
    const lineCount = change.count ?? 0

    if (change.added) {
      if (!currentHunk) {
        currentHunk = { oldStart: oldLine, oldLines: 0, newStart: newLine, newLines: 0, content: '' }
      }
      currentHunk.newLines += lineCount
      currentHunk.content += (change.value.endsWith('\n') ? change.value.slice(0, -1) : change.value)
        .split('\n')
        .map((l) => `+${l}`)
        .join('\n') + '\n'
      linesAdded += lineCount
      newLine += lineCount
    } else if (change.removed) {
      if (!currentHunk) {
        currentHunk = { oldStart: oldLine, oldLines: 0, newStart: newLine, newLines: 0, content: '' }
      }
      currentHunk.oldLines += lineCount
      currentHunk.content += (change.value.endsWith('\n') ? change.value.slice(0, -1) : change.value)
        .split('\n')
        .map((l) => `-${l}`)
        .join('\n') + '\n'
      linesRemoved += lineCount
      oldLine += lineCount
    } else {
      // Context — flush current hunk
      if (currentHunk) {
        hunks.push(currentHunk)
        currentHunk = null
      }
      oldLine += lineCount
      newLine += lineCount
    }
  }

  if (currentHunk) hunks.push(currentHunk)

  return { hunks, linesAdded, linesRemoved, isBinaryFile: false }
}
