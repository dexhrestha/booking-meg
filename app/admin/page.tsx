"use client";

import {
  CSSProperties,
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { FirstSessionDatePicker } from "@/components/first-session-date-picker";
import {
  BlockedSlotEntry,
  BookingEntry,
  SessionId,
  StudyTag,
  buildSelectionsForStartDate,
  formatDisplayDate,
  getBookingTag,
  getBlockedSlotTag,
  getEarliestBookingDate,
  getDayForDate,
  getLatestMegFirstSessionDate,
  getSessionConfigs,
  getSlotOptions,
  getStudyConfig,
  isAllowedFirstSessionDate,
  studyConfigs,
} from "@/lib/booking";

type AdminResponse = {
  bookings?: BookingEntry[];
  blockedSlots?: BlockedSlotEntry[];
  cimecBlockedSlots?: CimecBlockedSlotEntry[];
  adminSessionToken?: string;
  message?: string;
};

type CimecBlockedSlotEntry = BlockedSlotEntry & {
  source: "cimec-calendar";
  sourceLabel: string;
  timeRange: string;
};

type BlockSource = "manual" | "cimec";
type AdminModal = "edit" | "remove" | "block" | null;

type Participant = {
  key: string;
  name: string;
  email: string;
  bookings: BookingEntry[];
  sessionsCount: number;
  latestSessionDate: string;
};

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

const adminSessionStorageKey = "booking-meg-admin-session";
const calendarDayLabels = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
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

function getAdminSessionExpiry(token: string) {
  const [payload] = token.split(".");

  if (!payload) {
    return 0;
  }

  try {
    const normalizedPayload = payload
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const session = JSON.parse(atob(normalizedPayload)) as { exp?: unknown };

    return typeof session.exp === "number" && Number.isFinite(session.exp)
      ? session.exp * 1000
      : 0;
  } catch {
    return 0;
  }
}

function readStoredAdminSession() {
  try {
    const storedSession = window.localStorage.getItem(adminSessionStorageKey);

    if (!storedSession) {
      return "";
    }

    const session = JSON.parse(storedSession) as {
      token?: unknown;
      expiresAt?: unknown;
    };

    if (
      typeof session.token !== "string" ||
      typeof session.expiresAt !== "number" ||
      session.expiresAt <= Date.now()
    ) {
      window.localStorage.removeItem(adminSessionStorageKey);
      return "";
    }

    return session.token;
  } catch {
    window.localStorage.removeItem(adminSessionStorageKey);
    return "";
  }
}

function storeAdminSession(token: string) {
  const expiresAt = getAdminSessionExpiry(token);

  if (!token || expiresAt <= Date.now()) {
    window.localStorage.removeItem(adminSessionStorageKey);
    return;
  }

  window.localStorage.setItem(
    adminSessionStorageKey,
    JSON.stringify({ token, expiresAt }),
  );
}

function clearStoredAdminSession() {
  window.localStorage.removeItem(adminSessionStorageKey);
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
  const daysSinceThursday = (weekday - 4 + 7) % 7;
  weekStart.setDate(weekStart.getDate() - daysSinceThursday);
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

function formatEmailDate(date: string) {
  const parsedDate = parseLocalDate(date);

  if (!parsedDate) {
    return "";
  }

  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsedDate);
}

function formatEmailSlot(slot: string) {
  return slot.replace(" - ", "–");
}

function buildConfirmationEmail(booking: BookingEntry) {
  const study = getStudyConfig(getBookingTag(booking));
  const sessionLines = getSessionConfigs(study.tag).map((session) => {
    const selection = booking.selections[session.id];

    return `- ${session.title}: ${formatEmailDate(
      selection.date,
    )}, ${formatEmailSlot(selection.slot)}`;
  });

  return {
    subject: `Confirmation of ${study.title} Booking and Eligibility`,
    body: [
      booking.name ? `Dear ${booking.name},` : "Dear participant,",
      "",
      "I am writing to confirm your booking for the following dates and times:",
      "",
      ...sessionLines,
      "",
      "Could you please confirm that these dates and times work for you?",
      "",
      "Before we finalize your participation, could you also confirm that you meet all of the following eligibility criteria:",
      "",
      ...study.eligibilityCriteria.map((criterion) => `- ${criterion}`),
      "",
      "Thank you, and I look forward to your confirmation.",
      "",
      "Best regards,",
      "Dipesh Shrestha",
    ].join("\n"),
  };
}

function escapeCsvCell(value: string | undefined) {
  const stringValue = value ?? "";

  if (
    stringValue.includes(",") ||
    stringValue.includes("\"") ||
    stringValue.includes("\n") ||
    stringValue.includes("\r")
  ) {
    return `"${stringValue.replaceAll("\"", "\"\"")}"`;
  }

  return stringValue;
}

function getParticipantKey(booking: BookingEntry) {
  return booking.email.trim().toLowerCase();
}

function buildParticipants(bookings: BookingEntry[]) {
  const participantsByEmail = new Map<string, BookingEntry[]>();

  for (const booking of bookings) {
    const key = getParticipantKey(booking);
    const existingBookings = participantsByEmail.get(key) ?? [];
    participantsByEmail.set(key, [...existingBookings, booking]);
  }

  return Array.from(participantsByEmail.entries())
    .map(([key, participantBookings]) => {
      const bookingsByDate = participantBookings.toSorted(
        (firstBooking, secondBooking) =>
          firstBooking.firstSessionDate.localeCompare(secondBooking.firstSessionDate) ||
          getStudyConfig(getBookingTag(firstBooking)).title.localeCompare(
            getStudyConfig(getBookingTag(secondBooking)).title,
          ),
      );
      const displayBooking = bookingsByDate.find((booking) => booking.name) ??
        bookingsByDate[0];
      const sessions = participantBookings.flatMap((booking) =>
        getSessionConfigs(getBookingTag(booking)).map((session) => {
          return booking.selections[session.id];
        }),
      );

      return {
        key,
        name: displayBooking.name || "Unnamed participant",
        email: displayBooking.email,
        bookings: bookingsByDate,
        sessionsCount: sessions.length,
        latestSessionDate:
          sessions
            .map((session) => session?.date ?? "")
            .filter(Boolean)
            .toSorted()
            .at(-1) ?? "",
      } satisfies Participant;
    })
    .toSorted((firstParticipant, secondParticipant) =>
      firstParticipant.name.localeCompare(secondParticipant.name) ||
      firstParticipant.email.localeCompare(secondParticipant.email),
    );
}

function buildParticipantSessionsCsv(participants: Participant[]) {
  const header = [
    "participant_name",
    "email",
    "speaks_english",
    "weekend_sessions_accepted",
    "study",
    "booking_id",
    "session",
    "session_day",
    "session_date",
    "session_slot",
    "first_session_date",
    "booking_created_at",
    "booking_updated_at",
  ];
  const rows = participants.flatMap((participant) =>
    participant.bookings.flatMap((booking) => {
      const tag = getBookingTag(booking);
      const study = getStudyConfig(tag);

      return getSessionConfigs(tag).map((session) => {
        const selection = booking.selections[session.id];

        return [
          participant.name,
          participant.email,
          booking.speaksEnglish === true ? "yes" : "no",
          study.requiresWeekendSessions
            ? booking.weekendSessionsAccepted === true
              ? "yes"
              : "no"
            : "",
          study.title,
          booking.id,
          session.title,
          selection.day,
          selection.date,
          selection.slot,
          booking.firstSessionDate,
          booking.createdAt,
          booking.updatedAt ?? "",
        ];
      });
    }),
  );

  return [header, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n") + "\n";
}

export default function ViewBookingsPage() {
  const [pin, setPin] = useState("");
  const [adminSessionToken, setAdminSessionToken] = useState("");
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
  const [editingBooking, setEditingBooking] = useState<BookingEntry | null>(null);
  const [bookingToRemove, setBookingToRemove] = useState<BookingEntry | null>(
    null,
  );
  const [adminModal, setAdminModal] = useState<AdminModal>(null);
  const [editMode, setEditMode] = useState(false);
  const [hoverBlockMode, setHoverBlockMode] = useState(false);
  const [movingSessionId, setMovingSessionId] = useState<SessionId | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [studyFilter, setStudyFilter] = useState<StudyTag>("meg-study");
  const [selectedWeekDate, setSelectedWeekDate] = useState(getTodayIsoDate);
  const [selectedParticipantKey, setSelectedParticipantKey] = useState("");

  const generateConfirmationEmail = useCallback(async (booking: BookingEntry) => {
    const email = buildConfirmationEmail(booking);
    const mailto = `mailto:${encodeURIComponent(
      booking.email,
    )}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(
      email.body,
    )}`;

    try {
      await navigator.clipboard.writeText(email.body);
      setMessage(
        "Confirmation email copied and opened in your mail app. Paste the copied text if the body is not filled automatically.",
      );
    } catch {
      setMessage("Confirmation email opened in your mail app.");
    }

    window.location.href = mailto;
  }, []);

  const visibleBookings = useMemo(() => {
    return bookings.filter((booking) => getBookingTag(booking) === studyFilter);
  }, [bookings, studyFilter]);

  const participants = useMemo(
    () => buildParticipants(visibleBookings),
    [visibleBookings],
  );

  const selectedParticipant = useMemo(() => {
    return (
      participants.find(
        (participant) => participant.key === selectedParticipantKey,
      ) ??
      participants[0] ??
      null
    );
  }, [participants, selectedParticipantKey]);

  const totalBlockedSlots = blockedSlots.length + cimecBlockedSlots.length;

  useEffect(() => {
    if (participants.length === 0) {
      setSelectedParticipantKey("");
      return;
    }

    if (
      !selectedParticipantKey ||
      !participants.some(
        (participant) => participant.key === selectedParticipantKey,
      )
    ) {
      setSelectedParticipantKey(participants[0].key);
    }
  }, [participants, selectedParticipantKey]);

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
        const matchesStudy = tag === studyFilter;
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

        return getSessionConfigs(tag).map((session) => {
          const selection = booking.selections[session.id];

          return {
            id: `${booking.id}-${session.id}`,
            date: selection.date,
            slot: selection.slot,
            title: booking.name || booking.email,
            subtitle: booking.name
              ? `${booking.email} - ${study.title} - ${session.title}`
              : `${study.title} - ${session.title}`,
            note: `${selection.day}, ${formatDisplayDate(selection.date)}`,
            timeLabel: selection.slot,
            variant: "booking",
            actions: (
              <>
                <button
                  type="button"
                  onClick={() => openEditBooking(booking, session.id)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => generateConfirmationEmail(booking)}
                >
                  Generate email
                </button>
                <button
                  type="button"
                  onClick={() => openRemoveBooking(booking)}
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
  }, [
    generateConfirmationEmail,
    isLoading,
    openEditBooking,
    openRemoveBooking,
    selectedWeekDate,
    visibleBookings,
  ]);

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

  const occupiedCalendarSlots = useMemo(() => {
    const slots = new Set<string>();

    for (const event of calendarEvents) {
      slots.add(`${event.date}|${event.slot}`);
    }

    return slots;
  }, [calendarEvents]);

  useEffect(() => {
    setBlockStudy(studyFilter);
    setBlockSlot(getSlotOptions(studyFilter)[0]);
    setEditingBooking(null);
    setBookingToRemove(null);
    setMovingSessionId(null);
    setAdminModal(null);
  }, [studyFilter]);

  async function requestAdminBookings(
    method: "GET" | "POST" | "PUT" | "DELETE",
    body?: object,
    sessionToken = adminSessionToken,
  ) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (sessionToken) {
      headers["x-admin-session-token"] = sessionToken;
    } else {
      headers["x-admin-pin"] = pin;
    }

    const response = await fetch("/api/admin/bookings", {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await parseJsonResponse<AdminResponse>(response);

    if (!response.ok) {
      if (response.status === 401 && sessionToken) {
        clearStoredAdminSession();
        setAdminSessionToken("");
        setAuthenticated(false);
      }

      throw new Error(data.message ?? "Request failed.");
    }

    return data;
  }

  useEffect(() => {
    const storedToken = readStoredAdminSession();

    if (!storedToken) {
      return;
    }

    let cancelled = false;

    async function restoreAdminSession() {
      setIsLoading(true);
      setMessage("");

      try {
        const data = await requestAdminBookings("GET", undefined, storedToken);

        if (cancelled) {
          return;
        }

        setBookings(data.bookings ?? []);
        setBlockedSlots(data.blockedSlots ?? []);
        setCimecBlockedSlots(data.cimecBlockedSlots ?? []);
        setAdminSessionToken(storedToken);
        setAuthenticated(true);
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error ? error.message : "Could not restore login.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    restoreAdminSession();

    return () => {
      cancelled = true;
    };
  }, []);

  async function unlockBookings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setMessage("");

    try {
      const data = await requestAdminBookings("GET");
      setBookings(data.bookings ?? []);
      setBlockedSlots(data.blockedSlots ?? []);
      setCimecBlockedSlots(data.cimecBlockedSlots ?? []);
      const nextSessionToken = data.adminSessionToken ?? "";

      if (nextSessionToken) {
        storeAdminSession(nextSessionToken);
      }

      setAdminSessionToken(nextSessionToken);
      setPin("");
      setAuthenticated(true);
    } catch (error) {
      setAuthenticated(false);
      setAdminSessionToken("");
      clearStoredAdminSession();
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

    const tag = getBookingTag(editingBooking);
    const study = getStudyConfig(tag);

    if (study.dateSelectionMode === "per-session") {
      updateEditingBooking({
        ...editingBooking,
        firstSessionDate,
        selections: {
          ...editingBooking.selections,
          session1: {
            ...editingBooking.selections.session1,
            day: getDayForDate(firstSessionDate),
            date: firstSessionDate,
          },
        },
      });
      return;
    }

    updateEditingBooking({
      ...editingBooking,
      firstSessionDate,
      selections: buildSelectionsForStartDate(
        firstSessionDate,
        editingBooking.selections,
        tag,
      ),
    });
  }

  function openEditBooking(booking: BookingEntry, sessionId?: SessionId) {
    setEditingBooking(booking);
    setMovingSessionId(sessionId ?? null);
    setAdminModal("edit");
  }

  function openRemoveBooking(booking: BookingEntry) {
    setBookingToRemove(booking);
    setAdminModal("remove");
  }

  function openBlockSlot(date?: string, slot?: string) {
    setBlockStudy(studyFilter);

    if (date) {
      setBlockDate(date);
    }

    if (slot) {
      setBlockSlot(slot);
    } else {
      setBlockSlot(getSlotOptions(studyFilter)[0]);
    }

    setAdminModal("block");
  }

  function closeAdminModal() {
    setAdminModal(null);
    setMovingSessionId(null);
  }

  function moveEditingSession(date: string, slot: string) {
    if (!editingBooking || !movingSessionId) {
      return;
    }

    const editingTag = getBookingTag(editingBooking);
    const movingSelection = editingBooking.selections[movingSessionId];

    if (
      getStudyConfig(editingTag).dateSelectionMode !== "per-session" &&
      date !== movingSelection.date
    ) {
      setMessage(
        "This experiment has fixed session dates. Use the first-session date field to change the schedule.",
      );
      return;
    }

    const nextSlotKey = `${date}|${slot}`;
    const currentSlotKey = `${movingSelection.date}|${movingSelection.slot}`;

    if (
      nextSlotKey !== currentSlotKey &&
      occupiedCalendarSlots.has(nextSlotKey)
    ) {
      setMessage("That slot is already occupied or blocked for this experiment.");
      return;
    }

    updateEditingBooking({
      ...editingBooking,
      firstSessionDate:
        movingSessionId === "session1" ? date : editingBooking.firstSessionDate,
      selections: {
        ...editingBooking.selections,
        [movingSessionId]: {
          day: getDayForDate(date),
          date,
          slot,
        },
      },
    });
    setEditMode(false);
    setMovingSessionId(null);
    setAdminModal("edit");
    setMessage(`${movingSessionId.replace("session", "Session ")} moved. Save changes to confirm.`);
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
      setMovingSessionId(null);
      setAdminModal(null);
      setMessage(data.message ?? "Booking updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update.");
    } finally {
      setIsLoading(false);
    }
  }

  async function removeBooking(id: string) {
    setIsLoading(true);
    setMessage("");

    try {
      const data = await requestAdminBookings("DELETE", { id });
      setBookings(data.bookings ?? []);
      setBlockedSlots(data.blockedSlots ?? []);
      setCimecBlockedSlots(data.cimecBlockedSlots ?? []);
      setEditingBooking((current) => (current?.id === id ? null : current));
      setBookingToRemove(null);
      setAdminModal(null);
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
      setAdminModal(null);
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

  function downloadParticipantSessionsCsv() {
    const csv = buildParticipantSessionsCsv(participants);
    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "participant-sessions.csv";
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
                  const slotOptionsForStudy = getSlotOptions(studyFilter);

                  return (
                    <div className="week-calendar-day" key={date}>
                      {slotOptionsForStudy.map((slot) => {
                        const slotKey = `${date}|${slot}`;
                        const isOccupied = occupiedCalendarSlots.has(slotKey);

                        if (isOccupied) {
                          return null;
                        }

                        return (
                          <button
                            type="button"
                            className="calendar-slot-target"
                            data-blocking={hoverBlockMode}
                            data-editing={Boolean(editMode && movingSessionId)}
                            key={slot}
                            style={getCalendarEventStyle(slot, 0)}
                            onClick={() => {
                              if (editMode && movingSessionId && editingBooking) {
                                moveEditingSession(date, slot);
                                return;
                              }

                              if (hoverBlockMode) {
                                openBlockSlot(date, slot);
                              }
                            }}
                            disabled={
                              (!hoverBlockMode &&
                                !(editMode && movingSessionId && editingBooking)) ||
                              isLoading
                            }
                            aria-label={`Use ${formatDisplayDate(date)} at ${slot}`}
                          >
                            {hoverBlockMode ? "Block" : "Move here"}
                          </button>
                        );
                      })}
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
          <form className="admin-auth-form" onSubmit={unlockBookings}>
            <label>
              <span>6-digit PIN</span>
              <input
                type="text"
                value={pin}
                onChange={(event) =>
                  setPin(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
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
            <div
              className="bookings-controls admin-primary-controls"
              aria-label="Admin filters"
            >
              <label>
                <span>Experiment</span>
                <select
                  value={studyFilter}
                  onChange={(event) =>
                    setStudyFilter(event.target.value as StudyTag)
                  }
                >
                  <option value="meg-study">MEG experiment</option>
                  <option value="sensorimotor-study">
                    Sensorimotor study
                  </option>
                  <option value="eye-track-monpath">
                    MonPath
                  </option>
                  <option value="semantic-foraging">
                    Semantic foraging
                  </option>
                </select>
              </label>
              <div className="admin-mode-actions">
                <button
                  type="button"
                  className={editMode ? "admin-mode-button-active" : ""}
                  onClick={() => {
                    setEditMode((current) => !current);
                    setHoverBlockMode(false);
                  }}
                >
                  Edit mode
                </button>
                <button
                  type="button"
                  className={hoverBlockMode ? "admin-mode-button-active" : ""}
                  onClick={() => {
                    setHoverBlockMode((current) => !current);
                    setEditMode(false);
                    setMovingSessionId(null);
                  }}
                >
                  Hover block
                </button>
                <button type="button" onClick={() => openBlockSlot()}>
                  Block slot
                </button>
              </div>
            </div>

            <section
              className="participants-panel"
              aria-labelledby="admin-participants-title"
            >
              <div className="admin-section-header">
                <div>
                  <p className="eyebrow">Participants</p>
                  <h2 id="admin-participants-title">Participant Sessions</h2>
                </div>
                <button
                  className="calendar-download-button"
                  type="button"
                  onClick={downloadParticipantSessionsCsv}
                  disabled={participants.length === 0}
                >
                  Download CSV
                </button>
              </div>

              {participants.length > 0 ? (
                <div className="participants-layout">
                  <div className="participants-list" aria-label="Participants">
                    {participants.map((participant) => (
                      <button
                        type="button"
                        key={participant.key}
                        className="participant-list-item"
                        data-selected={
                          participant.key === selectedParticipant?.key
                        }
                        onClick={() =>
                          setSelectedParticipantKey(participant.key)
                        }
                      >
                        <span>
                          <strong>{participant.name}</strong>
                          <small>{participant.email}</small>
                        </span>
                        <em>
                          {participant.sessionsCount} sessions
                          {participant.latestSessionDate
                            ? `, latest ${formatDisplayDate(participant.latestSessionDate)}`
                            : ""}
                        </em>
                      </button>
                    ))}
                  </div>

                  <div
                    className="participant-session-detail"
                    aria-live="polite"
                  >
                    {selectedParticipant ? (
                      <>
                        <div className="participant-detail-header">
                          <div>
                            <span>Selected participant</span>
                            <h3>{selectedParticipant.name}</h3>
                            <p>{selectedParticipant.email}</p>
                          </div>
                          <strong>
                            {selectedParticipant.bookings.length} bookings,{" "}
                            {selectedParticipant.sessionsCount} sessions
                          </strong>
                        </div>

                        <div className="participant-booking-stack">
                          {selectedParticipant.bookings.map((booking) => {
                            const tag = getBookingTag(booking);
                            const study = getStudyConfig(tag);

                            return (
                              <article
                                className="participant-booking-card"
                                key={booking.id}
                              >
                                <div className="participant-booking-header">
                                  <div>
                                    <span>{study.title}</span>
                                    <strong>
                                      First session{" "}
                                      {formatDisplayDate(
                                        booking.firstSessionDate,
                                      )}
                                    </strong>
                                    <p>
                                      Speaks English:{" "}
                                      {booking.speaksEnglish === true
                                        ? "Yes"
                                        : "No"}
                                    </p>
                                    {study.requiresWeekendSessions ? (
                                      <p>
                                        Weekend sessions agreed:{" "}
                                        {booking.weekendSessionsAccepted === true
                                          ? "Yes"
                                          : "No"}
                                      </p>
                                    ) : null}
                                  </div>
                                  <div className="admin-actions">
                                    <button
                                      type="button"
                                      onClick={() => openEditBooking(booking)}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        generateConfirmationEmail(booking)
                                      }
                                    >
                                      Generate email
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openRemoveBooking(booking)}
                                      disabled={isLoading}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>

                                <div className="participant-session-grid">
                                  {getSessionConfigs(tag).map((session) => {
                                    const selection =
                                      booking.selections[session.id];

                                    return (
                                      <div
                                        className="participant-session-row"
                                        key={session.id}
                                      >
                                        <span>{session.title}</span>
                                        <strong>
                                          {formatDisplayDate(selection.date)}
                                        </strong>
                                        <em>{selection.day}</em>
                                        <small>{selection.slot}</small>
                                      </div>
                                    );
                                  })}
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <p className="empty-bookings">
                        Select a participant to view sessions.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="empty-bookings">
                  No participants have been saved yet.
                </p>
              )}
            </section>

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

              <p className="admin-mode-hint">
                {editMode
                  ? movingSessionId
                    ? "Edit mode active. Choose an empty slot to move the selected session; occupied and blocked slots are protected."
                    : "Edit mode active. Open a booking and choose a session to move."
                  : hoverBlockMode
                    ? "Hover block active. Empty slots are highlighted and open the block modal."
                    : "Choose an experiment, then edit bookings or block availability from the focused modal flows."}
              </p>

              {renderWeekCalendar(
                calendarEvents,
                "No calendar items match the selected filters.",
              )}
            </section>

            {adminModal === "edit" && editingBooking ? (
              <div className="admin-modal-backdrop" role="presentation">
                <section
                  className="admin-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="admin-edit-title"
                >
                  <div className="admin-modal-header">
                    <div>
                      <span>
                        {getStudyConfig(getBookingTag(editingBooking)).title}
                      </span>
                      <h3 id="admin-edit-title">
                        Edit {editingBooking.name || editingBooking.email}
                      </h3>
                    </div>
                    <button type="button" onClick={closeAdminModal}>
                      Close
                    </button>
                  </div>
                  <div className="booking-edit-grid admin-modal-body">
                    <label>
                      <span>Name</span>
                      <input
                        className="admin-table-input"
                        type="text"
                        value={editingBooking.name ?? ""}
                        onChange={(event) =>
                          updateEditingBooking({
                            ...editingBooking,
                            name: event.target.value,
                          })
                        }
                      />
                    </label>
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
                    <label className="admin-checkbox-field">
                      <input
                        type="checkbox"
                        checked={editingBooking.speaksEnglish === true}
                        onChange={(event) =>
                          updateEditingBooking({
                            ...editingBooking,
                            speaksEnglish: event.target.checked,
                          })
                        }
                      />
                      <span>Speaks English</span>
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
                          note={`Select a Thursday between ${formatDisplayDate(getEarliestBookingDate())} and ${formatDisplayDate(getLatestMegFirstSessionDate())}.`}
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
                    {getSessionConfigs(getBookingTag(editingBooking)).map(
                      (session) => {
                        const rowSlotOptions = getSlotOptions(
                          getBookingTag(editingBooking),
                        );
                        const selection = editingBooking.selections[session.id];

                        return (
                          <div className="admin-session-edit-row" key={session.id}>
                            <div>
                              <strong>{session.title}</strong>
                              <span>
                                {formatDisplayDate(selection.date)},{" "}
                                {selection.slot}
                              </span>
                            </div>
                            <select
                              className="admin-table-input"
                              value={selection.slot}
                              onChange={(event) =>
                                updateEditingBooking({
                                  ...editingBooking,
                                  selections: {
                                    ...editingBooking.selections,
                                    [session.id]: {
                                      ...selection,
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
                            <button
                              type="button"
                              className={
                                movingSessionId === session.id
                                  ? "admin-mode-button-active"
                                  : ""
                              }
                              onClick={() => {
                                setEditMode(true);
                                setHoverBlockMode(false);
                                setMovingSessionId(session.id);
                                setAdminModal(null);
                              }}
                            >
                              Move on calendar
                            </button>
                          </div>
                        );
                      },
                    )}
                    <p className="admin-rule-note">
                      No overlapping slots are allowed inside{" "}
                      {getStudyConfig(getBookingTag(editingBooking)).title}.
                      Occupied, manually blocked, and CIMeC busy slots are not
                      valid move targets. Server validation is still final.
                    </p>
                  </div>
                  <div className="admin-modal-footer">
                    <button
                      type="button"
                      onClick={saveBooking}
                      disabled={isLoading}
                    >
                      Save changes
                    </button>
                    <button
                      type="button"
                      onClick={() => generateConfirmationEmail(editingBooking)}
                    >
                      Generate email
                    </button>
                    <button type="button" onClick={closeAdminModal}>
                      Cancel
                    </button>
                  </div>
                </section>
              </div>
            ) : null}

            {adminModal === "remove" && bookingToRemove ? (
              <div className="admin-modal-backdrop" role="presentation">
                <section
                  className="admin-modal admin-modal-narrow"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="admin-remove-title"
                >
                  <div className="admin-modal-header">
                    <div>
                      <span>
                        {getStudyConfig(getBookingTag(bookingToRemove)).title}
                      </span>
                      <h3 id="admin-remove-title">Remove booking?</h3>
                    </div>
                    <button type="button" onClick={closeAdminModal}>
                      Close
                    </button>
                  </div>
                  <div className="admin-modal-body">
                    <p className="admin-danger-note">
                      This removes {bookingToRemove.name || bookingToRemove.email}{" "}
                      and all sessions for this experiment.
                    </p>
                    <div className="participant-session-grid">
                      {getSessionConfigs(getBookingTag(bookingToRemove)).map(
                        (session) => {
                          const selection = bookingToRemove.selections[session.id];

                          return (
                            <div
                              className="participant-session-row"
                              key={session.id}
                            >
                              <span>{session.title}</span>
                              <strong>{formatDisplayDate(selection.date)}</strong>
                              <em>{selection.day}</em>
                              <small>{selection.slot}</small>
                            </div>
                          );
                        },
                      )}
                    </div>
                  </div>
                  <div className="admin-modal-footer">
                    <button
                      type="button"
                      onClick={() => removeBooking(bookingToRemove.id)}
                      disabled={isLoading}
                    >
                      Remove booking
                    </button>
                    <button type="button" onClick={closeAdminModal}>
                      Cancel
                    </button>
                  </div>
                </section>
              </div>
            ) : null}

            {adminModal === "block" ? (
              <div className="admin-modal-backdrop" role="presentation">
                <form
                  className="admin-modal admin-modal-narrow"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="admin-block-title"
                  onSubmit={addBlockedSlot}
                >
                  <div className="admin-modal-header">
                    <div>
                      <span>{getStudyConfig(studyFilter).title}</span>
                      <h3 id="admin-block-title">Block slot</h3>
                    </div>
                    <button type="button" onClick={closeAdminModal}>
                      Close
                    </button>
                  </div>
                  <div className="admin-modal-body">
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
                    <p className="admin-rule-note">
                      Blocks apply only to the selected experiment and cannot be
                      placed on an existing booking.
                    </p>
                  </div>
                  <div className="admin-modal-footer">
                    <button type="submit" disabled={isLoading}>
                      Block slot
                    </button>
                    <button type="button" onClick={closeAdminModal}>
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
