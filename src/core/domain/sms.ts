import type { EventType } from './types.js'
import type { EnginePorts } from '../../ports.js'

export const isE164 = (phone: string): boolean => /^\+[1-9]\d{1,14}$/.test(phone)

/** One policy for API discovery, commit-time validation and notification delivery. */
export function smsSettings(ports: Pick<EnginePorts, 'sms' | 'config'>, eventType: EventType) {
  const phoneId = ports.config.smsPhoneQuestionId
  const consentId = ports.config.smsConsentQuestionId
  const phone = eventType.questions.find((q) => q.id === phoneId && q.type === 'text')
  const consent = eventType.questions.find((q) => q.id === consentId && q.type === 'select' && !q.required && q.options?.includes('No') && q.options.includes('Yes'))
  const enabled = Boolean(ports.sms && phone && consent && phoneId !== consentId)
  return {
    enabled,
    phoneQuestionId: enabled ? phoneId! : null,
    consentQuestionId: enabled ? consentId! : null,
  }
}

/** Null means no opt-in. An empty/invalid string is an opted-in invalid phone. */
export function smsRecipient(ports: Pick<EnginePorts, 'sms' | 'config'>, eventType: EventType, answers: Record<string, string>): string | null {
  const sms = smsSettings(ports, eventType)
  if (!sms.enabled || answers[sms.consentQuestionId!] !== 'Yes') return null
  return (answers[sms.phoneQuestionId!] ?? '').trim()
}
