import {
  BlockedSlotEntry,
  getSlotOptionsForDate,
  parseSlotRange,
  parseTimeRange,
  rangesOverlap,
  slotKey,
  studyConfigs,
  StudyTag,
} from "@/lib/booking";
import { readCimecCalendarExports } from "@/lib/bookings-store";

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
  subresources?: {
    label?: string;
    title?: string;
    value?: string;
  }[];
};

type CimecCalendarExport =
  | CimecCalendarResource
  | CimecCalendarResource[]
  | {
      calendars?: CimecCalendarResource[];
    };

export type CimecBlockedSlotEntry = BlockedSlotEntry & {
  source: "cimec-calendar";
  sourceLabel: string;
  timeRange: string;
};

const cimecCacheTtlMs = 60_000;

const mentalSimulationPattern = /mental\s+simulation/i;
const megResourcePattern = /\bmeg\b/i;

type CimecCalendarName = "meg";

type CimecCalendarRule = {
  calendars: CimecCalendarName[];
  weekdays?: number[];
};

const cimecCalendarRules: Record<StudyTag, CimecCalendarRule[]> = {
  // Eyelink bookings never block slots; only the MEG resource does, and only
  // for Tuesday MEG sessions.
  "meg-study": [{ calendars: ["meg"], weekdays: [2] }],
  "sensorimotor-study": [],
  "eye-track-monpath": [],
  "semantic-foraging": [],
};

function isCimecCalendarCollection(
  exportData: CimecCalendarExport,
): exportData is { calendars?: CimecCalendarResource[] } {
  return !Array.isArray(exportData) && "calendars" in exportData;
}

let cimecResourcesCache: {
  expiresAt: number;
  resources: Promise<CimecCalendarResource[]>;
} | null = null;

async function loadCimecCalendarResources() {
  const exports = (await readCimecCalendarExports()) as CimecCalendarExport[];

  return exports.flatMap((parsed) => {
    if (Array.isArray(parsed)) {
      return parsed;
    }

    return isCimecCalendarCollection(parsed)
      ? (parsed.calendars ?? [])
      : [parsed];
  });
}

function readCimecCalendarResources() {
  if (!cimecResourcesCache || cimecResourcesCache.expiresAt <= Date.now()) {
    const resources = loadCimecCalendarResources();

    cimecResourcesCache = {
      expiresAt: Date.now() + cimecCacheTtlMs,
      resources,
    };
    // Retry on the next request instead of caching a failure.
    resources.catch(() => {
      cimecResourcesCache = null;
    });
  }

  return cimecResourcesCache.resources;
}

function hasMentalSimulationDetails(booking: CimecCalendarBooking) {
  const details = [booking.details, booking.text].filter(Boolean).join(" ");

  return mentalSimulationPattern.test(details);
}

function getSlotTypeText(booking?: CimecCalendarBooking) {
  return booking?.text?.match(/slot type:\s*(.*?)\s+slot id:/i)?.[1] ?? "";
}

function getResourceSearchText(
  resource: CimecCalendarResource,
  booking?: CimecCalendarBooking,
) {
  return [
    resource.resource?.label,
    resource.resource?.value,
    ...(resource.subresources ?? []).flatMap((subresource) => [
      subresource.label,
      subresource.title,
      subresource.value,
    ]),
    getSlotTypeText(booking),
  ]
    .filter(Boolean)
    .join(" ");
}

function getDateWeekday(date: string) {
  const [year, month, day] = date.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  const parsedDate = new Date(year, month - 1, day);

  if (
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return null;
  }

  return parsedDate.getDay();
}

function isCalendarMatch(
  resource: CimecCalendarResource,
  _calendar: CimecCalendarName,
  booking?: CimecCalendarBooking,
) {
  return megResourcePattern.test(getResourceSearchText(resource, booking));
}

function isResourceRelevantForStudy(
  resource: CimecCalendarResource,
  tag: StudyTag,
  date: string,
  booking?: CimecCalendarBooking,
) {
  const weekday = getDateWeekday(date);
  const rules = cimecCalendarRules[tag];
  const applicableRules = rules.filter((rule) =>
    rule.weekdays
      ? weekday !== null && rule.weekdays.includes(weekday)
      : !rules.some(
          (weekdayRule) =>
            weekdayRule.weekdays &&
            weekday !== null &&
            weekdayRule.weekdays.includes(weekday),
        ),
  );

  return applicableRules.some((rule) =>
    rule.calendars.some((calendar) =>
      isCalendarMatch(resource, calendar, booking),
    ),
  );
}

export async function getCimecOccupiedSlotKeys(tag: StudyTag, date: string) {
  const occupied = new Set<string>();
  const slotOptions = getSlotOptionsForDate(tag, date);

  for (const { booking, resource } of (await readCimecCalendarResources())
    .flatMap((resource) =>
      (resource.bookings ?? []).map((booking: CimecCalendarBooking) => ({
        booking,
        resource,
      })),
    )) {
    if (
      booking.date !== date ||
      booking.status !== "busy" ||
      hasMentalSimulationDetails(booking) ||
      !booking.start_time ||
      !booking.end_time ||
      !isResourceRelevantForStudy(resource, tag, booking.date, booking)
    ) {
      continue;
    }

    const bookingRange = parseTimeRange(booking.start_time, booking.end_time);

    if (!bookingRange) {
      continue;
    }

    for (const slot of slotOptions) {
      const slotRange = parseSlotRange(slot);

      if (slotRange && rangesOverlap(bookingRange, slotRange)) {
        occupied.add(slotKey(date, slot));
      }
    }
  }

  return [...occupied];
}

export async function getCimecBlockedSlots() {
  const blockedSlots = new Map<string, CimecBlockedSlotEntry>();

  for (const resource of await readCimecCalendarResources()) {
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

      const bookingRange = parseTimeRange(
        booking.start_time,
        booking.end_time,
      );

      if (!bookingRange) {
        continue;
      }

      for (const study of Object.values(studyConfigs)) {
        if (
          !isResourceRelevantForStudy(
            resource,
            study.tag,
            booking.date,
            booking,
          )
        ) {
          continue;
        }

        for (const slot of getSlotOptionsForDate(study.tag, booking.date)) {
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
