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
