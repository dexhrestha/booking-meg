# MEG Experiment Booking

Next.js booking hub for experiment participants. The homepage lists available
experiments, and each experiment page handles the relevant session booking flow.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`. The MEG experiment is available at
`http://localhost:3000/meg`.

## Customize the banner

Replace the flyer image in `assets/`, or update the relevant experiment page.

## Booking data

Accepted bookings are stored locally in `data/bookings.json`. Admin-blocked
slots are stored locally in `data/blocked-slots.json`, and local reads also
include files named like `data/blocked_slots*.json`. The API prevents
participants from booking the same date and slot as another participant or an
admin block.

Local development, including `vercel dev`, always uses the local `data/`
folder even if Blob env vars are present. Deployed Vercel preview/production
environments use Vercel Blob, so connect Blob and set this environment variable
there:

```bash
BLOB_READ_WRITE_TOKEN=...
```

`BLOB_READ_WRITE_TOKEN` is created by Vercel when you connect Blob storage to
the project. The app stores the same array schema as `data/bookings.json` and
`data/blocked-slots.json` in private Blob objects.

The temporary September notification form stores addresses locally in
`data/september-signups.json`, or in the private `september-signups.json` Blob
object when deployed. Its Blob path can be customized with:

```bash
BLOB_SEPTEMBER_SIGNUPS_PATH=september-signups.json
```

```bash
BLOB_BOOKINGS_PATH=bookings.json
BLOB_BLOCKED_SLOTS_PATH=blocked-slots.json
```

For `/admin`, set a TOTP secret:

```bash
BOOKING_ADMIN_2FA_SECRET=...
```

Use the same secret in your authenticator app to generate the 6-digit admin
PIN. Base32 authenticator secrets are supported; `ADMIN_2FA_SECRET` is also
accepted as a fallback variable name.

For API access, set one or more admin API tokens:

```bash
BOOKING_ADMIN_API_TOKEN=use-a-long-random-value
BOOKING_ADMIN_API_TOKENS=token-one,token-two
```

API requests may send a token with `x-admin-api-token`, `Authorization: Bearer`,
or the `token` query parameter. `ADMIN_API_TOKEN` and `ADMIN_API_TOKENS` are also
accepted as fallback variable names.

Admin ICS downloads are available per experiment with either a PIN or API token:

```bash
/api/admin/calendar/meg-study/ics?pin=...
/api/admin/calendar/sensorimotor-study/ics?token=...
```

For calendar subscriptions or a polling agent, you can also use a separate
calendar-only feed token:

```bash
CALENDAR_FEED_TOKEN=use-a-long-random-value
```

Then subscribe or poll these feed URLs:

```bash
/api/admin/calendar/meg-study/ics?token=...
/api/admin/calendar/sensorimotor-study/ics?token=...
```

The ICS exports include participant bookings and manual blocked slots only.
External CIMeC calendar blocks are intentionally excluded from the downloads.

External CIMeC busy slots are mapped per experiment in
`lib/cimec-calendar.ts`. For the MEG experiment, Tuesday sessions are blocked
from MEG calendar resources, while the other session days are blocked from
Eyelink resources. The sensorimotor study currently uses Eyelink resources for
all sessions. CIMeC files may be individual resource exports or combined
exports with a top-level `calendars` array.

## Test Vercel Blob

After pulling Vercel env vars locally, this command writes the local
`data/bookings.json` array to the private Vercel Blob object and reads it back
with the same schema:

```bash
vercel env pull .env.local
npm run test:blob
```
