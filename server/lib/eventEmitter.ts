const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET

export function emitEvent(
  event: string,
  payload: Record<string, unknown>
): void {
  if (!N8N_WEBHOOK_URL) return

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (N8N_WEBHOOK_SECRET) {
    headers['X-Webhook-Secret'] = N8N_WEBHOOK_SECRET
  }

  fetch(N8N_WEBHOOK_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ event, ...payload }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {})
}
