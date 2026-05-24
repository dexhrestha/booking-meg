"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  BookingEntry,
  BookingState,
  buildSelectionsForStartDate,
  emptyOccupiedSlots,
  formatDisplayDate,
  getLatestFirstSessionDate,
  initialSelections,
  isAllowedFirstSessionDate,
  isValidEmail,
  OccupiedSlots,
  SessionId,
  SessionSelection,
  sessionConfigs,
  slotKey,
  slotOptions,
} from "@/lib/booking";
import { FirstSessionDatePicker } from "@/components/first-session-date-picker";

export default function Home() {
  const [email, setEmail] = useState("");
  const [firstSessionDate, setFirstSessionDate] = useState("");
  const [selections, setSelections] = useState<BookingState>(initialSelections);
  const [booking, setBooking] = useState<BookingEntry | null>(null);
  const [existingBooking, setExistingBooking] = useState<BookingEntry | null>(
    null,
  );
  const [editingBookingId, setEditingBookingId] = useState("");
  const [occupiedSlots, setOccupiedSlots] =
    useState<OccupiedSlots>(emptyOccupiedSlots);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  const missingSlots = useMemo(
    () =>
      sessionConfigs.filter((session) => selections[session.id].slot === ""),
    [selections],
  );
  const unavailableSelections = useMemo(
    () =>
      sessionConfigs.filter(
        (session) =>
          selections[session.id].slot &&
          occupiedSlots[session.id].includes(
            slotKey(
              selections[session.id].date,
              selections[session.id].slot,
            ),
          ),
      ),
    [occupiedSlots, selections],
  );

  const emailLooksValid = isValidEmail(email);
  const startDateSelected = isAllowedFirstSessionDate(firstSessionDate);
  const latestBookingDate = formatDisplayDate(getLatestFirstSessionDate());
  const validationMessages: string[] = [
    !startDateSelected
      ? `Choose a Monday or Tuesday for the first session within the next 4 weeks, through ${latestBookingDate}.`
      : "",
    !emailLooksValid ? "Enter a valid email address." : "",
    missingSlots.length > 0
      ? `Select a slot for ${missingSlots.map((session) => session.title).join(", ")}.`
      : "",
  ].filter(Boolean);
  const formIsComplete =
    emailLooksValid &&
    startDateSelected &&
    missingSlots.length === 0 &&
    unavailableSelections.length === 0;

  useEffect(() => {
    async function loadBookingData() {
      if (!startDateSelected && !emailLooksValid) {
        setOccupiedSlots(emptyOccupiedSlots());
        setExistingBooking(null);
        return;
      }

      const params = new URLSearchParams();

      if (startDateSelected) {
        params.set("firstSessionDate", firstSessionDate);
      }

      if (emailLooksValid) {
        params.set("email", email.trim().toLowerCase());
      }

      if (editingBookingId) {
        params.set("excludedBookingId", editingBookingId);
      }

      const response = await fetch(`/api/bookings?${params}`);

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as {
        occupiedSlots: OccupiedSlots;
        existingBooking?: BookingEntry | null;
      };
      setOccupiedSlots(data.occupiedSlots);
      setExistingBooking(data.existingBooking ?? null);

      if (
        emailLooksValid &&
        data.existingBooking &&
        !editingBookingId &&
        !booking
      ) {
        loadExistingBooking(data.existingBooking);
      }
    }

    loadBookingData();
  }, [
    editingBookingId,
    email,
    emailLooksValid,
    firstSessionDate,
    startDateSelected,
  ]);

  function updateSelection(
    sessionId: SessionId,
    field: keyof SessionSelection,
    value: string,
  ) {
    setSelections((current) => ({
      ...current,
      [sessionId]: {
        ...current[sessionId],
        [field]: value,
      },
    }));
  }

  function handleFirstSessionDateChange(value: string) {
    setTouched(true);
    setBooking(null);

    if (value && !isAllowedFirstSessionDate(value)) {
      setFirstSessionDate("");
      setOccupiedSlots(emptyOccupiedSlots());
      setMessage(
        `Choose a Monday or Tuesday first-session date within the next 4 weeks, through ${latestBookingDate}.`,
      );
      return;
    }

    setMessage("");
    setFirstSessionDate(value);
    setSelections((current) => buildSelectionsForStartDate(value, current));
  }

  function handleEmailChange(value: string) {
    setEmail(value);
    setBooking(null);

    if (editingBookingId) {
      setEditingBookingId("");
      setMessage("");
    }
  }

  function loadExistingBooking(existingBooking: BookingEntry) {
    setTouched(false);
    setBooking(null);
    setMessage(
      "Existing booking loaded. Change any slot below, then update the booking.",
    );
    setEditingBookingId(existingBooking.id);
    setEmail(existingBooking.email);
    setFirstSessionDate(existingBooking.firstSessionDate);
    setSelections(existingBooking.selections);
  }

  function cancelEdit() {
    setEmail("");
    setFirstSessionDate("");
    setEditingBookingId("");
    setExistingBooking(null);
    setBooking(null);
    setMessage("");
    setSelections(initialSelections);
    setOccupiedSlots(emptyOccupiedSlots());
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    setMessage("");
    setBooking(null);

    if (!formIsComplete) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/bookings", {
        method: editingBookingId ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: editingBookingId || undefined,
          email: email.trim().toLowerCase(),
          firstSessionDate,
          selections,
        }),
      });
      const data = (await response.json()) as {
        booking?: BookingEntry;
        message?: string;
        occupiedSlots?: OccupiedSlots;
        existingBooking?: BookingEntry | null;
      };

      if (!response.ok) {
        setMessage(data.message ?? "Booking could not be saved.");

        if (data.occupiedSlots) {
          setOccupiedSlots(data.occupiedSlots);
        }

        if (data.existingBooking) {
          setExistingBooking(data.existingBooking);
          loadExistingBooking(data.existingBooking);
        }

        return;
      }

      if (data.booking) {
        setBooking(data.booking);
        setMessage(data.message ?? "Booking confirmed.");
      }

      if (data.occupiedSlots) {
        setOccupiedSlots(data.occupiedSlots);
      }

      if (data.existingBooking) {
        setExistingBooking(data.existingBooking);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="experiment-banner" aria-labelledby="experiment-title">
        <div className="banner-copy">
          <p className="eyebrow">Participants wanted</p>
          <h1 id="experiment-title">MEG  long-term memory study</h1>
          <p>
            We are recruiting participants for a MEG neuroimaging study
            investigating long-term memory.
          </p>
          <p>
            The study involves <strong>four sessions on consecutive days</strong>.
            The first session can start on <strong>Monday or Tuesday</strong>.
            MEG recording will take place <strong>only on the last day</strong>;
            the other sessions involve behavioural testing and eye tracking.
          </p>
        </div>
        <div className="banner-info">
          <div className="info-block">
            <h2>Study details</h2>
            <ul>
              <li>Location: <a href="https://www.google.com/maps/place/Manifattura+Tabacchi/@45.883882,11.0209677,19.84z/data=!3m1!5s0x47820eebf255c703:0x9310c26ff1d463f0!4m15!1m8!3m7!1s0x47820eec769b393d:0x38d05401c42ac68c!2sPiazza+della+Manifattura,+38068+Rovereto+TN!3b1!8m2!3d45.8839355!4d11.0211871!16s%2Fg%2F11h094zqd!3m5!1s0x47820eec75c14bb1:0xb63ae4693b1d9caf!8m2!3d45.883857!4d11.0212476!16s%2Fg%2F11hzfvtxhz?entry=ttu&g_ep=EgoyMDI2MDUyMC4wIKXMDSoASAFQAw%3D%3D" target="_blank" rel="noopener noreferrer">
                Blg 10, Piazza Manifattura, Rovereto , TN
              </a></li>
              <li>Duration: <strong>~90</strong> minutes per session</li>
              <li>Compensation: <strong>€78</strong> total</li>
              <li>Task: Play virtual memory game</li>
            </ul>
          </div>
          <div className="info-block">
            <h2>Eligibility criteria</h2>
            <ul>
              <li>Age: 18 - 35</li>
              <li>Normal or corrected-to-normal vision</li>
              <li>No non-removable metal objects, dental implants, or other implants</li>

              <li>No diagnosed neurological or psychological conditions</li>
              <li>Good understanding of Italian or English</li>
            </ul>
          </div>
          <div className="info-block">
            <h2>Preferred</h2>
            <ul>
              <li>Right-handed</li>
              <li>Previously participated in <strong>any</strong> MRI experiment at CIMeC.</li>
            </ul>
          </div>
          <p className="banner-note">
            Some MRI-compatible implants may not be compatible with MEG. We
            will ask everyone who contacts us to confirm all eligibility
            criteria.
          </p>
          <p className="banner-contact">
            Questions:{" "}
            <a href="mailto:dipesh.shrestha@unitn.it">
              dipesh.shrestha@unitn.it
            </a>
          </p>
        </div>
      </section>

      <form className="booking-form" onSubmit={handleSubmit}>
        <div className="form-header">
          <div>
            <p className="eyebrow">Booking details</p>
            <h2>Choose your session slots</h2>
          </div>
          <label className="date-field">
            <span>First session date</span>
            <FirstSessionDatePicker
              value={firstSessionDate}
              onChange={handleFirstSessionDateChange}
              onBlur={() => setTouched(true)}
              invalid={touched && firstSessionDate !== "" && !startDateSelected}
            />
            <small>
              Session 1 must start on a Monday or Tuesday within the next 4
              weeks.
            </small>
          </label>
          <label className="email-field">
            <span>Email address</span>
            <input
              type="email"
              value={email}
              onChange={(event) => handleEmailChange(event.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="participant@example.com"
              aria-invalid={touched && !emailLooksValid}
              required
            />
          </label>
        </div>

        {existingBooking ? (
          <section className="existing-bookings-inline" aria-labelledby="existing-title">
            <div className="existing-bookings-header">
              <div>
                <p className="eyebrow">Existing booking</p>
                <h3 id="existing-title">
                  Showing saved booking in the session columns
                </h3>
              </div>
              {editingBookingId ? (
                <button type="button" onClick={cancelEdit}>
                  Cancel edit
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        <div className="session-grid">
          {sessionConfigs.map((session) => (
            <fieldset className="session-column" key={session.id}>
              <legend>{session.title}</legend>
              <p>Consecutive session day</p>

              {startDateSelected ? (
                <div className="session-date">
                  <span>Day and date</span>
                  <strong>
                    {formatDisplayDate(selections[session.id].date)}
                  </strong>
                </div>
              ) : null}

              <div className="slot-group" role="radiogroup">
                {slotOptions.map((slot) => {
                  const inputId = `${session.id}-${slot}`;
                  const isBooked = occupiedSlots[session.id].includes(
                    slotKey(selections[session.id].date, slot),
                  );

                  return (
                    <label className="slot-option" htmlFor={inputId} key={slot}>
                      <input
                        id={inputId}
                        type="radio"
                        name={session.id}
                        value={slot}
                        checked={selections[session.id].slot === slot}
                        onChange={(event) =>
                          updateSelection(
                            session.id,
                            "slot",
                            event.target.value,
                          )
                        }
                        disabled={!startDateSelected || isBooked}
                        required
                      />
                      <span>
                        {slot}
                        {isBooked ? " booked" : ""}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        {touched && validationMessages.length > 0 ? (
          <div className="form-message" role="alert">
            {validationMessages.map((validationMessage) => (
              <p key={validationMessage}>{validationMessage}</p>
            ))}
          </div>
        ) : null}
        {message ? (
          <p
            className={booking ? "form-message success" : "form-message"}
            role="alert"
          >
            {message}
          </p>
        ) : null}

        <div className="form-actions">
          {editingBookingId ? (
            <button type="button" className="secondary-button" onClick={cancelEdit}>
              Cancel edit
            </button>
          ) : null}
          <button type="submit" disabled={isSubmitting || !formIsComplete}>
            {isSubmitting
              ? editingBookingId
                ? "Updating..."
                : "Booking..."
              : editingBookingId
                ? "Update booking"
                : "Book selected slots"}
          </button>
        </div>
      </form>

      {booking ? (
        <section className="confirmation" aria-live="polite">
          <h2>Booking confirmed</h2>
          <p>{booking.email}</p>
          <dl>
            {sessionConfigs.map((session) => (
              <div key={session.id}>
                <dt>{session.title}</dt>
                <dd>
                  {booking.selections[session.id].day},{" "}
                  {formatDisplayDate(booking.selections[session.id].date)}
                  ,{" "}
                  {booking.selections[session.id].slot}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </main>
  );
}
