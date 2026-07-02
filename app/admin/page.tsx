"use client";

import { CSSProperties, FormEvent, ReactNode, useMemo, useState } from "react";
import { FirstSessionDatePicker } from "@/components/first-session-date-picker";
import {
  BlockedSlotEntry,
  BookingEntry,
  StudyTag,
  buildSelectionsForStartDate,
  formatDisplayDate,
  getBookingTag,
  getBlockedSlotTag,
  getLatestFirstSessionDate,
  getSlotOptions,
  getStudyConfig,
  isAllowedFirstSessionDate,
  sessionConfigs,
  studyConfigs,
} from "@/lib/booking";

type AdminResponse = {
  bookings?: BookingEntry[];
  blockedSlots?: BlockedSlotEntry[];
  cimecBlockedSlots?: CimecBlockedSlotEntry[];
  message?: string;
};

type CimecBlockedSlotEntry = BlockedSlotEntry & {
  source: "cimec-calendar";
  sourceLabel: string;
  timeRange: string;
};

type StudyFilter = "all" | StudyTag;
type BlockSource = "manual" | "cimec";

type CalendarEvent = {
  id: string;
  date: string;
  slot: string;
  title: string;
  subtitle?: string;
  note?: string;
  timeLabel?: string;
  variant: "booking" | "manual-block" | "cimec-block";
  actions?: ReactNode;
};

const calendarDayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const calendarStartMinutes = 8 * 60;
const calendarEndMinutes = 19 * 60;
const calendarHourLabels = Array.from({ length: 12 }, (_, index) => {
  const hour = index + 8;
  return `${String(hour).padStart(2, "0")}:00`;
});

async function parseJsonResponse<T>(response: Response) {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

function parseLocalDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  const parsedDate = new Date(year, month - 1, day);
  parsedDate.setHours(0, 0, 0, 0);

  return parsedDate;
}

function getWeekStart(date: Date) {
  const weekStart = new Date(date);
  const weekday = weekStart.getDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  weekStart.setDate(weekStart.getDate() - daysSinceMonday);
  weekStart.setHours(0, 0, 0, 0);

  return weekStart;
}

function formatIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getWeekEnd(weekStart: Date) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  return weekEnd;
}

function getWeekStartKeyForDate(date: string) {
  const parsedDate = parseLocalDate(date);

  return parsedDate ? formatIsoDate(getWeekStart(parsedDate)) : "";
}

function getWeekDates(weekStartKey: string) {
  const weekStart = parseLocalDate(weekStartKey);

  if (!weekStart) {
    return [];
  }

  return calendarDayLabels.map((_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);

    return formatIsoDate(date);
  });
}

function getWeekLabel(weekStartKey: string) {
  const weekStart = parseLocalDate(weekStartKey);

  if (!weekStart) {
    return "Week";
  }

  return `${formatDisplayDate(formatIsoDate(weekStart))} - ${formatDisplayDate(
    formatIsoDate(getWeekEnd(weekStart)),
  )}`;
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
}

function parseSlotRange(slot: string) {
  const [start, end] = slot.split(" - ").map((value) => value.trim());
  const startMinutes = timeToMinutes(start ?? "");
  const endMinutes = timeToMinutes(end ?? "");

  if (
    startMinutes === null ||
    endMinutes === null ||
    endMinutes <= startMinutes
  ) {
    return null;
  }

  return { start, end, startMinutes, endMinutes };
}

function getCalendarEventStyle(slot: string, lane: number) {
  const range = parseSlotRange(slot);

  if (!range) {
    return {};
  }

  const totalMinutes = calendarEndMinutes - calendarStartMinutes;
  const top =
    ((Math.max(range.startMinutes, calendarStartMinutes) -
      calendarStartMinutes) /
      totalMinutes) *
    100;
  const height =
    ((Math.min(range.endMinutes, calendarEndMinutes) -
      Math.max(range.startMinutes, calendarStartMinutes)) /
      totalMinutes) *
    100;

  return {
    "--event-top": `${Math.max(0, top)}%`,
    "--event-height": `${Math.max(6, height)}%`,
    "--event-lane": lane,
  } as CSSProperties;
}

function getWeeksForCalendarEvents(
  _events: CalendarEvent[],
  selectedWeekDate: string,
) {
  return [getWeekStartKeyForDate(selectedWeekDate)];
}

function isDateInSelectedWeek(date: string, selectedWeekDate: string) {
  const weekKey = getWeekStartKeyForDate(selectedWeekDate);

  return getWeekStartKeyForDate(date) === weekKey;
}

function getTodayIsoDate() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return formatIsoDate(today);
}

function formatIcsDateTime(date: string, time: string) {
  return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function escapeIcsText(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r?\n/g, "\\n");
}

function foldIcsLine(line: string) {
  const chunks: string[] = [];
  let remaining = line;

  while (remaining.length > 74) {
    chunks.push(remaining.slice(0, 74));
    remaining = ` ${remaining.slice(74)}`;
  }

  chunks.push(remaining);

  return chunks.join("\r\n");
}

function getIcsEventType(event: CalendarEvent) {
  if (event.variant === "booking") {
    return "Booking";
  }

  if (event.variant === "manual-block") {
    return "Manual blocked slot";
  }

  return "CIMeC blocked slot";
}

function buildIcsCalendar(events: CalendarEvent[], selectedWeekDate: string) {
  const weekKey = getWeekStartKeyForDate(selectedWeekDate);
  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Booking MEG//Admin Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Booking admin calendar",
    "X-WR-TIMEZONE:Europe/Rome",
  ];

  for (const event of events) {
    const range = parseSlotRange(event.slot);

    if (!range) {
      continue;
    }

    const summary = `${getIcsEventType(event)}: ${event.title}`;
    const description = [
      event.subtitle,
      event.note,
      event.timeLabel ? `Time: ${event.timeLabel}` : undefined,
      `Date: ${formatDisplayDate(event.date)}`,
      `Type: ${getIcsEventType(event)}`,
    ]
      .filter(Boolean)
      .join("\n");

    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(`${event.id}-${weekKey}@booking-meg`)}`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=Europe/Rome:${formatIcsDateTime(event.date, range.start)}`,
      `DTEND;TZID=Europe/Rome:${formatIcsDateTime(event.date, range.end)}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");

  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

export default function ViewBookingsPage() {
  const [password, setPassword] = useState("");
  const [bookings, setBookings] = useState<BookingEntry[]>([]);
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlotEntry[]>([]);
  const [cimecBlockedSlots, setCimecBlockedSlots] = useState<
    CimecBlockedSlotEntry[]
  >([]);
  const [blockStudy, setBlockStudy] = useState<StudyTag>("meg-study");
  const [blockDate, setBlockDate] = useState("");
  const [blockSlot, setBlockSlot] = useState(
    studyConfigs["meg-study"].slotOptions[0],
  );
  const [blockNote, setBlockNote] = useState("");
  const [editingBooking, setEditingBooking] = useState<BookingEntry | null>(
    null,
  );
  const [authenticated, setAuthenticated] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [studyFilter, setStudyFilter] = useState<StudyFilter>("all");
  const [selectedWeekDate, setSelectedWeekDate] = useState(getTodayIsoDate);

  const visibleBookings = useMemo(() => {
    return bookings.filter(
      (booking) => studyFilter === "all" || getBookingTag(booking) === studyFilter,
    );
  }, [bookings, studyFilter]);

  const totalBlockedSlots = blockedSlots.length + cimecBlockedSlots.length;

  const blockedCalendarEvents = useMemo(() => {
    const manualEvents = blockedSlots.map((blockedSlot) => {
      const tag = getBlockedSlotTag(blockedSlot);

      return {
        blockedSlot,
        source: "manual" as BlockSource,
        tag,
      };
    });
    const cimecEvents = cimecBlockedSlots.map((blockedSlot) => {
      const tag = getBlockedSlotTag(blockedSlot);

      return {
        blockedSlot,
        source: "cimec" as BlockSource,
        tag,
      };
    });

    return [...manualEvents, ...cimecEvents]
      .filter(({ blockedSlot, tag }) => {
        const matchesStudy = studyFilter === "all" || tag === studyFilter;
        const matchesDate = isDateInSelectedWeek(
          blockedSlot.date,
          selectedWeekDate,
        );

        return matchesStudy && matchesDate;
      })
      .map(({ blockedSlot, source, tag }) => {
        const study = getStudyConfig(tag);
        const isCimec = source === "cimec";

        return {
          id: `${source}-${blockedSlot.id}`,
          date: blockedSlot.date,
          slot: blockedSlot.slot,
          title: isCimec ? "CIMeC busy" : "Manual block",
          subtitle: isCimec
            ? (blockedSlot as CimecBlockedSlotEntry).sourceLabel
            : study.title,
          note: blockedSlot.note,
          timeLabel: isCimec
            ? (blockedSlot as CimecBlockedSlotEntry).timeRange
            : blockedSlot.slot,
          variant: isCimec ? "cimec-block" : "manual-block",
          actions: isCimec ? (
            <span className="calendar-event-badge">Read-only</span>
          ) : (
            <button
              type="button"
              onClick={() => removeBlockedSlot(blockedSlot.id)}
              disabled={isLoading}
            >
              Remove
            </button>
          ),
        } satisfies CalendarEvent;
      })
      .toSorted(
        (firstEvent, secondEvent) =>
          firstEvent.date.localeCompare(secondEvent.date) ||
          firstEvent.slot.localeCompare(secondEvent.slot) ||
          firstEvent.title.localeCompare(secondEvent.title),
      );
  }, [
    blockedSlots,
    cimecBlockedSlots,
    isLoading,
    selectedWeekDate,
    studyFilter,
  ]);

  const bookingCalendarEvents = useMemo(() => {
    return visibleBookings
      .flatMap((booking) => {
        const tag = getBookingTag(booking);
        const study = getStudyConfig(tag);

        return sessionConfigs.map((session) => {
          const selection = booking.selections[session.id];

          return {
            id: `${booking.id}-${session.id}`,
            date: selection.date,
            slot: selection.slot,
            title: booking.email,
            subtitle: `${study.title} - ${session.title}`,
            note: `${selection.day}, ${formatDisplayDate(selection.date)}`,
            timeLabel: selection.slot,
            variant: "booking",
            actions: (
              <>
                <button type="button" onClick={() => setEditingBooking(booking)}>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => removeBooking(booking.id)}
                  disabled={isLoading}
                >
                  Remove
                </button>
              </>
            ),
          } satisfies CalendarEvent;
        });
      })
      .filter((event) => isDateInSelectedWeek(event.date, selectedWeekDate))
      .toSorted(
        (firstEvent, secondEvent) =>
          firstEvent.date.localeCompare(secondEvent.date) ||
          firstEvent.slot.localeCompare(secondEvent.slot) ||
          firstEvent.title.localeCompare(secondEvent.title),
      );
  }, [isLoading, selectedWeekDate, visibleBookings]);

  const calendarEvents = useMemo(() => {
    return [...bookingCalendarEvents, ...blockedCalendarEvents].toSorted(
      (firstEvent, secondEvent) =>
        firstEvent.date.localeCompare(secondEvent.date) ||
        firstEvent.slot.localeCompare(secondEvent.slot) ||
        firstEvent.variant.localeCompare(secondEvent.variant) ||
        firstEvent.title.localeCompare(secondEvent.title),
    );
  }, [blockedCalendarEvents, bookingCalendarEvents]);

  const exportableCalendarEvents = useMemo(
    () =>
      calendarEvents.filter((event) => event.variant !== "cimec-block"),
    [calendarEvents],
  );

  async function requestAdminBookings(
    method: "GET" | "POST" | "PUT" | "DELETE",
    body?: object,
  ) {
    const response = await fetch("/api/admin/bookings", {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": password,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await parseJsonResponse<AdminResponse>(response);

    if (!response.ok) {
      throw new Error(data.message ?? "Request failed.");
    }

    return data;
  }

  async function unlockBookings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setMessage("");

    try {
      const data = await requestAdminBookings("GET");
      setBookings(data.bookings ?? []);
      setBlockedSlots(data.blockedSlots ?? []);
      setCimecBlockedSlots(data.cimecBlockedSlots ?? []);
      setAuthenticated(true);
    } catch (error) {
      setAuthenticated(false);
      setMessage(error instanceof Error ? error.message : "Could not unlock.");
    } finally {
      setIsLoading(false);
    }
  }

  function updateEditingBooking(nextBooking: BookingEntry) {
    setEditingBooking(nextBooking);
  }

  function updateStartDate(firstSessionDate: string) {
    if (!editingBooking) {
      return;
    }

    updateEditingBooking({
      ...editingBooking,
      firstSessionDate,
      selections: buildSelectionsForStartDate(
        firstSessionDate,
        editingBooking.selections,
      ),
    });
  }

  async function saveBooking() {
    if (!editingBooking) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const data = await requestAdminBookings("PUT", {
        booking: editingBooking,
      });
      setBookings(data.bookings ?? []);
      setBlockedSlots(data.blockedSlots ?? []);
      setCimecBlockedSlots(data.cimecBlockedSlots ?? []);
      setEditingBooking(null);
      setMessage(data.message ?? "Booking updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update.");
    } finally {
      setIsLoading(false);
    }
  }

  async function removeBooking(id: string) {
    if (!window.confirm("Remove this booking?")) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const data = await requestAdminBookings("DELETE", { id });
      setBookings(data.bookings ?? []);
      setBlockedSlots(data.blockedSlots ?? []);
      setCimecBlockedSlots(data.cimecBlockedSlots ?? []);
      setEditingBooking((current) => (current?.id === id ? null : current));
      setMessage(data.message ?? "Booking removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove.");
    } finally {
      setIsLoading(false);
    }
  }

  async function addBlockedSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setMessage("");

    try {
      const data = await requestAdminBookings("POST", {
        blockedSlot: {
          tag: blockStudy,
          date: blockDate,
          slot: blockSlot,
          note: blockNote,
        },
      });
      setBookings(data.bookings ?? []);
      setBlockedSlots(data.blockedSlots ?? []);
      setCimecBlockedSlots(data.cimecBlockedSlots ?? []);
      setBlockDate("");
      setBlockNote("");
      setMessage(data.message ?? "Slot blocked.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not block slot.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function removeBlockedSlot(id: string) {
    if (!window.confirm("Remove this blocked slot?")) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const data = await requestAdminBookings("DELETE", { blockedSlotId: id });
      setBookings(data.bookings ?? []);
      setBlockedSlots(data.blockedSlots ?? []);
      setCimecBlockedSlots(data.cimecBlockedSlots ?? []);
      setMessage(data.message ?? "Blocked slot removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove.");
    } finally {
      setIsLoading(false);
    }
  }

  function updateBlockStudy(tag: StudyTag) {
    const nextSlotOptions = getSlotOptions(tag);

    setBlockStudy(tag);
    setBlockSlot(nextSlotOptions[0]);
  }

  function downloadShownWeekIcs() {
    const ics = buildIcsCalendar(exportableCalendarEvents, selectedWeekDate);
    const weekKey = getWeekStartKeyForDate(selectedWeekDate);
    const blob = new Blob([ics], {
      type: "text/calendar;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `booking-admin-week-${weekKey}.ics`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function renderWeekCalendar(events: CalendarEvent[], emptyMessage: string) {
    const weekKeys = getWeeksForCalendarEvents(events, selectedWeekDate);

    return (
      <div className="week-calendar-stack">
        {weekKeys.map((weekKey) => {
          const weekDates = getWeekDates(weekKey);
          const weekEvents = events.filter((event) =>
            weekDates.includes(event.date),
          );

          return (
            <section className="week-calendar" key={weekKey}>
              <div className="week-calendar-title">
                <h3>{getWeekLabel(weekKey)}</h3>
                <span>{weekEvents.length} items</span>
              </div>
              <div className="week-calendar-grid">
                <div className="week-calendar-corner" />
                {weekDates.map((date, index) => (
                  <div className="week-calendar-day-header" key={date}>
                    <span>{calendarDayLabels[index]}</span>
                    <strong>{formatDisplayDate(date)}</strong>
                  </div>
                ))}
                <div className="week-calendar-times" aria-hidden="true">
                  {calendarHourLabels.map((hour) => (
                    <span key={hour}>{hour}</span>
                  ))}
                </div>
                {weekDates.map((date) => {
                  const dayEvents = weekEvents.filter(
                    (event) => event.date === date,
                  );

                  return (
                    <div className="week-calendar-day" key={date}>
                      {dayEvents.map((event, index) => {
                        const lane = dayEvents
                          .slice(0, index)
                          .filter(
                            (previousEvent) =>
                              previousEvent.slot === event.slot,
                          ).length;
                        const timeRange = parseSlotRange(event.slot);
                        const timeLabel =
                          event.timeLabel ??
                          (timeRange
                            ? `${timeRange.start} - ${timeRange.end}`
                            : "");

                        return (
                          <article
                            className={`calendar-event calendar-event-${event.variant}`}
                            key={event.id}
                            style={getCalendarEventStyle(event.slot, lane)}
                          >
                            <div>
                              <strong>{event.title}</strong>
                              {event.subtitle ? (
                                <span>{event.subtitle}</span>
                              ) : null}
                              {event.note ? <p>{event.note}</p> : null}
                              {timeLabel ? (
                                <span className="calendar-event-time">
                                  {timeLabel}
                                </span>
                              ) : null}
                            </div>
                            {event.actions ? (
                              <div className="calendar-event-actions">
                                {event.actions}
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  );
                })}
                {weekEvents.length === 0 ? (
                  <p className="week-calendar-empty">{emptyMessage}</p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <main className="page-shell">
      <section className="bookings-admin">
        <div className="bookings-admin-header">
          <div>
            <p className="eyebrow">MEG experiment</p>
            <h1>Admin</h1>
          </div>
          {authenticated ? (
            <strong>
              {bookings.length} bookings, {totalBlockedSlots} blocked
            </strong>
          ) : null}
        </div>

        {!authenticated ? (
          <form className="admin-password-form" onSubmit={unlockBookings}>
            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                required
              />
            </label>
            <button type="submit" disabled={isLoading}>
              {isLoading ? "Checking..." : "View bookings"}
            </button>
          </form>
        ) : null}

        {message ? (
          <p className="form-message" role="alert">
            {message}
          </p>
        ) : null}

        {authenticated && bookings.length === 0 ? (
          <p className="empty-bookings">No bookings have been saved yet.</p>
        ) : null}

        {authenticated ? (
          <>
            <section
              className="blocked-slots-panel"
              aria-labelledby="admin-calendar-title"
            >
              <div className="admin-section-header">
                <div>
                  <p className="eyebrow">Schedule</p>
                  <h2 id="admin-calendar-title">Calendar</h2>
                </div>
                <strong>
                  {bookingCalendarEvents.length} booked, {totalBlockedSlots} blocked
                </strong>
              </div>

              <div className="bookings-controls" aria-label="Calendar filters">
                <label>
                  <span>Experiment</span>
                  <select
                    value={studyFilter}
                    onChange={(event) =>
                      setStudyFilter(event.target.value as StudyFilter)
                    }
                  >
                    <option value="all">All experiments</option>
                    <option value="meg-study">MEG experiment</option>
                    <option value="sensorimotor-study">
                      Sensorimotor study
                    </option>
                  </select>
                </label>
                <label>
                  <span>Week date</span>
                  <input
                    type="date"
                    value={selectedWeekDate}
                    onChange={(event) =>
                      setSelectedWeekDate(event.target.value || getTodayIsoDate())
                    }
                  />
                </label>

                <button
                  className="calendar-download-button"
                  type="button"
                  onClick={downloadShownWeekIcs}
                  disabled={exportableCalendarEvents.length === 0}
                >
                  Download ICS
                </button>
              </div>

              <form className="blocked-slot-form calendar-block-form" onSubmit={addBlockedSlot}>
                <label>
                  <span>Add block</span>
                  <select
                    value={blockStudy}
                    onChange={(event) =>
                      updateBlockStudy(event.target.value as StudyTag)
                    }
                  >
                    <option value="meg-study">MEG experiment</option>
                    <option value="sensorimotor-study">
                      Sensorimotor study
                    </option>
                  </select>
                </label>
                <label>
                  <span>Date</span>
                  <input
                    type="date"
                    value={blockDate}
                    onChange={(event) => setBlockDate(event.target.value)}
                    required
                  />
                </label>
                <label>
                  <span>Slot</span>
                  <select
                    value={blockSlot}
                    onChange={(event) => setBlockSlot(event.target.value)}
                  >
                    {getSlotOptions(blockStudy).map((slot) => (
                      <option value={slot} key={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Note</span>
                  <input
                    type="text"
                    value={blockNote}
                    onChange={(event) => setBlockNote(event.target.value)}
                    placeholder="Optional"
                  />
                </label>
                <button type="submit" disabled={isLoading}>
                  Block slot
                </button>
              </form>

              {editingBooking ? (
                <section className="booking-edit-panel" aria-label="Edit booking">
                  <div>
                    <span>
                      {getStudyConfig(getBookingTag(editingBooking)).title}
                    </span>
                    <h3>{editingBooking.email}</h3>
                  </div>
                  <div className="booking-edit-grid">
                    <label>
                      <span>Email</span>
                      <input
                        className="admin-table-input"
                        type="email"
                        value={editingBooking.email}
                        onChange={(event) =>
                          updateEditingBooking({
                            ...editingBooking,
                            email: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>First session</span>
                      {getBookingTag(editingBooking) === "meg-study" ? (
                        <FirstSessionDatePicker
                          value={editingBooking.firstSessionDate}
                          onChange={updateStartDate}
                          onBlur={() => undefined}
                          invalid={
                            !isAllowedFirstSessionDate(
                              editingBooking.firstSessionDate,
                            )
                          }
                          note={`Select a Thursday within the next 4 weeks, through ${formatDisplayDate(getLatestFirstSessionDate())}.`}
                        />
                      ) : (
                        <input
                          className="admin-table-input"
                          type="date"
                          value={editingBooking.firstSessionDate}
                          onChange={(event) =>
                            updateStartDate(event.target.value)
                          }
                        />
                      )}
                    </label>
                    {sessionConfigs.map((session) => {
                      const rowTag = getBookingTag(editingBooking);
                      const rowSlotOptions = getSlotOptions(rowTag);

                      return (
                        <label key={session.id}>
                          <span>
                            {session.title},{" "}
                            {formatDisplayDate(
                              editingBooking.selections[session.id].date,
                            )}
                          </span>
                          <select
                            className="admin-table-input"
                            value={editingBooking.selections[session.id].slot}
                            onChange={(event) =>
                              updateEditingBooking({
                                ...editingBooking,
                                selections: {
                                  ...editingBooking.selections,
                                  [session.id]: {
                                    ...editingBooking.selections[session.id],
                                    slot: event.target.value,
                                  },
                                },
                              })
                            }
                          >
                            {rowSlotOptions.map((slot) => (
                              <option value={slot} key={slot}>
                                {slot}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                  <div className="admin-actions">
                    <button
                      type="button"
                      onClick={saveBooking}
                      disabled={isLoading}
                    >
                      Save
                    </button>
                    <button type="button" onClick={() => setEditingBooking(null)}>
                      Cancel
                    </button>
                  </div>
                </section>
              ) : null}

              {renderWeekCalendar(
                calendarEvents,
                "No calendar items match the selected filters.",
              )}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
