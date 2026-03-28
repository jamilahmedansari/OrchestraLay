/**
 * Fire-and-forget POST to n8n webhook.
 * 3s AbortSignal timeout. Silently skips if N8N_WEBHOOK_URL unset.
 */
export function emitEvent(
  event: string,
  payload: Record<string, unknown>
): void {
  const webhookUrl = process.env.N8N_WEBHOOK_URL
  if (!webhookUrl) return

  const secret = process.env.N8N_WEBHOOK_SECRET

  fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-Webhook-Secret': secret } : {}),
    },
    body: JSON.stringify({ event, payload, timestamp: new Date().toISOString() }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {})
}
