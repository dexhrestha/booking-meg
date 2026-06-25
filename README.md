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

Accepted bookings are stored in `data/bookings.json`. Admin-blocked slots are
stored in `data/blocked-slots.json`. The API prevents participants from booking
the same date and slot as another participant or an admin block.

For Vercel, connect Vercel Blob and set this environment variable so bookings
can persist:

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

## Test Vercel Blob

After pulling Vercel env vars locally, this command writes the local
`data/bookings.json` array to the private Vercel Blob object and reads it back
with the same schema:

```bash
vercel env pull .env.local
npm run test:blob
```
