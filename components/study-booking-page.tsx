"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import { useRouter } from "next/navigation";
import {
  BookingEntry,
  BookingState,
  buildSelectionsForStartDate,
  emptyOccupiedSlotReasons,
  emptyOccupiedSlots,
  formatDisplayDate,
  getDayForDate,
  getEarliestBookingDate,
  getEarliestSemanticForagingBookingDate,
  getLatestMegFirstSessionDate,
  getLatestSemanticForagingBookingDate,
  getPerSessionDateRule,
  getScheduleRequirement,
  getSessionConfigs,
  getSessionDate,
  getSlotOptionsForDate,
  initialSelections,
  isAllowedPerSessionDate,
  isAllowedStartDate,
  isValidEmail,
  isValidParticipantName,
  OccupiedSlotReasons,
  OccupiedSlots,
  SessionId,
  SessionSelection,
  SlotBlockReason,
  slotKey,
  StudyConfig,
} from "@/lib/booking";
import { FirstSessionDatePicker } from "@/components/first-session-date-picker";

type StudyBookingPageProps = {
  flyer?: StaticImageData | string | null;
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

function getSessionActivityLabel(sessionId: SessionId) {
  return sessionId === "session4"
    ? "Magnetoencephalography (MEG)"
    : "Behavioral and eye tracking";
}

export function StudyBookingPage({ flyer, study }: StudyBookingPageProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [speaksEnglish, setSpeaksEnglish] = useState<boolean | null>(null);
  const [weekendSessionsAccepted, setWeekendSessionsAccepted] =
    useState(false);
  const [criteriaAccepted, setCriteriaAccepted] = useState(false);
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
  const [showOtherExperimentsPrompt, setShowOtherExperimentsPrompt] =
    useState(false);
  const router = useRouter();
  const usesPerSessionDates = study.dateSelectionMode === "per-session";
  const usesSemanticForagingSchedule = study.tag === "semantic-foraging";
  const requiresWeekendSessions = study.requiresWeekendSessions === true;
  const studySessions = useMemo(() => getSessionConfigs(study.tag), [study.tag]);
  const selectedDateKey = studySessions
    .map((session) => selections[session.id].date)
    .join("|");

  const missingSlots = useMemo(
    () =>
      studySessions.filter((session) => selections[session.id].slot === ""),
    [selections, studySessions],
  );
  const unavailableSelections = useMemo(
    () =>
      studySessions.filter(
        (session) =>
          selections[session.id].slot &&
          occupiedSlots[session.id].includes(
            slotKey(selections[session.id].date, selections[session.id].slot),
          ),
      ),
    [occupiedSlots, selections, studySessions],
  );

  const nameLooksValid = isValidParticipantName(name);
  const emailLooksValid = isValidEmail(email);
  const legacyFirstSession = Boolean(editingBookingId &&
    existingBooking?.firstSessionDate === selections.session1.date &&
    existingBooking?.selections.session1.slot === selections.session1.slot);
  const startDateSelected = legacyFirstSession || isAllowedStartDate(
    usesPerSessionDates ? selections.session1.date : firstSessionDate,
    study.tag,
  );
  const invalidSessionDates = useMemo(
    () =>
      usesPerSessionDates
        ? studySessions.filter(
            (session, index) =>
              !((editingBookingId &&
                existingBooking?.selections[session.id]?.date === selections[session.id].date &&
                existingBooking?.selections[session.id]?.slot === selections[session.id].slot) ||
                isAllowedPerSessionDate(
                study.tag,
                index,
                selections[session.id].date,
                selections,
              )),
          )
        : [],
    [editingBookingId, existingBooking, selections, study.tag, studySessions, usesPerSessionDates],
  );
  const latestBookingDate = formatDisplayDate(getLatestMegFirstSessionDate());
  const earliestBookingDate = formatDisplayDate(getEarliestBookingDate());
  const earliestSemanticForagingBookingDate = formatDisplayDate(
    getEarliestSemanticForagingBookingDate(),
  );
  const latestSemanticForagingBookingDate = formatDisplayDate(
    getLatestSemanticForagingBookingDate(),
  );
  const scheduleRequirement = getScheduleRequirement(study.tag);
  const scheduleMessage = `${scheduleRequirement.charAt(0).toUpperCase()}${scheduleRequirement.slice(1)}.`;
  const validationMessages: string[] = [
    (usesPerSessionDates ? invalidSessionDates.length > 0 : !startDateSelected)
      ? scheduleMessage
      : "",
    !nameLooksValid ? "Enter your name." : "",
    !emailLooksValid ? "Enter a valid email address." : "",
    speaksEnglish === null
      ? "Let us know whether you can follow instructions in English."
      : "",
    requiresWeekendSessions && !weekendSessionsAccepted
      ? "Confirm that you can attend the Saturday and Sunday sessions."
      : "",
    !criteriaAccepted
      ? "Read and accept the eligibility criteria before booking."
      : "",
    missingSlots.length > 0
      ? `Select a slot for ${missingSlots.map((session) => session.title).join(", ")}.`
      : "",
  ].filter(Boolean);
  const formIsComplete =
    nameLooksValid &&
    emailLooksValid &&
    speaksEnglish !== null &&
    (!requiresWeekendSessions || weekendSessionsAccepted) &&
    criteriaAccepted &&
    startDateSelected &&
    invalidSessionDates.length === 0 &&
    missingSlots.length === 0 &&
    unavailableSelections.length === 0;

  useEffect(() => {
    if (!showOtherExperimentsPrompt) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowOtherExperimentsPrompt(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showOtherExperimentsPrompt]);

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
        studySessions.forEach((session) => {
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
    studySessions,
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

  function handleFirstSessionDateChange(value: string) {
    setTouched(true);
    setBooking(null);

    if (value && !isAllowedStartDate(value, study.tag)) {
      setFirstSessionDate("");
      setOccupiedSlots(emptyOccupiedSlots());
      setOccupiedSlotReasons(emptyOccupiedSlotReasons());
      setMessage(scheduleMessage);
      return;
    }

    setMessage("");
    setFirstSessionDate(value);
    setSelections((current) =>
      buildSelectionsForStartDate(value, current, study.tag),
    );
  }

  function handleEmailChange(value: string) {
    setEmail(value);
    setBooking(null);

    if (editingBookingId) {
      setEditingBookingId("");
      setMessage("");
    }
  }

  function handleNameChange(value: string) {
    setName(value);
    setBooking(null);
  }

  function isSessionDateUnavailable(date: Date, sessionIndex: number) {
    return !isAllowedPerSessionDate(
      study.tag,
      sessionIndex,
      dateToIso(date),
      selections,
    );
  }

  function handleSessionDateChange(sessionId: SessionId, value: string) {
    const sessionIndex = studySessions.findIndex(
      (session) => session.id === sessionId,
    );

    setTouched(true);
    setBooking(null);

    if (!isAllowedPerSessionDate(study.tag, sessionIndex, value, selections)) {
      setMessage(getPerSessionDateRule(study.tag, sessionIndex, selections));
      return;
    }

    setMessage("");
    setSelections((current) => {
      const next: BookingState = {
        ...current,
        [sessionId]: { day: getDayForDate(value), date: value, slot: "" },
      };

      // Keep later sessions that still satisfy the date rules; clear the
      // first one that no longer does, and everything after it.
      for (let index = sessionIndex + 1; index < studySessions.length; index += 1) {
        const laterSession = studySessions[index];

        if (
          !isAllowedPerSessionDate(
            study.tag,
            index,
            next[laterSession.id].date,
            next,
          )
        ) {
          for (const clearedSession of studySessions.slice(index)) {
            next[clearedSession.id] = { day: "", date: "", slot: "" };
          }
          break;
        }
      }

      return next;
    });

    if (sessionId === "session1") {
      setFirstSessionDate(value);
    }
  }

  function handleSlotChange(sessionId: SessionId, value: string) {
    updateSelection(sessionId, "slot", value);
  }

  function loadExistingBooking(existingBooking: BookingEntry) {
    setTouched(false);
    setBooking(null);
    setMessage(
      "Existing booking loaded. Change any slot below, then update the booking.",
    );
    setEditingBookingId(existingBooking.id);
    setName(existingBooking.name ?? "");
    setEmail(existingBooking.email);
    setSpeaksEnglish(existingBooking.speaksEnglish ?? null);
    setWeekendSessionsAccepted(existingBooking.weekendSessionsAccepted ?? false);
    setCriteriaAccepted(false);
    setFirstSessionDate(existingBooking.firstSessionDate);
    setSelections(existingBooking.selections);
  }

  function cancelEdit() {
    setEmail("");
    setName("");
    setSpeaksEnglish(null);
    setWeekendSessionsAccepted(false);
    setCriteriaAccepted(false);
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
          name: name.trim(),
          email: email.trim().toLowerCase(),
          speaksEnglish,
          weekendSessionsAccepted: requiresWeekendSessions
            ? weekendSessionsAccepted
            : undefined,
          criteriaAccepted,
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

        if (!editingBookingId) {
          setShowOtherExperimentsPrompt(true);
        }
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
      {flyer ? (
        <section
          className="experiment-banner"
          aria-label={`${study.title} flyer`}
        >
          {typeof flyer === "string" ? (
            <img src={flyer} alt={study.flyerAlt} className="banner-image" />
          ) : (
            <Image
              src={flyer}
              alt={study.flyerAlt}
              className="banner-image"
              priority
            />
          )}
        </section>
      ) : null}

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
                isDateUnavailable={(date) =>
                  !isAllowedStartDate(dateToIso(date), study.tag)
                }
                note={
                  usesSemanticForagingSchedule
                    ? `Select a weekday between ${earliestSemanticForagingBookingDate} and ${latestSemanticForagingBookingDate}.`
                    : undefined
                }
              />
              <small>
                {usesSemanticForagingSchedule
                  ? `Session 1 can start on any weekday between ${earliestSemanticForagingBookingDate} and ${latestSemanticForagingBookingDate}. Session 2 is the next working day.`
                  : `Session 1 must start on a Thursday between ${earliestBookingDate} and ${latestBookingDate}.`}
              </small>
            </label>
          ) : null}
          <div className="participant-fields">
            <label className="participant-field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => handleNameChange(event.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="Your name"
                aria-invalid={touched && !nameLooksValid}
                autoComplete="name"
                required
              />
            </label>
            <label className="participant-field">
              <span>Email address</span>
              <input
                type="email"
                value={email}
                onChange={(event) => handleEmailChange(event.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="participant@example.com"
                aria-invalid={touched && !emailLooksValid}
                autoComplete="email"
                required
              />
            </label>
            <fieldset
              className="choice-field"
              aria-invalid={touched && speaksEnglish === null}
            >
              <legend>
                Are you able to understand and follow instructions in English?
              </legend>
              <div className="choice-options">
                {[
                  { label: "Yes", value: true },
                  { label: "No", value: false },
                ].map((option) => (
                  <label className="choice-option" key={option.label}>
                    <input
                      type="radio"
                      name={`${study.tag}-speaks-english`}
                      checked={speaksEnglish === option.value}
                      onChange={() => {
                        setSpeaksEnglish(option.value);
                        setBooking(null);
                      }}
                      required
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
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
            Unavailable 
          </span>
          <span>
            <i data-color="unavailable" aria-hidden="true" />
            Booked
          </span>
        </div>

        <div className="session-grid">
          {studySessions.map((session, sessionIndex) => {
            const previousSession = studySessions[sessionIndex - 1];
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
                    : getSessionActivityLabel(session.id)}
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
                        !isAllowedPerSessionDate(
                          study.tag,
                          sessionIndex,
                          selectedDate,
                          selections,
                        )
                      }
                      disabled={!sessionUnlocked}
                      defaultMonth={
                        previousSession
                          ? selections[previousSession.id].date
                          : undefined
                      }
                      isDateUnavailable={(date) =>
                        isSessionDateUnavailable(date, sessionIndex)
                      }
                      note={getPerSessionDateRule(
                        study.tag,
                        sessionIndex,
                        selections,
                      )}
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
                  {[...new Set([
                    ...getSlotOptionsForDate(study.tag, selectedDate),
                    ...(editingBookingId &&
                      existingBooking?.selections[session.id]?.date === selectedDate
                      ? [existingBooking.selections[session.id].slot]
                      : []),
                  ])].map((slot) => {
                    const inputId = `${study.tag}-${session.id}-${slot}`;
                    const key = slotKey(selections[session.id].date, slot);
                    const isBooked = occupiedSlots[session.id].includes(key);
                    const isSelectedEarlier =
                      usesPerSessionDates &&
                      studySessions
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
                            !slotPickerEnabled ||
                            isBooked ||
                            isSelectedEarlier
                          }
                          required
                        />
                        <span>
                          {slot}
                          {isBooked
                            ? blockReason === "other-researcher"
                              ? " unavailable"
                              : " booked"
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

        <section className="criteria-panel" aria-labelledby="criteria-title">
          <div>
            <p className="eyebrow">Eligibility criteria</p>
            <h3 id="criteria-title">Please read before booking</h3>
          </div>
          <ul>
            {study.eligibilityCriteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
          <label className="criteria-acceptance">
            <input
              type="checkbox"
              checked={criteriaAccepted}
              onChange={(event) => {
                setCriteriaAccepted(event.target.checked);
                setTouched(true);
                setBooking(null);
              }}
              required
            />
            <span>I have read and meet all of the eligibility criteria.</span>
          </label>
          {requiresWeekendSessions ? (
            <label className="criteria-acceptance">
              <input
                type="checkbox"
                checked={weekendSessionsAccepted}
                onChange={(event) => {
                  setWeekendSessionsAccepted(event.target.checked);
                  setTouched(true);
                  setBooking(null);
                }}
                required
              />
              <span>
                I agree to also complete a short session of about 30 minutes
                on both the Saturday and the Sunday between Session 2 and
                Session 3
                {startDateSelected
                  ? ` (${formatDisplayDate(getSessionDate(firstSessionDate, 2))} and ${formatDisplayDate(getSessionDate(firstSessionDate, 3))})`
                  : ""}
                .
              </span>
            </label>
          ) : null}
        </section>

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
          {booking.name ? <p>{booking.name}</p> : null}
          <p>{booking.email}</p>
          <dl>
            {studySessions.map((session) => (
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

      {showOtherExperimentsPrompt ? (
        <div className="admin-modal-backdrop" role="presentation">
          <section
            className="admin-modal admin-modal-narrow"
            role="dialog"
            aria-modal="true"
            aria-labelledby="other-experiments-title"
          >
            <div className="admin-modal-header">
              <div>
                <span>Booking confirmed</span>
                <h3 id="other-experiments-title">
                  Would you like to take part in our other experiments?
                </h3>
              </div>
            </div>
            <div className="admin-modal-body">
              <p>
                Thank you for booking. We are running other studies too, and
                you can see them and book sessions on the experiments page.
              </p>
            </div>
            <div className="admin-modal-footer">
              <button type="button" onClick={() => router.push("/")} autoFocus>
                Yes, show experiments
              </button>
              <button
                type="button"
                onClick={() => setShowOtherExperimentsPrompt(false)}
              >
                No, thanks
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
