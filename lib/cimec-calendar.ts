import { readFileSync, readdirSync } from "fs";
import path from "path";
import {
  BlockedSlotEntry,
  getSlotOptions,
  slotKey,
  studyConfigs,
  StudyTag,
} from "@/lib/booking";

type CimecCalendarBooking = {
  date?: string;
  details?: string;
  label?: string;
  status?: string;
  start_time?: string;
  end_time?: string;
  text?: string;
};

type CimecCalendarResource = {
  bookings?: CimecCalendarBooking[];
  resource?: {
    label?: string;
    value?: string;
  };
};

export type CimecBlockedSlotEntry = BlockedSlotEntry & {
  source: "cimec-calendar";
  sourceLabel: string;
  timeRange: string;
};

const cimecCalendarFilePattern = /^cimec_calendar.*\.json$/i;

const mentalSimulationPattern = /mental\s+simulation/i;
const eyelinkResourcePattern = /\beyelink\b/i;

function readCimecCalendarResources() {
  const dataDirectory = path.join(process.cwd(), "data");

  try {
    return readdirSync(dataDirectory)
      .filter((fileName) => cimecCalendarFilePattern.test(fileName))
      .sort()
      .flatMap((fileName) => {
        const filePath = path.join(dataDirectory, fileName);
        const parsed = JSON.parse(readFileSync(filePath, "utf8")) as
          | CimecCalendarResource
          | CimecCalendarResource[];

        return Array.isArray(parsed) ? parsed : [parsed];
      });
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return [];
    }

    throw error;
  }
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

function isResourceRelevantForStudy(
  resource: CimecCalendarResource,
  tag: StudyTag,
) {
  if (tag !== "sensorimotor-study") {
    return true;
  }

  const resourceName = [
    resource.resource?.label,
    resource.resource?.value,
  ].filter(Boolean).join(" ");

  return eyelinkResourcePattern.test(resourceName);
}

export function getCimecOccupiedSlotKeys(tag: StudyTag, date: string) {
  const occupied = new Set<string>();
  const slotOptions = getSlotOptions(tag);

  for (const booking of readCimecCalendarResources()
    .filter((resource) => isResourceRelevantForStudy(resource, tag))
    .flatMap((resource) => resource.bookings ?? [])) {
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

export function getCimecBlockedSlots() {
  const blockedSlots = new Map<string, CimecBlockedSlotEntry>();

  for (const resource of readCimecCalendarResources()) {
    const sourceLabel =
      resource.resource?.label ??
      resource.resource?.value ??
      "CIMeC calendar";

    for (const booking of resource.bookings ?? []) {
      if (
        booking.status !== "busy" ||
        hasMentalSimulationDetails(booking) ||
        !booking.date ||
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

      for (const study of Object.values(studyConfigs)) {
        if (!isResourceRelevantForStudy(resource, study.tag)) {
          continue;
        }

        for (const slot of study.slotOptions) {
          const slotRange = parseSlotRange(slot);

          if (!slotRange || !rangesOverlap(bookingRange, slotRange)) {
            continue;
          }

          const id = `cimec-${study.tag}-${booking.date}-${slot}`;
          const timeRange = `${booking.start_time} - ${booking.end_time}`;
          const existing = blockedSlots.get(id);
          const sourceAlreadyListed =
            existing?.sourceLabel.split(", ").includes(sourceLabel) ?? false;

          blockedSlots.set(id, {
            id,
            tag: study.tag,
            date: booking.date,
            slot,
            note: booking.label ?? booking.details ?? undefined,
            createdAt: "",
            source: "cimec-calendar",
            sourceLabel:
              existing && !sourceAlreadyListed
                ? `${existing.sourceLabel}, ${sourceLabel}`
                : existing?.sourceLabel ?? sourceLabel,
            timeRange: existing?.timeRange ?? timeRange,
          });
        }
      }
    }
  }

  return [...blockedSlots.values()].sort(
    (firstSlot, secondSlot) =>
      firstSlot.date.localeCompare(secondSlot.date) ||
      firstSlot.slot.localeCompare(secondSlot.slot) ||
      firstSlot.sourceLabel.localeCompare(secondSlot.sourceLabel),
  );
}
