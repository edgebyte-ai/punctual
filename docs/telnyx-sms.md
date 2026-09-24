# Optional Telnyx SMS

SMS is off by default and independent of email and the blog. Punctual already
runs in a Cloudflare Worker, so its notification path calls Telnyx directly:

```text
Punctual booking notification → Punctual Cloudflare Worker → Telnyx Messages API
                                                           ├─ existing Hosted SMS sender
                                                           └─ new verified 8xx sender
                                                                  ↓
                                                            customer's mobile
```

Both options use `POST https://api.telnyx.com/v2/messages`. The chosen number
is the **sender** (`from`); the customer's mobile number is the recipient (`to`).
No second Worker, phone-number proxy, or duplicate booking database is needed.

## Choose the sending number

### Existing number through Hosted SMS

Telnyx takes over SMS/MMS routing while the existing carrier continues to handle
voice. This is subject to Telnyx eligibility checks; do not assume any existing
mobile/landline number qualifies. Its current guide requires an eligible US
non-wireless number, number-control verification, a signed Letter of
Authorization and a recent bill from the voice provider. An eligible number
must be provisioned and associated with a Telnyx Messaging Profile before use.
The Sunnyvale phone number has **not** been checked or enrolled by this code.

Follow the [Hosted SMS guide](https://developers.telnyx.com/docs/messaging/messages/hosted-sms)
for eligibility, the hosted-number order, ownership verification, documents and
approval. US local-number business messaging also needs the applicable
[10DLC brand and campaign registration](https://developers.telnyx.com/docs/messaging/10dlc/quickstart)
when sending A2P messages to US mobile numbers; Hosted SMS does not bypass it.
Keep the current voice contract in place when choosing the hosted-only route.

### New 8xx toll-free number

Obtain a Telnyx SMS-capable toll-free number (800/888/877/866/855/844/833), attach
it to a Messaging Profile, and complete
[Toll-Free Verification](https://developers.telnyx.com/docs/messaging/toll-free-verification)
before enabling production notifications. The application includes business
identity/registration, website, intended use, sample messages and the actual
opt-in workflow. Toll-free verification is distinct from local-number 10DLC
registration. Buying a number alone is not proof it is ready to deliver texts.

Neither number purchase nor Hosted SMS enrollment is performed automatically.
Telnyx number rental, message segments and carrier/registration charges are
separate from Cloudflare usage.

## Configure this Punctual instance

In its Wrangler variables, set:

```json
{
  "SMS_PROVIDER": "telnyx",
  "TELNYX_FROM": "+18005550100",
  "TELNYX_MESSAGING_PROFILE_ID": "your-messaging-profile-id",
  "SMS_PHONE_QUESTION_ID": "your-phone-question-id",
  "SMS_CONSENT_QUESTION_ID": "your-sms-consent-question-id"
}
```

Replace the example number with the approved number on your account. Use E.164
for both sender and recipient. `TELNYX_MESSAGING_PROFILE_ID` is optional in the
request when the number already has its correct profile association. Both
question IDs must be real, distinct IDs on the event type. Store the API key
only as a secret on **Punctual**, for example for the Sunnyvale instance:

```powershell
cd C:\Users\archi\github\punctual
npx wrangler secret put TELNYX_API_KEY --config instances/sunnyvale/wrangler.production.jsonc
```

Unset `SMS_PROVIDER` or set it to `none` to disable SMS. Merely adding an API key
does not enable sending. Incomplete/invalid provider configuration disables SMS
and appears as a warning on `/health`; booking and email continue to work.

In each participating event type, add a text phone question and an **optional**
consent select with options `No` and `Yes`. Suggested label:

> Receive appointment confirmation, changes and cancellation texts? Optional;
> message/data rates may apply. Reply STOP to opt out.

Map those actual question IDs into the variables above. Only an explicit `Yes`
permits SMS; entering a phone number alone never does. The consent answer stays
with the booking. Staff creating an appointment must record the customer's
actual choice, rather than select Yes automatically. Keep the enrollment copy
consistent with your Telnyx verification application and privacy/terms pages.

## Custom website integration

Authenticated `GET /api/v1/event-types/:id` adds `notifications.sms` alongside
the existing `data`. It reports `enabled`, `phoneQuestionId` and
`consentQuestionId`, without exposing the provider key or sender number.
The capability is enabled only when both the provider and that event type's
questions are ready. Custom frontends pass the E.164 phone and `Yes` consent
under those question IDs in the booking's `answers` object.

Sunnyvale uses `SMS_PROVIDER="punctual"` on its website Worker. It discovers the
event capability, displays an unchecked optional checkbox, and records the
customer's choice. Telnyx credentials stay entirely on Punctual. With this
selection, the website does not additionally invoke its older Twilio adapter.

## Notification behavior and operations

- Initial confirmation and rescheduling texts include the **same native
  management/cancel link** used by the corresponding Punctual email. No second
  token is created. Cancellations send a cancellation notice.
- SMS follows the shared notification path for API, native booking pages and
  staff-created bookings, and preserves Punctual's confirmation claim guard.
  No consent, no configured sender, or no applicable event questions means no
  send. Existing email reminders continue; this integration adds no SMS
  reminders or inbound SMS command bot.
- Requests are awaited with a bounded timeout. SMS failure never rolls back a
  successful booking or suppresses email. Logs contain a sanitized failure,
  not the API key, phone number, message text or management token.
- Sending is best-effort, with no automatic SMS retry or delivery-receipt
  database. A timeout can mean the carrier accepted a text, so blindly retrying
  could duplicate it. Check Telnyx Messaging logs for failures. If reliable
  retries and delivery tracking become necessary, add an idempotent outbox and
  verified delivery webhooks together.
- HTTP success means Telnyx **accepted** a message, not that the handset received
  it. The website's `smsStatus=requested` only records the notification request.
  Telnyx emits final delivery status through `message.finalized`; an added
  receiver must validate the Ed25519 signature and timestamp before trusting it.
- Keep Telnyx's built-in opt-out handling enabled. STOP and related keywords
  block further sends under the Messaging Profile; START/UNSTOP can restore
  consent at the provider. This integration does not bypass that block or retry
  a rejected/opted-out recipient. Provider opt-out state is not mirrored into
  Punctual's historical consent answer.

Before enabling customer traffic, use a consenting test recipient to check a
confirmation, reschedule, cancellation, native management link and STOP. Test
the chosen **approved** sender type; unit tests use mocked HTTP and cannot
establish number eligibility, registration approval or actual delivery.

Official references, checked September 23, 2026:

- [Send a message](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Messaging webhooks and signatures](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks)
- [Advanced opt-in/out](https://developers.telnyx.com/docs/messaging/messages/advanced-opt-in-out)
