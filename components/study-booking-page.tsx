"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import {
  BookingEntry,
  BookingState,
  buildSelectionsForStartDate,
  emptyOccupiedSlotReasons,
  emptyOccupiedSlots,
  formatDisplayDate,
  getDayForDate,
  getLatestBookingDate,
  getLatestFirstSessionDate,
  initialSelections,
  isAllowedSensorimotorFirstSessionDate,
  isAllowedFirstSessionDate,
  isSameOrAfterDate,
  isWithinSameWeek,
  isWeekdayDate,
  isValidEmail,
  OccupiedSlotReasons,
  OccupiedSlots,
  SessionId,
  SessionSelection,
  sessionConfigs,
  SlotBlockReason,
  slotKey,
  StudyConfig,
} from "@/lib/booking";
import { FirstSessionDatePicker } from "@/components/first-session-date-picker";

type StudyBookingPageProps = {
  flyer: StaticImageData;
  study: StudyConfig;
};

async function parseJsonResponse<T>(response: Response) {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

function dateToIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function StudyBookingPage({ flyer, study }: StudyBookingPageProps) {
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
  const [occupiedSlotReasons, setOccupiedSlotReasons] =
    useState<OccupiedSlotReasons>(emptyOccupiedSlotReasons);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);
  const usesPerSessionDates = study.dateSelectionMode === "per-session";
  const selectedDateKey = sessionConfigs
    .map((session) => selections[session.id].date)
    .join("|");

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
            slotKey(selections[session.id].date, selections[session.id].slot),
          ),
      ),
    [occupiedSlots, selections],
  );

  const emailLooksValid = isValidEmail(email);
  const startDateSelected = usesPerSessionDates
    ? isAllowedSensorimotorFirstSessionDate(selections.session1.date)
    : isAllowedFirstSessionDate(firstSessionDate);
  const missingDates = useMemo(
    () =>
      usesPerSessionDates
        ? sessionConfigs.filter(
            (session, index) =>
              session.id === "session1"
                ? !isAllowedSensorimotorFirstSessionDate(
                    selections[session.id].date,
                  )
                : !isWithinSameWeek(
                    selections[session.id].date,
                    selections.session1.date,
                  ) ||
                  !isWeekdayDate(selections[session.id].date) ||
                  !isSameOrAfterDate(
                    selections[session.id].date,
                    selections[sessionConfigs[index - 1].id].date,
                  ),
          )
        : [],
    [selections, usesPerSessionDates],
  );
  const latestBookingDate = formatDisplayDate(getLatestFirstSessionDate());
  const latestSensorimotorBookingDate = formatDisplayDate(
    getLatestBookingDate(8),
  );
  const validationMessages: string[] = [
    !usesPerSessionDates && !startDateSelected
      ? `Choose a Tuesday for the first session within the next 4 weeks, through ${latestBookingDate}.`
      : "",
    usesPerSessionDates && missingDates.length > 0
      ? `Choose Session 1 on a Monday or Tuesday within 8 weeks, then keep Sessions 2-4 on weekdays in that same week, on or after the previous session date.`
      : "",
    !emailLooksValid ? "Enter a valid email address." : "",
    missingSlots.length > 0
      ? `Select a slot for ${missingSlots.map((session) => session.title).join(", ")}.`
      : "",
  ].filter(Boolean);
  const formIsComplete =
    emailLooksValid &&
    startDateSelected &&
    missingDates.length === 0 &&
    missingSlots.length === 0 &&
    unavailableSelections.length === 0;

  useEffect(() => {
    async function loadBookingData() {
      if (!startDateSelected && !emailLooksValid) {
        setOccupiedSlots(emptyOccupiedSlots());
        setOccupiedSlotReasons(emptyOccupiedSlotReasons());
        setExistingBooking(null);
        return;
      }

      const params = new URLSearchParams({ tag: study.tag });

      if (usesPerSessionDates) {
        sessionConfigs.forEach((session) => {
          const date = selections[session.id].date;

          if (date) {
            params.set(`${session.id}Date`, date);
          }
        });

        if (selections.session1.date) {
          params.set("firstSessionDate", selections.session1.date);
        }
      } else if (startDateSelected) {
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
        occupiedSlotReasons?: OccupiedSlotReasons;
        occupiedSlots: OccupiedSlots;
        existingBooking?: BookingEntry | null;
      };
      setOccupiedSlots(data.occupiedSlots);
      setOccupiedSlotReasons(
        data.occupiedSlotReasons ?? emptyOccupiedSlotReasons(),
      );
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
    booking,
    editingBookingId,
    email,
    emailLooksValid,
    firstSessionDate,
    selectedDateKey,
    startDateSelected,
    study.tag,
    usesPerSessionDates,
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

  function clearLaterSessions(
    current: BookingState,
    startIndex: number,
    keepStartDate: boolean,
  ) {
    const next = { ...current };

    for (let index = startIndex; index < sessionConfigs.length; index += 1) {
      const session = sessionConfigs[index];
      const existing = next[session.id];

      next[session.id] = {
        day: index === startIndex && keepStartDate ? existing.day : "",
        date: index === startIndex && keepStartDate ? existing.date : "",
        slot: "",
      };
    }

    return next;
  }

  function handleFirstSessionDateChange(value: string) {
    setTouched(true);
    setBooking(null);

    if (value && !isAllowedFirstSessionDate(value)) {
      setFirstSessionDate("");
      setOccupiedSlots(emptyOccupiedSlots());
      setOccupiedSlotReasons(emptyOccupiedSlotReasons());
      setMessage(
        `Choose a Tuesday first-session date within the next 4 weeks, through ${latestBookingDate}.`,
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

  function isSessionDateUnavailable(date: Date, sessionIndex: number) {
    const isoDate = dateToIso(date);
    const previousSession = sessionConfigs[sessionIndex - 1];

    if (sessionIndex === 0) {
      return !isAllowedSensorimotorFirstSessionDate(isoDate);
    }

    if (!previousSession || !selections.session1.date) {
      return true;
    }

    return (
      !isWithinSameWeek(isoDate, selections.session1.date) ||
      !isWeekdayDate(isoDate) ||
      !isSameOrAfterDate(isoDate, selections[previousSession.id].date)
    );
  }

  function handleSessionDateChange(sessionId: SessionId, value: string) {
    const sessionIndex = sessionConfigs.findIndex(
      (session) => session.id === sessionId,
    );

    setTouched(true);
    setBooking(null);

    if (
      sessionId === "session1" &&
      !isAllowedSensorimotorFirstSessionDate(value)
    ) {
      setMessage(
        `Choose Session 1 on a Monday or Tuesday within the next 8 weeks, through ${latestSensorimotorBookingDate}.`,
      );
      return;
    }

    if (
      sessionId !== "session1" &&
      (!isWithinSameWeek(value, selections.session1.date) ||
        !isWeekdayDate(value) ||
        !isSameOrAfterDate(
          value,
          selections[sessionConfigs[sessionIndex - 1].id].date,
        ))
    ) {
      setMessage(
        "Choose a weekday in the same week, on or after the previous session date.",
      );
      return;
    }

    setMessage("");
    setSelections((current) => {
      const next = clearLaterSessions(current, sessionIndex, true);

      next[sessionId] = {
        day: getDayForDate(value),
        date: value,
        slot: "",
      };

      return next;
    });

    if (sessionId === "session1") {
      setFirstSessionDate(value);
    }
  }

  function handleSlotChange(sessionId: SessionId, value: string) {
    if (!usesPerSessionDates) {
      updateSelection(sessionId, "slot", value);
      return;
    }

    const sessionIndex = sessionConfigs.findIndex(
      (session) => session.id === sessionId,
    );

    setSelections((current) => {
      const next = clearLaterSessions(current, sessionIndex, true);

      next[sessionId] = {
        ...next[sessionId],
        slot: value,
      };

      return next;
    });
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
    setOccupiedSlotReasons(emptyOccupiedSlotReasons());
  }

  function getSlotBlockReason(
    sessionId: SessionId,
    key: string,
    isBooked: boolean,
    isSelectedEarlier: boolean,
  ): SlotBlockReason | undefined {
    if (isBooked) {
      return occupiedSlotReasons[sessionId][key] ?? "unavailable";
    }

    if (isSelectedEarlier) {
      return "unavailable";
    }

    return undefined;
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
          tag: study.tag,
          email: email.trim().toLowerCase(),
          firstSessionDate: usesPerSessionDates
            ? selections.session1.date
            : firstSessionDate,
          selections,
        }),
      });
      const data = await parseJsonResponse<{
        booking?: BookingEntry;
        message?: string;
        occupiedSlotReasons?: OccupiedSlotReasons;
        occupiedSlots?: OccupiedSlots;
        existingBooking?: BookingEntry | null;
      }>(response);

      if (!response.ok) {
        setMessage(data.message ?? "Booking could not be saved.");

        if (data.occupiedSlots) {
          setOccupiedSlots(data.occupiedSlots);
          setOccupiedSlotReasons(
            data.occupiedSlotReasons ?? emptyOccupiedSlotReasons(),
          );
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
        setOccupiedSlotReasons(
          data.occupiedSlotReasons ?? emptyOccupiedSlotReasons(),
        );
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
      <section className="experiment-banner" aria-label={`${study.title} flyer`}>
        <Image
          src={flyer}
          alt={study.flyerAlt}
          className="banner-image"
          priority
        />
      </section>

      <form className="booking-form" onSubmit={handleSubmit}>
        <div
          className={
            usesPerSessionDates
              ? "form-header form-header-compact"
              : "form-header"
          }
        >
          <div>
            <p className="eyebrow">Booking details</p>
            <h2>Choose your session slots</h2>
          </div>
          {!usesPerSessionDates ? (
            <label className="date-field">
              <span>First session date</span>
              <FirstSessionDatePicker
                value={firstSessionDate}
                onChange={handleFirstSessionDateChange}
                onBlur={() => setTouched(true)}
                invalid={
                  touched && firstSessionDate !== "" && !startDateSelected
                }
              />
              <small>
                Session 1 must start on a Tuesday within the next 4 weeks.
              </small>
            </label>
          ) : null}
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
          <section
            className="existing-bookings-inline"
            aria-labelledby="existing-title"
          >
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

        <div className="slot-color-index" aria-label="Color index">
          <span>
            <i data-color="other-researcher" aria-hidden="true" />
            Other researcher
          </span>
          <span>
            <i data-color="unavailable" aria-hidden="true" />
            Unavailable
          </span>
        </div>

        <div className="session-grid">
          {sessionConfigs.map((session, sessionIndex) => {
            const previousSession = sessionConfigs[sessionIndex - 1];
            const sessionUnlocked =
              !usesPerSessionDates ||
              !previousSession ||
              Boolean(
                selections[previousSession.id].date &&
                  selections[previousSession.id].slot,
              );
            const selectedDate = selections[session.id].date;
            const slotPickerEnabled = usesPerSessionDates
              ? sessionUnlocked && Boolean(selectedDate)
              : startDateSelected;

            return (
              <fieldset className="session-column" key={session.id}>
                <legend>{session.title}</legend>
                <p>
                  {usesPerSessionDates
                    ? "Choose date, then time"
                    : "Consecutive session day"}
                </p>

                {usesPerSessionDates ? (
                  <label className="date-field session-date-field">
                    <span>Session date</span>
                    <FirstSessionDatePicker
                      value={selectedDate}
                      onChange={(value) =>
                        handleSessionDateChange(session.id, value)
                      }
                      onBlur={() => setTouched(true)}
                      invalid={
                        touched &&
                        selectedDate !== "" &&
                        (session.id === "session1"
                          ? !isAllowedSensorimotorFirstSessionDate(selectedDate)
                          : !isWithinSameWeek(
                              selectedDate,
                              selections.session1.date,
                            ) ||
                            !isWeekdayDate(selectedDate) ||
                            !isSameOrAfterDate(
                              selectedDate,
                              selections[sessionConfigs[sessionIndex - 1].id]
                                .date,
                            ))
                      }
                      disabled={!sessionUnlocked}
                      isDateUnavailable={(date) =>
                        isSessionDateUnavailable(date, sessionIndex)
                      }
                      note={
                        session.id === "session1"
                          ? `Select a Monday or Tuesday within the next 8 weeks, through ${latestSensorimotorBookingDate}.`
                          : "Select a weekday in the same week, on or after the previous session date."
                      }
                      placeholder={
                        sessionUnlocked
                          ? "Pick a date"
                          : "Complete previous session"
                      }
                    />
                    <small>
                      {sessionUnlocked
                        ? "Time slots update after a date is selected."
                        : "Choose the previous session date and time first."}
                    </small>
                  </label>
                ) : startDateSelected ? (
                  <div className="session-date">
                    <span>Day and date</span>
                    <strong>
                      {formatDisplayDate(selections[session.id].date)}
                    </strong>
                  </div>
                ) : null}

                <div className="slot-group" role="radiogroup">
                  {study.slotOptions.map((slot) => {
                    const inputId = `${study.tag}-${session.id}-${slot}`;
                    const key = slotKey(selections[session.id].date, slot);
                    const isBooked = occupiedSlots[session.id].includes(key);
                    const isSelectedEarlier =
                      usesPerSessionDates &&
                      sessionConfigs
                        .slice(0, sessionIndex)
                        .some(
                          (previous) =>
                            selections[previous.id].date === selectedDate &&
                            selections[previous.id].slot === slot,
                        );
                    const blockReason = getSlotBlockReason(
                      session.id,
                      key,
                      isBooked,
                      isSelectedEarlier,
                    );

                    return (
                      <label
                        className="slot-option"
                        data-block-reason={blockReason}
                        htmlFor={inputId}
                        key={slot}
                      >
                        <input
                          id={inputId}
                          type="radio"
                          name={session.id}
                          value={slot}
                          checked={selections[session.id].slot === slot}
                          onChange={(event) =>
                            handleSlotChange(session.id, event.target.value)
                          }
                          disabled={
                            !slotPickerEnabled || isBooked || isSelectedEarlier
                          }
                          required
                        />
                        <span>
                          {slot}
                          {isBooked
                            ? blockReason === "other-researcher"
                              ? " other researcher"
                              : " unavailable"
                            : ""}
                          {!isBooked && isSelectedEarlier ? " selected" : ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
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
            <button
              type="button"
              className="secondary-button"
              onClick={cancelEdit}
            >
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
                  {formatDisplayDate(booking.selections[session.id].date)},{" "}
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
