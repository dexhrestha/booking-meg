import cimecCalendarResource3Subresource138 from "@/data/cimec_calendar_resource-3_subresource-138.json";
import cimecCalendarResource13 from "@/data/cimec_calendar_resource-13.json";
import { getSlotOptions, slotKey, StudyTag } from "@/lib/booking";

type CimecCalendarBooking = {
  date?: string;
  details?: string;
  status?: string;
  start_time?: string;
  end_time?: string;
  text?: string;
};

type CimecCalendarResource = {
  bookings?: CimecCalendarBooking[];
};

const cimecCalendarResources: CimecCalendarResource[] = [
  cimecCalendarResource3Subresource138,
  cimecCalendarResource13,
];

const mentalSimulationPattern = /mental\s+simulation/i;

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

  return { startMinutes, endMinutes };
}

function rangesOverlap(
  first: { startMinutes: number; endMinutes: number },
  second: { startMinutes: number; endMinutes: number },
) {
  return (
    first.startMinutes < second.endMinutes &&
    second.startMinutes < first.endMinutes
  );
}

function hasMentalSimulationDetails(booking: CimecCalendarBooking) {
  const details = [booking.details, booking.text].filter(Boolean).join(" ");

  return mentalSimulationPattern.test(details);
}

export function getCimecOccupiedSlotKeys(tag: StudyTag, date: string) {
  const occupied = new Set<string>();
  const slotOptions = getSlotOptions(tag);

  for (const booking of cimecCalendarResources.flatMap(
    (resource) => resource.bookings ?? [],
  )) {
    if (
      booking.date !== date ||
      booking.status !== "busy" ||
      hasMentalSimulationDetails(booking) ||
      !booking.start_time ||
      !booking.end_time
    ) {
      continue;
    }

    const bookingStart = timeToMinutes(booking.start_time);
    const bookingEnd = timeToMinutes(booking.end_time);

    if (
      bookingStart === null ||
      bookingEnd === null ||
      bookingEnd <= bookingStart
    ) {
      continue;
    }

    const bookingRange = {
      startMinutes: bookingStart,
      endMinutes: bookingEnd,
    };

    for (const slot of slotOptions) {
      const slotRange = parseSlotRange(slot);

      if (slotRange && rangesOverlap(bookingRange, slotRange)) {
        occupied.add(slotKey(date, slot));
      }
    }
  }

  return [...occupied];
}
