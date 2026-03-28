/**
 * Estimate token count from text length.
 * Called before resolveModel() — must exist or worker crashes (Bug 2 fix).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
