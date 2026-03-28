import type { ParsedFileOperation } from './outputParser.js'

export interface SafetyViolation {
  rule: string
  severity: 'warn' | 'block'
  message: string
}

interface ProjectSafetyRules {
  allowFileDeletion?: boolean
  allowFrameworkChanges?: boolean
  allowTestFileDeletion?: boolean
  customBlockedPaths?: string[]
}

interface SafetyOverrides {
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

export function checkSafetyRules(
  op: ParsedFileOperation,
  projectRules: ProjectSafetyRules,
  overrides?: SafetyOverrides
): SafetyViolation[] {
  const violations: SafetyViolation[] = []
  const rules = { ...projectRules, ...overrides }
  const fileName = op.filePath.split('/').pop() ?? op.filePath

  // 1. Protected file
  if (PROTECTED_FILE_PATTERNS.some((p) => p.test(fileName) || p.test(op.filePath))) {
    violations.push({
      rule: 'protected_file',
      severity: 'block',
      message: `Protected file: ${op.filePath}`,
    })
  }

  // 2. File deletion
  if (op.operation === 'delete' && !rules.allowFileDeletion) {
    violations.push({
      rule: 'file_deletion',
      severity: 'block',
      message: `File deletion not allowed: ${op.filePath}`,
    })
  }

  // 3. Framework change
  if (
    FRAMEWORK_FILE_PATTERNS.some((p) => p.test(fileName)) &&
    !rules.allowFrameworkChanges
  ) {
    violations.push({
      rule: 'framework_change',
      severity: 'block',
      message: `Framework config change: ${op.filePath}`,
    })
  }

  // 4. Config file change
  if (CONFIG_FILE_PATTERNS.some((p) => p.test(fileName) || p.test(op.filePath))) {
    violations.push({
      rule: 'config_file_change',
      severity: 'warn',
      message: `Config file modified: ${op.filePath}`,
    })
  }

  // 5. Test deletion
  if (
    op.operation === 'delete' &&
    TEST_FILE_PATTERNS.some((p) => p.test(op.filePath)) &&
    !rules.allowTestFileDeletion
  ) {
    violations.push({
      rule: 'test_deletion',
      severity: 'block',
      message: `Test file deletion not allowed: ${op.filePath}`,
    })
  }

  // 6. Custom blocked paths
  if (rules.customBlockedPaths?.length) {
    for (const blocked of rules.customBlockedPaths) {
      if (op.filePath.startsWith(blocked) || op.filePath === blocked) {
        violations.push({
          rule: 'custom_blocked_path',
          severity: 'block',
          message: `Path blocked by project rules: ${op.filePath}`,
        })
      }
    }
  }

  // 7. Large change
  if (op.beforeContent && op.afterContent) {
    const beforeLines = op.beforeContent.split('\n').length
    if (beforeLines > 50) {
      const afterLines = op.afterContent.split('\n').length
      const changeRatio = Math.abs(afterLines - beforeLines) / beforeLines
      if (changeRatio > 0.8) {
        violations.push({
          rule: 'large_change',
          severity: 'warn',
          message: `Large change: ${Math.round(changeRatio * 100)}% of ${beforeLines}-line file modified`,
        })
      }
    }
  }

  // 8. Potential secret
  if (op.afterContent) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(op.afterContent)) {
        violations.push({
          rule: 'potential_secret',
          severity: 'block',
          message: `Potential secret detected in ${op.filePath}`,
        })
        break
      }
    }
  }

  return violations
}
