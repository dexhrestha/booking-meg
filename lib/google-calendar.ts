import { createHash } from "crypto";
import {
  BookingEntry,
  formatDisplayDate,
  getBookingTag,
  getSessionConfigs,
  getSlotOptions,
  getStudyConfig,
  MinuteRange,
  parseSlotRange,
  rangesOverlap,
  sessionConfigs,
  slotKey,
  StudyTag,
} from "@/lib/booking";

const calendarApiBase = "https://www.googleapis.com/calendar/v3";
const calendarTimeZone = "Europe/Rome";
// Google event IDs must use base32hex characters (a-v, 0-9). Every event this
// app creates starts with this prefix so busy-time checks can skip them.
const bookingEventIdPrefix = "bm";
const busyCacheTtlMs = 60_000;

type GoogleEventDateTime = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

type GoogleEvent = {
  id?: string;
  status?: string;
  transparency?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  attendees?: { self?: boolean; responseStatus?: string }[];
};

type BusyRange = {
  startDate: string;
  startMinutes: number;
  endDate: string;
  endMinutes: number;
};

let cachedAccessToken: { token: string; expiresAt: number } | null = null;
const busyCache = new Map<string, { ranges: BusyRange[]; expiresAt: number }>();

function getGoogleConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN ?? "",
    bookingCalendarId: process.env.GOOGLE_BOOKING_CALENDAR_ID ?? "",
    busyCalendarIds: (process.env.GOOGLE_BUSY_CALENDAR_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function hasGoogleCredentials() {
  const config = getGoogleConfig();

  return Boolean(config.clientId && config.clientSecret && config.refreshToken);
}

export function isGoogleBookingSyncEnabled() {
  return hasGoogleCredentials() && Boolean(getGoogleConfig().bookingCalendarId);
}

export function isGoogleBusyBlockingEnabled() {
  return hasGoogleCredentials() && getGoogleConfig().busyCalendarIds.length > 0;
}

async function getAccessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const config = getGoogleConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Google token refresh failed (${response.status}): ${await response.text()}`,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

async function calendarRequest(
  method: string,
  pathname: string,
  options: { query?: Record<string, string>; body?: unknown } = {},
) {
  const url = new URL(`${calendarApiBase}${pathname}`);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
}

async function assertOk(response: Response, action: string) {
  if (!response.ok) {
    throw new Error(
      `Google Calendar ${action} failed (${response.status}): ${await response.text()}`,
    );
  }
}

function getBookingEventId(bookingId: string, sessionId: string) {
  const hash = createHash("sha256")
    .update(`${bookingId}:${sessionId}`)
    .digest("hex");

  return `${bookingEventIdPrefix}${hash.slice(0, 40)}`;
}

function calendarPath(calendarId: string) {
  return `/calendars/${encodeURIComponent(calendarId)}/events`;
}

function buildSessionEvent(
  booking: BookingEntry,
  session: { id: string; title: string },
) {
  const tag = getBookingTag(booking);
  const study = getStudyConfig(tag);
  const selection = booking.selections[session.id as keyof typeof booking.selections];
  const [start, end] = selection.slot.split(" - ").map((value) => value.trim());
  const participant = booking.name || booking.email;

  return {
    id: getBookingEventId(booking.id, session.id),
    status: "confirmed",
    summary: `${study.title}: ${session.title} - ${participant}`,
    description: [
      `Experiment: ${study.title}`,
      `Session: ${session.title}`,
      `Date: ${formatDisplayDate(selection.date)} (${selection.day})`,
      `Time: ${selection.slot}`,
      booking.name ? `Participant: ${booking.name}` : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
    start: {
      dateTime: `${selection.date}T${start}:00`,
      timeZone: calendarTimeZone,
    },
    end: {
      dateTime: `${selection.date}T${end}:00`,
      timeZone: calendarTimeZone,
    },
    attendees: [
      {
        email: booking.email,
        ...(booking.name ? { displayName: booking.name } : {}),
      },
    ],
    guestsCanInviteOthers: false,
    guestsCanSeeOtherGuests: false,
  };
}

async function upsertSessionEvent(
  booking: BookingEntry,
  session: { id: string; title: string },
) {
  const calendarId = getGoogleConfig().bookingCalendarId;
  const event = buildSessionEvent(booking, session);
  const query = { sendUpdates: "all" };
  // Updating also restores a previously cancelled event with the same ID,
  // which Google would otherwise reject on insert.
  const updateResponse = await calendarRequest(
    "PUT",
    `${calendarPath(calendarId)}/${event.id}`,
    { query, body: event },
  );

  if (updateResponse.status !== 404) {
    await assertOk(updateResponse, "event update");
    return;
  }

  const insertResponse = await calendarRequest("POST", calendarPath(calendarId), {
    query,
    body: event,
  });

  await assertOk(insertResponse, "event insert");
}

async function deleteSessionEvent(bookingId: string, sessionId: string) {
  const calendarId = getGoogleConfig().bookingCalendarId;
  const response = await calendarRequest(
    "DELETE",
    `${calendarPath(calendarId)}/${getBookingEventId(bookingId, sessionId)}`,
    { query: { sendUpdates: "all" } },
  );

  if (response.status === 404 || response.status === 410) {
    return;
  }

  await assertOk(response, "event delete");
}

function isSameSessionEvent(
  previous: BookingEntry,
  next: BookingEntry,
  sessionId: keyof BookingEntry["selections"],
) {
  const previousSelection = previous.selections?.[sessionId];
  const nextSelection = next.selections[sessionId];

  return (
    getBookingTag(previous) === getBookingTag(next) &&
    previous.email.toLowerCase() === next.email.toLowerCase() &&
    (previous.name ?? "") === (next.name ?? "") &&
    previousSelection?.date === nextSelection.date &&
    previousSelection?.slot === nextSelection.slot
  );
}

/**
 * Mirrors a booking change to the Google booking calendar and emails the
 * participant through Google Calendar invites. Pass `previous` as null for a
 * new booking and `next` as null for a removed booking. Only sessions that
 * changed are touched, so participants are not re-notified for unchanged ones.
 */
export async function syncBookingToGoogleCalendar(
  previous: BookingEntry | null,
  next: BookingEntry | null,
) {
  if (!isGoogleBookingSyncEnabled()) {
    return;
  }

  const bookingId = next?.id ?? previous?.id;

  if (!bookingId) {
    return;
  }

  const nextSessions = next ? getSessionConfigs(getBookingTag(next)) : [];
  const nextSessionIds = new Set(nextSessions.map((session) => session.id));
  const tasks: Promise<void>[] = [];

  for (const session of nextSessions) {
    if (previous && next && isSameSessionEvent(previous, next, session.id)) {
      continue;
    }

    tasks.push(upsertSessionEvent(next!, session));
  }

  for (const session of sessionConfigs) {
    if (!nextSessionIds.has(session.id)) {
      tasks.push(deleteSessionEvent(bookingId, session.id));
    }
  }

  const results = await Promise.allSettled(tasks);

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Google Calendar booking sync failed:", result.reason);
    }
  }
}

function parseGoogleDateTime(value: GoogleEventDateTime) {
  if (value.dateTime) {
    // Events are requested in Europe/Rome, so the local date and time can be
    // read directly from the RFC 3339 string.
    const match = value.dateTime.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);

    if (!match) {
      return null;
    }

    return {
      date: match[1],
      minutes: Number(match[2]) * 60 + Number(match[3]),
    };
  }

  if (value.date) {
    // All-day end dates are exclusive, so midnight of that day is correct.
    return { date: value.date, minutes: 0 };
  }

  return null;
}

function isBlockingEvent(event: GoogleEvent) {
  if (event.status === "cancelled" || event.transparency === "transparent") {
    return false;
  }

  if (event.id?.startsWith(bookingEventIdPrefix)) {
    return false;
  }

  const self = event.attendees?.find((attendee) => attendee.self);

  return self?.responseStatus !== "declined";
}

async function listBusyRanges(
  calendarId: string,
  startDate: string,
  endDate: string,
) {
  const ranges: BusyRange[] = [];
  let pageToken = "";

  do {
    const response = await calendarRequest("GET", calendarPath(calendarId), {
      query: {
        // Pad by a day on each side; the exact window is filtered per date.
        timeMin: `${shiftIsoDate(startDate, -1)}T00:00:00Z`,
        timeMax: `${shiftIsoDate(endDate, 2)}T00:00:00Z`,
        singleEvents: "true",
        timeZone: calendarTimeZone,
        maxResults: "2500",
        fields: "items(id,status,transparency,start,end,attendees(self,responseStatus)),nextPageToken",
        ...(pageToken ? { pageToken } : {}),
      },
    });

    await assertOk(response, "event list");

    const data = (await response.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
    };

    for (const event of data.items ?? []) {
      if (!isBlockingEvent(event) || !event.start || !event.end) {
        continue;
      }

      const start = parseGoogleDateTime(event.start);
      const end = parseGoogleDateTime(event.end);

      if (start && end) {
        ranges.push({
          startDate: start.date,
          startMinutes: start.minutes,
          endDate: end.date,
          endMinutes: end.minutes,
        });
      }
    }

    pageToken = data.nextPageToken ?? "";
  } while (pageToken);

  return ranges;
}

function shiftIsoDate(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  return shifted.toISOString().slice(0, 10);
}

function getRangeOnDate(range: BusyRange, date: string): MinuteRange | null {
  if (range.startDate > date || range.endDate < date) {
    return null;
  }

  const startMinutes = range.startDate < date ? 0 : range.startMinutes;
  const endMinutes = range.endDate > date ? 24 * 60 : range.endMinutes;

  return endMinutes > startMinutes ? { startMinutes, endMinutes } : null;
}

async function getBusyRanges(startDate: string, endDate: string) {
  const cacheKey = `${startDate}:${endDate}`;
  const cached = busyCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.ranges;
  }

  const results = await Promise.all(
    getGoogleConfig().busyCalendarIds.map((calendarId) =>
      listBusyRanges(calendarId, startDate, endDate),
    ),
  );
  const ranges = results.flat();

  busyCache.set(cacheKey, { ranges, expiresAt: Date.now() + busyCacheTtlMs });

  return ranges;
}

/**
 * Slot keys for `tag` on the given dates that overlap a busy event in the
 * researcher's Google calendars. Returns no keys if Google is unreachable so
 * booking keeps working.
 */
export async function getGoogleBusySlotKeys(tag: StudyTag, dates: string[]) {
  const validDates = dates.filter(Boolean).toSorted();

  if (!isGoogleBusyBlockingEnabled() || validDates.length === 0) {
    return [];
  }

  try {
    const ranges = await getBusyRanges(
      validDates[0],
      validDates[validDates.length - 1],
    );
    const occupied = new Set<string>();

    for (const date of validDates) {
      for (const slot of getSlotOptions(tag)) {
        const slotRange = parseSlotRange(slot);

        if (!slotRange) {
          continue;
        }

        if (
          ranges.some((range) => {
            const busyRange = getRangeOnDate(range, date);

            return busyRange && rangesOverlap(busyRange, slotRange);
          })
        ) {
          occupied.add(slotKey(date, slot));
        }
      }
    }

    return [...occupied];
  } catch (error) {
    console.error("Google Calendar busy lookup failed:", error);
    return [];
  }
}
