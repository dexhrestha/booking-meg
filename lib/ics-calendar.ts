import {
  BlockedSlotEntry,
  BookingEntry,
  StudyTag,
  formatDisplayDate,
  getBlockedSlotTag,
  getBookingTag,
  getStudyConfig,
  sessionConfigs,
} from "@/lib/booking";

type IcsEvent = {
  id: string;
  date: string;
  slot: string;
  summary: string;
  description: string;
};

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

  return { start, end };
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

function getNowIcsTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function getBookingEvents(bookings: BookingEntry[], tag: StudyTag) {
  const study = getStudyConfig(tag);

  return bookings
    .filter((booking) => getBookingTag(booking) === tag)
    .flatMap((booking) =>
      sessionConfigs.map((session) => {
        const selection = booking.selections[session.id];

        return {
          id: `booking-${booking.id}-${session.id}`,
          date: selection.date,
          slot: selection.slot,
          summary: `${study.title}: ${session.title} - ${booking.email}`,
          description: [
            `Type: Booking`,
            `Experiment: ${study.title}`,
            `Participant: ${booking.email}`,
            `Session: ${session.title}`,
            `Date: ${formatDisplayDate(selection.date)}`,
            `Day: ${selection.day}`,
            `Slot: ${selection.slot}`,
          ].join("\n"),
        } satisfies IcsEvent;
      }),
    );
}

function getBlockedSlotEvents(blockedSlots: BlockedSlotEntry[], tag: StudyTag) {
  const study = getStudyConfig(tag);

  return blockedSlots
    .filter((blockedSlot) => getBlockedSlotTag(blockedSlot) === tag)
    .map(
      (blockedSlot) =>
        ({
          id: `blocked-${blockedSlot.id}`,
          date: blockedSlot.date,
          slot: blockedSlot.slot,
          summary: `${study.title}: blocked slot`,
          description: [
            `Type: Manual blocked slot`,
            `Experiment: ${study.title}`,
            `Date: ${formatDisplayDate(blockedSlot.date)}`,
            `Slot: ${blockedSlot.slot}`,
            blockedSlot.note ? `Note: ${blockedSlot.note}` : undefined,
          ]
            .filter(Boolean)
            .join("\n"),
        }) satisfies IcsEvent,
    );
}

export function buildExperimentIcsCalendar(
  bookings: BookingEntry[],
  blockedSlots: BlockedSlotEntry[],
  tag: StudyTag,
  startDate?: string,
  endDate?: string,
) {
  const study = getStudyConfig(tag);
  const now = getNowIcsTimestamp();
  const events = [...getBookingEvents(bookings, tag), ...getBlockedSlotEvents(blockedSlots, tag)]
    .filter((event) => parseSlotRange(event.slot))
    .filter((event) => {
      if (startDate && event.date < startDate) return false;
      if (endDate && event.date > endDate) return false;
      return true;
    })
    .toSorted(
      (firstEvent, secondEvent) =>
        firstEvent.date.localeCompare(secondEvent.date) ||
        firstEvent.slot.localeCompare(secondEvent.slot) ||
        firstEvent.summary.localeCompare(secondEvent.summary),
    );
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Booking MEG//Experiment Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(`${study.title} bookings`)}`,
    "X-WR-TIMEZONE:Europe/Rome",
  ];

  for (const event of events) {
    const range = parseSlotRange(event.slot);

    if (!range) {
      continue;
    }

    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(`${event.id}@booking-meg`)}`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=Europe/Rome:${formatIcsDateTime(event.date, range.start)}`,
      `DTEND;TZID=Europe/Rome:${formatIcsDateTime(event.date, range.end)}`,
      `SUMMARY:${escapeIcsText(event.summary)}`,
      `DESCRIPTION:${escapeIcsText(event.description)}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");

  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
