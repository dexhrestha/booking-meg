# MEG Experiment Booking

Next.js booking form for MEG experiment participants. Participants select the
Monday or Tuesday date for Session 1, then choose one available slot for each
consecutive session.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Customize the banner

Replace `public/meg-banner.svg` with your experiment banner image, or update the banner text in `app/page.tsx`.

## Booking data

Accepted bookings are stored in `data/bookings.json`. The API prevents two
participants from booking the same session, date, and slot.

For Vercel, connect Edge Config and set these environment variables so bookings
can persist:

```bash
EDGE_CONFIG=...
VERCEL_API_TOKEN=...
```

`EDGE_CONFIG` is created by Vercel when you connect Edge Config to the project.
`VERCEL_API_TOKEN` is required because the app also writes booking changes.
If needed, you can set `EDGE_CONFIG_ID` explicitly.

If the Edge Config belongs to a Vercel team, also set one of:

```bash
VERCEL_TEAM_ID=...
VERCEL_TEAM_SLUG=...
```

For `/view_bookings`, set one of:

```bash
BOOKING_ADMIN_PASSWORD=...
VIEW_BOOKINGS_PASSWORD=...
ADMIN_PASSWORD=...
```

## Test Edge Config

After pulling Vercel env vars locally, this command writes the local
`data/bookings.json` array to the Edge Config `bookings` key and reads it back
with the same schema:

```bash
vercel env pull .env.local
npm run test:edge-config
```
