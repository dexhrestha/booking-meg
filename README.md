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

```bash
BLOB_BOOKINGS_PATH=bookings.json
BLOB_BLOCKED_SLOTS_PATH=blocked-slots.json
```

For `/admin`, set one of:

```bash
BOOKING_ADMIN_PASSWORD=...
VIEW_BOOKINGS_PASSWORD=...
ADMIN_PASSWORD=...
```

Admin ICS downloads are available per experiment:

```bash
/api/admin/calendar/meg-study/ics?password=...
/api/admin/calendar/sensorimotor-study/ics?password=...
```

The ICS exports include participant bookings and manual blocked slots only.
External CIMeC calendar blocks are intentionally excluded from the downloads.

## Test Vercel Blob

After pulling Vercel env vars locally, this command writes the local
`data/bookings.json` array to the private Vercel Blob object and reads it back
with the same schema:

```bash
vercel env pull .env.local
npm run test:blob
```
