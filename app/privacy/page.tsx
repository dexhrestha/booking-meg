import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Experiment Booking",
  description: "How the experiment booking site handles participant data.",
};

const contactEmail = "dipesh.shrestha@unitn.it";

export default function PrivacyPage() {
  return (
    <main className="page-shell legal-page">
      <p className="eyebrow">Last updated 13 October 2026</p>
      <h1>Privacy Policy</h1>
      <p>
        This site lets participants book sessions for research experiments run
        at CIMeC, University of Trento. This policy explains what information
        the booking site collects and how it is used.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>Your name and email address.</li>
        <li>The experiment and the session dates and time slots you choose.</li>
        <li>
          Your answers to the booking form, such as confirming the eligibility
          criteria, and the time you submitted or changed your booking.
        </li>
        <li>
          If you sign up to be notified when bookings reopen, your email
          address.
        </li>
        <li>
          Anonymous page-view statistics collected by Vercel Analytics, which
          does not use cookies.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To reserve your sessions and prevent double bookings.</li>
        <li>
          To send you Google Calendar invitations for your sessions, and updates
          or cancellations if your booking changes.
        </li>
        <li>To contact you about your booking or the experiment.</li>
      </ul>
      <p>
        We do not sell your information or use it for advertising. Booking data
        is not your experimental data; any data collected during the experiment
        itself is covered by the consent form you sign at the lab.
      </p>

      <h2>Google Calendar</h2>
      <p>
        The site uses the Google Calendar API, authorized by the research team,
        to create calendar events for booked sessions with you as a guest, and
        to read the researchers&apos; own calendars so that slots they are busy
        in are not offered. It does not access your Google account or calendar.
      </p>
      <p>
        The site&apos;s use and transfer of information received from Google
        APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>Where it is stored and who can see it</h2>
      <p>
        Booking information is stored privately with our hosting provider,
        Vercel, and calendar events are stored in Google Calendar. Only the
        research team can see participant bookings.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep booking information only as long as needed to run and follow up
        on the experiment, and delete it afterwards.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see, correct, or delete your booking information at any
        time, and you can change or cancel your booking. Under the GDPR you
        also have the right to complain to your data protection authority.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
      </p>

      <p className="legal-links">
        <Link href="/">Back to experiments</Link> · <Link href="/tos">Terms of Service</Link>
      </p>
    </main>
  );
}
