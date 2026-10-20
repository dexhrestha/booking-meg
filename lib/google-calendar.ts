import { createHash } from "crypto";
import {
  BookingEntry,
  formatDisplayDate,
  getBookingTag,
  getSessionConfigs,
  getSlotOptionsForDate,
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

type GoogleCalendarRule = {
  calendarId: string;
  // Days of the week (0 = Sunday) this calendar covers. A rule without
  // weekdays covers every day not claimed by another rule for the study.
  weekdays?: number[];
};

type StudyGoogleCalendarConfig = {
  // Environment variable holding the refresh token of the Google account that
  // owns these calendars. That account is the organizer of every invite, and
  // the participant is the only guest.
  refreshTokenEnv: string;
  calendars: GoogleCalendarRule[];
  location?: string;
};

// A calendar together with the account used to access it.
type CalendarTarget = {
  calendarId: string;
  refreshToken: string;
};

const cimecLocation = "https://share.google/UxmSrofWUn4Taz2LV";

// Per-study calendars. Bookings for a session are written to the calendar
// matching its date, and other events in that calendar block the same slots.
// Studies without an entry fall back to GOOGLE_BOOKING_CALENDAR_ID.
const studyGoogleCalendars: Partial<Record<StudyTag, StudyGoogleCalendarConfig>> = {
  "meg-study": {
    // dipesh.shrestha@unitn.it
    refreshTokenEnv: "GOOGLE_REFRESH_TOKEN",
    calendars: [
      {
        // MentalSim MEG calendar
        calendarId:
          "c_d6683293d4743a241373794136c47a86c726bfb9c204c35f2b12d036d80393f9@group.calendar.google.com",
        weekdays: [2],
      },
      {
        // MentalSim Behavior Calendar
        calendarId:
          "c_920baad4039a5e71dd2312b8d75a3a4871cfc4cde8522807515da94f8e16ac13@group.calendar.google.com",
      },
    ],
    location: cimecLocation,
  },
  "eye-track-monpath": {
    // Riccardo Romano's account
    refreshTokenEnv: "GOOGLE_REFRESH_TOKEN_MONPATH",
    calendars: [
      {
        calendarId:
          "c_2336518c49fef98f03b6161b6bc69bb9eded03532f575e85ae673d00e0c5601f@group.calendar.google.com",
      },
    ],
    location: cimecLocation,
  },
};

const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();
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

function hasGoogleClient() {
  const config = getGoogleConfig();

  return Boolean(config.clientId && config.clientSecret);
}

function getDefaultRefreshToken() {
  return hasGoogleClient() ? getGoogleConfig().refreshToken : "";
}

/**
 * The study's calendar settings and account token, or null if the study has
 * no Google calendars or its account has not been authorized yet.
 */
function getStudyGoogleCalendar(tag: StudyTag) {
  const config = studyGoogleCalendars[tag];
  const refreshToken = config ? (process.env[config.refreshTokenEnv] ?? "") : "";

  return config && hasGoogleClient() && refreshToken
    ? { ...config, refreshToken }
    : null;
}

/**
 * Studies with Google calendars manage blocked time there, so manual admin
 * blocks are ignored for them.
 */
export function studyUsesGoogleCalendars(tag: StudyTag) {
  return Boolean(getStudyGoogleCalendar(tag));
}

function getDateWeekday(date: string) {
  const [year, month, day] = date.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function getStudyCalendarTarget(tag: StudyTag, date: string) {
  const config = getStudyGoogleCalendar(tag);

  if (!config) {
    return null;
  }

  const weekday = getDateWeekday(date);
  const rule =
    config.calendars.find((item) => item.weekdays?.includes(weekday)) ??
    config.calendars.find((item) => !item.weekdays);

  return rule
    ? ({
        calendarId: rule.calendarId,
        refreshToken: config.refreshToken,
      } satisfies CalendarTarget)
    : null;
}

function getBookingCalendarTarget(tag: StudyTag, date: string) {
  // A study with its own calendars never falls back to the shared calendar,
  // so its invites are only ever sent from its own account.
  if (studyGoogleCalendars[tag]) {
    return getStudyCalendarTarget(tag, date);
  }

  const calendarId = getGoogleConfig().bookingCalendarId;
  const refreshToken = getDefaultRefreshToken();

  return calendarId && refreshToken
    ? ({ calendarId, refreshToken } satisfies CalendarTarget)
    : null;
}

function getBusyCalendarTargets(tag: StudyTag, date: string) {
  const refreshToken = getDefaultRefreshToken();
  const targets: CalendarTarget[] = refreshToken
    ? getGoogleConfig().busyCalendarIds.map((calendarId) => ({
        calendarId,
        refreshToken,
      }))
    : [];
  const studyTarget = getStudyCalendarTarget(tag, date);

  if (
    studyTarget &&
    !targets.some((target) => target.calendarId === studyTarget.calendarId)
  ) {
    targets.push(studyTarget);
  }

  return targets;
}

async function getAccessToken(refreshToken: string) {
  const cached = accessTokenCache.get(refreshToken);

  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const config = getGoogleConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
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

  accessTokenCache.set(refreshToken, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });

  return data.access_token;
}

async function calendarRequest(
  refreshToken: string,
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
      Authorization: `Bearer ${await getAccessToken(refreshToken)}`,
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
  const location = studyGoogleCalendars[tag]?.location;

  return {
    id: getBookingEventId(booking.id, session.id),
    status: "confirmed",
    summary: `${study.title}, ${session.title}: ${participant}`,
    ...(location ? { location } : {}),
    description: [
      `${study.title}, ${session.title}`,
      `Date: ${formatDisplayDate(selection.date)}`,
      `Time: ${selection.slot}`,
      "",
      "Eligibility criteria:",
      ...study.eligibilityCriteria.map((criterion) => `- ${criterion}`),
    ].join("\n"),
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
  { calendarId, refreshToken }: CalendarTarget,
  booking: BookingEntry,
  session: { id: string; title: string },
) {
  const event = buildSessionEvent(booking, session);
  const query = { sendUpdates: "all" };
  // Updating also restores a previously cancelled event with the same ID,
  // which Google would otherwise reject on insert.
  const updateResponse = await calendarRequest(
    refreshToken,
    "PUT",
    `${calendarPath(calendarId)}/${event.id}`,
    { query, body: event },
  );

  if (updateResponse.status !== 404) {
    await assertOk(updateResponse, "event update");
    return;
  }

  const insertResponse = await calendarRequest(
    refreshToken,
    "POST",
    calendarPath(calendarId),
    { query, body: event },
  );

  await assertOk(insertResponse, "event insert");
}

async function moveSessionEvent(
  from: CalendarTarget,
  toCalendarId: string,
  bookingId: string,
  sessionId: string,
) {
  const response = await calendarRequest(
    from.refreshToken,
    "POST",
    `${calendarPath(from.calendarId)}/${getBookingEventId(bookingId, sessionId)}/move`,
    { query: { destination: toCalendarId, sendUpdates: "none" } },
  );

  if (response.status === 404 || response.status === 410) {
    return;
  }

  await assertOk(response, "event move");
}

async function deleteSessionEvent(
  { calendarId, refreshToken }: CalendarTarget,
  bookingId: string,
  sessionId: string,
) {
  const response = await calendarRequest(
    refreshToken,
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
 * Mirrors a booking change to the study's Google calendar and emails the
 * participant through Google Calendar invites. Pass `previous` as null for a
 * new booking and `next` as null for a removed booking. Only sessions that
 * changed are touched, so participants are not re-notified for unchanged ones.
 */
export async function syncBookingToGoogleCalendar(
  previous: BookingEntry | null,
  next: BookingEntry | null,
) {
  if (!hasGoogleClient()) {
    return;
  }

  const bookingId = next?.id ?? previous?.id;

  if (!bookingId) {
    return;
  }

  const nextSessions = next ? getSessionConfigs(getBookingTag(next)) : [];
  const nextSessionIds = new Set(nextSessions.map((session) => session.id));
  const tasks: Promise<void>[] = [];

  function getSessionTarget(
    booking: BookingEntry | null,
    sessionId: keyof BookingEntry["selections"],
  ) {
    const date = booking?.selections?.[sessionId]?.date;

    return booking && date
      ? getBookingCalendarTarget(getBookingTag(booking), date)
      : null;
  }

  for (const session of nextSessions) {
    if (previous && next && isSameSessionEvent(previous, next, session.id)) {
      continue;
    }

    const previousTarget = getSessionTarget(previous, session.id);
    const nextTarget = getSessionTarget(next, session.id);

    tasks.push(
      (async () => {
        if (
          previousTarget &&
          (!nextTarget || previousTarget.calendarId !== nextTarget.calendarId)
        ) {
          // Moving keeps a single invite for the participant; the update
          // below then notifies them of the new time. Events can only move
          // between calendars of the same account.
          if (nextTarget?.refreshToken === previousTarget.refreshToken) {
            await moveSessionEvent(
              previousTarget,
              nextTarget.calendarId,
              bookingId,
              session.id,
            );
          } else {
            await deleteSessionEvent(previousTarget, bookingId, session.id);
          }
        }

        if (nextTarget) {
          await upsertSessionEvent(nextTarget, next!, session);
        }
      })(),
    );
  }

  for (const session of sessionConfigs) {
    const previousTarget = getSessionTarget(previous, session.id);

    if (!nextSessionIds.has(session.id) && previousTarget) {
      tasks.push(deleteSessionEvent(previousTarget, bookingId, session.id));
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
  { calendarId, refreshToken }: CalendarTarget,
  startDate: string,
  endDate: string,
) {
  const ranges: BusyRange[] = [];
  let pageToken = "";

  do {
    const response = await calendarRequest(refreshToken, "GET", calendarPath(calendarId), {
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

async function getBusyRanges(
  target: CalendarTarget,
  startDate: string,
  endDate: string,
) {
  const cacheKey = `${target.calendarId}:${startDate}:${endDate}`;
  const cached = busyCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.ranges;
  }

  const ranges = await listBusyRanges(target, startDate, endDate);

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

  if (!hasGoogleClient() || validDates.length === 0) {
    return [];
  }

  try {
    const startDate = validDates[0];
    const endDate = validDates[validDates.length - 1];
    const targets = new Map(
      validDates
        .flatMap((date) => getBusyCalendarTargets(tag, date))
        .map((target) => [target.calendarId, target] as const),
    );
    const rangesByCalendar = new Map(
      await Promise.all(
        [...targets.values()].map(
          async (target) =>
            [
              target.calendarId,
              await getBusyRanges(target, startDate, endDate),
            ] as const,
        ),
      ),
    );
    const occupied = new Set<string>();

    for (const date of validDates) {
      const ranges = getBusyCalendarTargets(tag, date).flatMap(
        (target) => rangesByCalendar.get(target.calendarId) ?? [],
      );

      for (const slot of getSlotOptionsForDate(tag, date)) {
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
