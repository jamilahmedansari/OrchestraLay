import type { DiffOperation, ParsedFileOperation } from './outputParser.js'

export interface SafetyViolation {
  rule: string
  severity: 'warn' | 'block'
  message: string
}

export interface ProjectSafetyRules {
  allowFileDeletion: boolean
  allowFrameworkChanges: boolean
  allowTestFileDeletion: boolean
  customBlockedPaths: string[]
}

export interface SafetyOverrides {
  allowFileDeletion?: boolean
  allowFrameworkChanges?: boolean
  allowTestFileDeletion?: boolean
}

const PROTECTED_FILE_PATTERNS = [
  /^\.env/,
  /\.lock$/,
  /\.lockb$/,
  /^package-lock\.json$/,
]

const FRAMEWORK_FILE_PATTERNS = [
  /^package\.json$/,
  /^tsconfig\.json$/,
  /^vite\.config\./,
  /^next\.config\./,
  /^tailwind\.config\./,
]

const CONFIG_FILE_PATTERNS = [
  /\.config\./,
  /^\.eslintrc/,
  /^\.prettierrc/,
  /^Dockerfile$/,
  /^docker-compose\./,
]

const TEST_FILE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /__tests__\//,
  /\/tests?\//,
]

const SECRET_PATTERNS = [
  /api_key\s*=\s*/i,
  /sk-[a-z0-9]{20,}/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /PRIVATE KEY/,
]

function matchesAny(filePath: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(filePath))
}

export function checkSafetyRules(
  op: ParsedFileOperation,
  projectRules: ProjectSafetyRules,
  overrides: SafetyOverrides = {}
): SafetyViolation[] {
  const violations: SafetyViolation[] = []
  const { filePath, operation, afterContent } = op

  const rules = {
    allowFileDeletion: overrides.allowFileDeletion ?? projectRules.allowFileDeletion,
    allowFrameworkChanges: overrides.allowFrameworkChanges ?? projectRules.allowFrameworkChanges,
    allowTestFileDeletion: overrides.allowTestFileDeletion ?? projectRules.allowTestFileDeletion,
  }

  // Rule 1: protected_file — .env*, lockfiles
  if (matchesAny(filePath, PROTECTED_FILE_PATTERNS)) {
    violations.push({
      rule: 'protected_file',
      severity: 'block',
      message: `Protected file: ${filePath}`,
    })
  }

  // Rule 2: file_deletion
  if (operation === 'delete' && !rules.allowFileDeletion) {
    violations.push({
      rule: 'file_deletion',
      severity: 'block',
      message: `File deletion not allowed: ${filePath}`,
    })
  }

  // Rule 3: framework_change
  if (matchesAny(filePath, FRAMEWORK_FILE_PATTERNS) && !rules.allowFrameworkChanges) {
    violations.push({
      rule: 'framework_change',
      severity: 'block',
      message: `Framework file change blocked: ${filePath}`,
    })
  }

  // Rule 4: config_file_change
  if (matchesAny(filePath, CONFIG_FILE_PATTERNS)) {
    violations.push({
      rule: 'config_file_change',
      severity: 'warn',
      message: `Config file change: ${filePath}`,
    })
  }

  // Rule 5: test_deletion
  if (operation === 'delete' && matchesAny(filePath, TEST_FILE_PATTERNS) && !rules.allowTestFileDeletion) {
    violations.push({
      rule: 'test_deletion',
      severity: 'block',
      message: `Test file deletion blocked: ${filePath}`,
    })
  }

  // Rule 6: custom_blocked_path
  for (const blocked of projectRules.customBlockedPaths) {
    if (filePath.includes(blocked)) {
      violations.push({
        rule: 'custom_blocked_path',
        severity: 'block',
        message: `Custom blocked path: ${filePath} matches ${blocked}`,
      })
      break
    }
  }

  // Rule 7: large_change
  if (operation === 'modify' && op.beforeContent) {
    const beforeLines = op.beforeContent.split('\n').length
    const afterLines = (afterContent ?? '').split('\n').length
    const maxLines = Math.max(beforeLines, afterLines)
    const changedLines = Math.abs(afterLines - beforeLines)
    if (beforeLines > 50 && maxLines > 0 && (changedLines / maxLines) > 0.8) {
      violations.push({
        rule: 'large_change',
        severity: 'warn',
        message: `Large change: ${filePath} (${beforeLines} lines, >80% changed)`,
      })
    }
  }

  // Rule 8: potential_secret
  if (afterContent) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(afterContent)) {
        violations.push({
          rule: 'potential_secret',
          severity: 'block',
          message: `Potential secret detected in ${filePath}`,
        })
        break
      }
    }
  }

  return violations
}
