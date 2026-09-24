import { describe, expect, it, vi } from 'vitest'
import type { Booking, EventType, User } from '../../src/core/domain/types.js'
import { createTelnyxSender, selectSmsDelivery } from '../../src/adapters/sms.js'
import { notifyBookingCancelled, notifyBookingCreated, notifyBookingRescheduled } from '../../src/adapters/notify.js'
import { dispatchConfirmation } from '../../src/adapters/queue/consumer.js'
import type { EnginePorts, QueueMessage } from '../../src/ports.js'

const host: User = {
  id: 'u_host', email: 'host@example.test', name: 'Host', tz: 'UTC', slug: 'host',
  avatarKey: null, company: null, jobTitle: null, companyUrl: null, role: 'member', createdAt: 0,
}

const eventType: EventType = {
  id: 'et_sms', ownerUserId: host.id, ownerTeamId: null, schedulingType: 'personal', slug: 'check',
  title: 'Smog check', description: '', durationMinutes: 30, slotIntervalMinutes: null,
  bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minNoticeMinutes: 0, maxHorizonDays: 60,
  maxPerDay: null, locationType: 'custom_link', locationValue: 'https://example.test/meet',
  questions: [
    { id: 'phone', label: 'Mobile phone', type: 'text', required: true },
    { id: 'sms_consent', label: 'Text me updates', type: 'select', required: false, options: ['No', 'Yes'] },
  ], active: true, createdAt: 0, scheduleId: null,
}

const booking: Booking = {
  id: 'bk_sms', eventTypeId: eventType.id, hostUserId: host.id, hostUserIds: [host.id],
  guestName: 'Guest', guestEmail: 'guest@example.test', guestTimezone: 'UTC',
  startUtc: Date.UTC(2026, 8, 24, 16, 0), endUtc: Date.UTC(2026, 8, 24, 16, 30), localDate: '2026-09-24',
  status: 'confirmed', answers: { phone: '+16505550123', sms_consent: 'Yes' }, externalEventIds: {},
  conferenceUrl: null, rescheduleOf: null, rescheduledTo: null, manageTokenHash: 'hash', cancelledAt: null,
  createdAt: 0,
}

function ports(sms: EnginePorts['sms'], sent: QueueMessage[]): EnginePorts {
  return {
    sms,
    repositories: () => ({
      webhooks: { listForUser: async () => [] },
      eventTypeHosts: { forEventType: async () => [] },
      bookings: { byId: async () => null },
    }) as unknown as ReturnType<EnginePorts['repositories']>,
    queue: {
      send: async (message: QueueMessage) => { sent.push(message) },
      sendBatch: async (messages: QueueMessage[]) => { sent.push(...messages) },
    },
    config: {
      baseUrl: 'https://punctual.test', brandName: 'Punctual', supportEmail: 'help@punctual.test',
      fromEmail: 'from@punctual.test', fromName: 'Punctual', emailDelivery: 'console',
      smsPhoneQuestionId: 'phone', smsConsentQuestionId: 'sms_consent', telemetryEnabled: false, blogEnabled: false,
    },
  } as unknown as EnginePorts
}

describe('Telnyx SMS adapter', () => {
  it('keeps SMS off by default and reports incomplete configuration without throwing', () => {
    expect(selectSmsDelivery({})).toEqual({ delivery: 'none', problem: null })
    expect(selectSmsDelivery({ SMS_PROVIDER: 'telnyx', TELNYX_API_KEY: 'key', TELNYX_FROM: '+16505550123' }).delivery).toBe('none')
    expect(selectSmsDelivery({ SMS_PROVIDER: 'twilio', TELNYX_API_KEY: 'key' }).problem).toContain('none or telnyx')
    expect(selectSmsDelivery({ SMS_PROVIDER: 'telnyx', TELNYX_API_KEY: 'key', TELNYX_FROM: '+16505550123', SMS_PHONE_QUESTION_ID: 'phone', SMS_CONSENT_QUESTION_ID: 'sms_consent' })).toEqual({ delivery: 'telnyx', problem: null })
  })

  it('sends the documented Telnyx payload and never follows redirects', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.redirect).toBe('manual')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response('', { status: 200 })
    })
    await createTelnyxSender({ apiKey: 'secret', from: '+16505550123', messagingProfileId: 'profile', fetch: fetcher }).send({ to: '+14155550123', text: 'hello' })
    expect(fetcher).toHaveBeenCalledOnce()
    const [, init] = fetcher.mock.calls[0]!
    expect(init?.headers).toMatchObject({ authorization: 'Bearer secret', 'content-type': 'application/json' })
    expect(JSON.parse(String(init?.body))).toEqual({ from: '+16505550123', to: '+14155550123', text: 'hello', messaging_profile_id: 'profile' })
  })

  it('rejects invalid numbers and provider failures without exposing a provider body', async () => {
    const fetcher = vi.fn(async () => new Response('{"phone_number":"+16505550123"}', { status: 403 }))
    await expect(createTelnyxSender({ apiKey: 'secret', from: '+16505550123', fetch: fetcher }).send({ to: '6505550123', text: 'hello' })).rejects.toThrow('E.164')
    await expect(createTelnyxSender({ apiKey: 'secret', from: '+16505550123', fetch: fetcher }).send({ to: '+14155550123', text: 'hello' })).rejects.toThrow('HTTP 403')
    expect(fetcher).toHaveBeenCalledOnce()
    await expect(createTelnyxSender({ apiKey: 'secret', from: '+16505550123', fetch: async () => { throw new Error('secret provider body') } }).send({ to: '+14155550123', text: 'hello' })).rejects.toThrow('request failed or timed out')
  })
})

describe('shared SMS booking notifications', () => {
  it('sends the same native manage link for confirmation and reschedule, and a brief cancellation', async () => {
    const sent: QueueMessage[] = []
    const sms = vi.fn(async (_message: { to: string; text: string }) => {})
    const p = ports({ send: sms }, sent)
    const manage = 'https://punctual.test/booking/bk_sms?token=raw'

    await notifyBookingCreated({ ports: p, booking, eventType, host, manageToken: 'raw' })
    expect(sms).toHaveBeenCalledWith(expect.objectContaining({ to: '+16505550123', text: expect.stringContaining(manage) }))

    const previous = { ...booking, startUtc: booking.startUtc - 30 * 60_000, endUtc: booking.endUtc - 30 * 60_000 }
    await notifyBookingRescheduled({ ports: p, booking: { ...booking, rescheduleOf: previous.id }, previous, eventType, host, manageToken: 'raw' })
    expect(sms).toHaveBeenCalledTimes(2)
    expect(sms.mock.calls[1]![0].text).toContain(manage)

    await notifyBookingCancelled({ ports: p, booking: { ...booking, status: 'cancelled', cancelledAt: Date.now() }, eventType, host, cancelledBy: 'guest' })
    expect(sms).toHaveBeenCalledTimes(3)
    expect(sms.mock.calls[2]![0].text).toContain('cancelled')
    expect(sms.mock.calls[2]![0].text).not.toContain('Manage or cancel')
  })

  it('isolates a Telnyx failure from the notification lifecycle', async () => {
    const sent: QueueMessage[] = []
    const p = ports({ send: async () => { throw new Error('provider body') } }, sent)
    await expect(notifyBookingCreated({ ports: p, booking, eventType, host, manageToken: 'raw' })).resolves.toBeUndefined()
    expect(sent.filter((message) => message.kind === 'email')).toHaveLength(2)
  })

  it('does not send without explicit Yes consent, and a confirmation replay sends only once', async () => {
    const sent: QueueMessage[] = []
    const sms = vi.fn(async (_message: { to: string; text: string }) => {})
    const noConsent = ports({ send: sms }, sent)
    await notifyBookingCreated({ ports: noConsent, booking: { ...booking, answers: { ...booking.answers, sms_consent: 'No' } }, eventType, host, manageToken: 'raw' })
    expect(sms).not.toHaveBeenCalled()

    let claimed = false
    const replay = ports({ send: sms }, sent)
    replay.clock = { now: () => Date.now() }
    replay.repositories = () => ({
      bookings: {
        byId: async (id: string) => (id === booking.id ? booking : null),
        claimConfirmation: async () => { if (claimed) return false; claimed = true; return true },
        releaseConfirmationClaim: async () => { claimed = false },
      },
      eventTypes: { byId: async () => eventType },
      users: { byId: async (id: string) => id === host.id ? host : null },
      webhooks: { listForUser: async () => [] },
      eventTypeHosts: { forEventType: async () => [] },
    }) as unknown as ReturnType<EnginePorts['repositories']>
    await dispatchConfirmation(booking.id, replay, 'raw')
    await dispatchConfirmation(booking.id, replay, 'raw')
    expect(sms).toHaveBeenCalledOnce()
  })
})
