# Sunnyvale instance

This configuration deploys an independent Punctual instance for Sunnyvale Discount Smog. The public Sunnyvale website keeps its own design and calls this instance from its Worker. Blog management is part of the authenticated Punctual dashboard; `BLOG_ENABLED="1"` enables it for this instance. Leave that variable unset or set it to `"0"` for an application without a blog.

## Local integration

Use Node 24 and run `npm ci` in both repositories. From `C:\Users\archi\github\sunnyvalediscountsmog`:

```powershell
node scripts/bootstrap-punctual-local.mjs 'C:\Users\archi\github\punctual'
```

The script applies **only local** D1 migrations and inserts an example administrator, the station's Pacific-time opening hours, a 15-minute smog event type, the phone/vehicle/notes questions, and two starter articles. It preserves existing records. It generates local encryption/signing keys in `instances/sunnyvale/.dev.vars` and a scoped Punctual API key in the website's `.dev.vars`; these files must never be committed. It neither provisions Cloudflare resources nor sends real emails.

From the Punctual repository:

```powershell
node node_modules/wrangler/bin/wrangler.js dev --config instances/sunnyvale/wrangler.local.jsonc --local --persist-to instances/sunnyvale/.wrangler/state
```

In another terminal, run the website's `npm run dev`. Punctual runs on `http://127.0.0.1:8787` and the website on `http://127.0.0.1:8788`. The website service binding points to `sunnyvale-punctual`. All local migrations and dev sessions must use the same `--persist-to` directory above.

Sign in at `/login` with the fictional account `admin@sunnyvale.local.test`. The magic link appears in Punctual's local console. There is no fixed administrator password. Manage bookings and availability in the normal dashboard and articles at `/dashboard/blog`.

The local config's fake resource IDs and `.test` email addresses are intentionally unsuitable for production. Its compatibility date is pinned to the installed Wrangler/workerd version; update the runtime before raising it.

## Production preparation

1. Copy `wrangler.production.example.jsonc` to the ignored `wrangler.production.jsonc` in this directory. Fill the D1/KV IDs, public HTTPS `BASE_URL`, legal operator, sending address and support address. Keep the frontend's `PUNCTUAL_BASE_URL` equal to that Punctual origin. The frontend's service binding must name the deployed `sunnyvale-punctual` Worker.
2. Create a dedicated D1 database `sunnyvale-punctual`, a dedicated KV cache and the R2 bucket `sunnyvale-punctual-avatars`. Use this instance config for D1 migrations and all deployments. Queues are optional: this template uses Punctual's built-in inline delivery. The cron trigger handles reminders and cleanup.
3. Set fresh `ENCRYPTION_KEY_V1` and `SIGNING_KEY` Worker secrets, each generated from 32 cryptographically random bytes encoded as base64. Configure an actual email sender following `docs/self-hosting.md`; local console mode delivers nothing to customers. No Google/Microsoft OAuth app is needed unless calendar sync is wanted.
4. Before the **first** sign-in, replace `SIGNUPS="closed"` with the owner's exact email address (an explicit allowlist). Verify that address before deploying. The first allowed signup becomes administrator. Once the owner has signed in, set `SIGNUPS="closed"` again. Never deploy an open-signup instance just to bootstrap an owner.
5. In the dashboard, create the owner's `America/Los_Angeles` schedule: Tuesday–Friday 08:00–18:00, Saturday 07:15–17:30, Sunday/Monday closed online. Create a personal in-person event with **both** duration and slot interval 15 minutes, location `848 West Evelyn Ave. Ste D, Sunnyvale, CA 94086`, and phone/vehicle/notes questions. These booking settings are operator-owned and can be changed without changing the website.
6. Generate a `read` + `write` API key under the event owner's account. Store it only as the frontend Worker's `PUNCTUAL_API_KEY` secret. Set `PUNCTUAL_EVENT_TYPE_ID` and the three question-ID settings to the actual created IDs. Dashboard-generated question IDs need not equal the local seed IDs. Never expose the API key in public JS.
7. Add/publish articles in `/dashboard/blog`. Production is intentionally not seeded with a fictional owner, local key or example posts. Review the website and a real booking/cancellation round trip before directing customer traffic to it.

The exact provisioning/deployment commands are in upstream `docs/self-hosting.md`. This directory contains no account IDs, real addresses or live credentials. No production deployment is performed by the local bootstrap.

## Optional Telnyx SMS

See [Telnyx setup](../../docs/telnyx-sms.md) for either an eligible existing Hosted SMS number or a verified new toll-free number. Both use the same sending API inside this Punctual Worker. Set `SMS_PROVIDER="telnyx"`, the approved `TELNYX_FROM`, optional messaging profile ID, and the two real question IDs; put `TELNYX_API_KEY` in a Worker secret. The template keeps SMS off.

Add a phone text question and a separate optional SMS consent select with options `No` and `Yes`. The local bootstrap adds `sms_consent`; production IDs must come from the actual event type. Native bookings and staff-created bookings use these same questions. No consent means no SMS. The Sunnyvale website's `SMS_PROVIDER="punctual"` reads these settings from the event API and never holds the Telnyx key or sends a second text.
