import type { SmsSender } from '../ports.js'
import { isE164 } from '../core/domain/sms.js'

interface SmsEnv {
  SMS_PROVIDER?: string
  TELNYX_API_KEY?: string
  TELNYX_FROM?: string
  TELNYX_MESSAGING_PROFILE_ID?: string
  SMS_PHONE_QUESTION_ID?: string
  SMS_CONSENT_QUESTION_ID?: string
}

export function selectSmsDelivery(env: SmsEnv): { delivery: 'none' | 'telnyx'; problem: string | null } {
  const provider = env.SMS_PROVIDER?.trim().toLowerCase()
  if (!provider || provider === 'none') return { delivery: 'none', problem: null }
  if (provider !== 'telnyx') return { delivery: 'none', problem: 'SMS_PROVIDER must be none or telnyx; SMS is disabled' }
  if (!env.TELNYX_API_KEY?.trim() || !isE164(env.TELNYX_FROM?.trim() ?? '') || !env.SMS_PHONE_QUESTION_ID?.trim() || !env.SMS_CONSENT_QUESTION_ID?.trim() || env.SMS_PHONE_QUESTION_ID.trim() === env.SMS_CONSENT_QUESTION_ID.trim()) {
    return { delivery: 'none', problem: 'Telnyx requires TELNYX_API_KEY, an E.164 TELNYX_FROM, and distinct SMS_PHONE_QUESTION_ID and SMS_CONSENT_QUESTION_ID; SMS is disabled' }
  }
  return { delivery: 'telnyx', problem: null }
}

/** Hosted numbers and Telnyx toll-free numbers use the same messaging API. */
export function createTelnyxSender(opts: { apiKey: string; from: string; messagingProfileId?: string; fetch?: typeof fetch }): SmsSender {
  return {
    async send(message) {
      if (!isE164(opts.from) || !isE164(message.to)) throw new Error('SMS requires E.164 phone numbers')
      let response: Response
      try {
        response = await (opts.fetch ?? fetch)('https://api.telnyx.com/v2/messages', {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: opts.from, to: message.to, text: message.text, ...(opts.messagingProfileId ? { messaging_profile_id: opts.messagingProfileId } : {}) }),
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        })
      } catch {
        throw new Error('Telnyx SMS request failed or timed out')
      }
      // Do not parse or log provider bodies: they can echo phone numbers and message tokens.
      await response.body?.cancel().catch(() => {})
      if (!response.ok) throw new Error(`Telnyx SMS rejected (HTTP ${response.status})`)
    },
  }
}
