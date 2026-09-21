export type SessionId = "session1" | "session2" | "session3" | "session4";
export type StudyTag = "meg-study" | "sensorimotor-study" | "eye-track-monpath";

export type SessionConfig = {
  id: SessionId;
  title: string;
  dayOffset: number;
};

export type SessionSelection = {
  day: string;
  date: string;
  slot: string;
};

export type BookingState = Record<SessionId, SessionSelection>;

export type BookingEntry = {
  id: string;
  tag?: StudyTag;
  name?: string;
  email: string;
  firstSessionDate: string;
  selections: BookingState;
  criteriaAcceptedAt?: string;
  createdAt: string;
  updatedAt?: string;
};

export type BlockedSlotEntry = {
  id: string;
  tag: StudyTag;
  date: string;
  slot: string;
  note?: string;
  createdAt: string;
  updatedAt?: string;
};

export type OccupiedSlots = Record<SessionId, string[]>;
export type SlotBlockReason = "other-researcher" | "unavailable";
export type OccupiedSlotReasons = Record<
  SessionId,
  Record<string, SlotBlockReason>
>;

export type StudyConfig = {
  tag: StudyTag;
  title: string;
  confirmationSubject: string;
  flyerAlt: string;
  eligibilityCriteria: string[];
  slotOptions: string[];
  dateSelectionMode: "first-session" | "per-session" | "same-day-consecutive";
  sessionIds?: SessionId[];
};

const megEligibilityCriteria = [
  "You are 18-35 years old.",
  "You are right-handed.",
  "You have normal or corrected-to-normal vision.",
  "You have no metal implants, non-removable piercings, or other non-removable metal.",
  "You have no metal dental retainers or splints, no braids or extensions, and no non-removable head coverings that could interfere with the MEG setup.",
  "You have no current neurological, psychological, or psychiatric diagnosis.",
];

const eyeTrackingEligibilityCriteria = [
  "You are 18-35 years old.",
  "You have normal or corrected-to-normal vision.",
];

export const sessionConfigs: SessionConfig[] = [
  {
    id: "session1",
    title: "Session 1",
    dayOffset: 0,
  },
  {
    id: "session2",
    title: "Session 2",
    dayOffset: 1,
  },
  {
    id: "session3",
    title: "Session 3",
    dayOffset: 4,
  },
  {
    id: "session4",
    title: "Session 4",
    dayOffset: 5,
  },
];

const standardSlotOptions = [
  "09:00 - 11:00",
  "11:00 - 13:00",
  "13:00 - 15:00",
  "15:00 - 17:00",
];

const eyeTrackingSlotOptions = [
  "08:30 - 10:30",
  "10:30 - 12:30",
  "13:30 - 15:30",
  "15:30 - 17:30",
  "17:30 - 19:30",
];

export const studyConfigs: Record<StudyTag, StudyConfig> = {
  "meg-study": {
    tag: "meg-study",
    title: "MEG experiment",
    confirmationSubject: "MEG experiment",
    flyerAlt: "MEG long-term memory study recruitment flyer",
    eligibilityCriteria: megEligibilityCriteria,
    dateSelectionMode: "first-session",
    slotOptions: standardSlotOptions,
  },
  "sensorimotor-study": {
    tag: "sensorimotor-study",
    title: "Sensorimotor study",
    confirmationSubject: "sensorimotor study",
    flyerAlt: "Sensorimotor study recruitment flyer",
    eligibilityCriteria: megEligibilityCriteria,
    dateSelectionMode: "per-session",
    slotOptions: standardSlotOptions,
  },
  "eye-track-monpath": {
    tag: "eye-track-monpath",
    title: "eye tracking experiment",
    confirmationSubject: "eye tracking experiment",
    flyerAlt: "Eye tracking experiment recruitment flyer",
    eligibilityCriteria: eyeTrackingEligibilityCriteria,
    dateSelectionMode: "same-day-consecutive",
    slotOptions: eyeTrackingSlotOptions,
    sessionIds: ["session1", "session2", "session3"],
  },
};

export const defaultStudyTag: StudyTag = "meg-study";
export const bookingWindowLeadDays = 7;
export const bookingWindowEndDate = "2026-10-31";

export const slotOptions = studyConfigs[defaultStudyTag].slotOptions;

export function getStudyTag(tag?: string | null): StudyTag {
  if (tag === "sensorimotor-study" || tag === "eye-track-monpath") {
    return tag;
  }

  return defaultStudyTag;
}

export function getStudyConfig(tag?: string | null) {
  return studyConfigs[getStudyTag(tag)];
}

export function getBookingTag(booking: Pick<BookingEntry, "tag">): StudyTag {
  return getStudyTag(booking.tag);
}

export function getBlockedSlotTag(blockedSlot: Pick<BlockedSlotEntry, "tag">) {
  return getStudyTag(blockedSlot.tag);
}

export function getSlotOptions(tag?: string | null) {
  return getStudyConfig(tag).slotOptions;
}

function parseSlotRange(slot: string) {
  const [start, end] = slot.split(" - ").map((value) => value.trim());

  return start && end ? { start, end } : null;
}

export function getConsecutiveSlots(
  slotOptions: string[],
  startSlot: string,
  sessionCount: number,
) {
  const startIndex = slotOptions.indexOf(startSlot);

  if (startIndex < 0) {
    return [];
  }

  const slots = slotOptions.slice(startIndex, startIndex + sessionCount);

  if (slots.length !== sessionCount) {
    return [];
  }

  const hasNoGaps = slots.every((slot, index) => {
    if (index === 0) {
      return true;
    }

    const previousRange = parseSlotRange(slots[index - 1]);
    const currentRange = parseSlotRange(slot);

    return Boolean(
      previousRange && currentRange && previousRange.end === currentRange.start,
    );
  });

  return hasNoGaps ? slots : [];
}

export function getSessionConfigs(tag?: string | null) {
  const study = getStudyConfig(tag);
  const sessionIds = study.sessionIds ?? sessionConfigs.map((session) => session.id);

  return sessionConfigs.filter((session) => sessionIds.includes(session.id));
}

export const initialSelections = sessionConfigs.reduce((acc, session) => {
  acc[session.id] = {
    day: "",
    date: "",
    slot: "",
  };
  return acc;
}, {} as BookingState);

function parseIsoDate(date: string) {
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

  return parsedDate;
}

function formatIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return today;
}

function startOfBookingWindow() {
  const earliestDate = startOfToday();
  earliestDate.setDate(earliestDate.getDate() + bookingWindowLeadDays);

  return earliestDate;
}

export function getEarliestBookingDate() {
  return formatIsoDate(startOfBookingWindow());
}

export function getLatestFirstSessionDate() {
  return bookingWindowEndDate;
}

export function getLatestBookingDate(_weeks: number) {
  return bookingWindowEndDate;
}

export function isWithinBookingWindow(date: string) {
  return isWithinBookingWindowUntil(date, bookingWindowEndDate);
}

export function isWithinBookingWindowWeeks(date: string, weeks: number) {
  return isWithinBookingWindowUntil(date, getLatestBookingDate(weeks));
}

export function isWithinBookingWindowUntil(date: string, endDate: string) {
  const parsedDate = parseIsoDate(date);
  const latestDate = parseIsoDate(endDate);

  if (!parsedDate || !latestDate) {
    return false;
  }

  const earliestDate = startOfBookingWindow();

  return parsedDate >= earliestDate && parsedDate <= latestDate;
}

export function isAllowedFirstSessionDate(date: string) {
  const parsedDate = parseIsoDate(date);
  const weekday = parsedDate?.getDay();

  return weekday === 4 && isWithinBookingWindow(date);
}

export function isAllowedSensorimotorFirstSessionDate(date: string) {
  const parsedDate = parseIsoDate(date);
  const weekday = parsedDate?.getDay();

  return (
    (weekday === 1 || weekday === 2) && isWithinBookingWindowWeeks(date, 8)
  );
}

export function isAllowedEyeTrackingDate(date: string) {
  const parsedDate = parseIsoDate(date);
  const weekday = parsedDate?.getDay();

  return (
    (weekday === 1 || weekday === 2 || weekday === 3) &&
    isWithinBookingWindowWeeks(date, 8)
  );
}

export function isWeekdayDate(date: string) {
  const parsedDate = parseIsoDate(date);
  const weekday = parsedDate?.getDay();

  return Boolean(weekday && weekday >= 1 && weekday <= 5);
}

export function isSameOrAfterDate(date: string, comparisonDate: string) {
  const parsedDate = parseIsoDate(date);
  const parsedComparisonDate = parseIsoDate(comparisonDate);

  if (!parsedDate || !parsedComparisonDate) {
    return false;
  }

  return parsedDate > parsedComparisonDate;
}

export function isWithinSameWeek(date: string, weekDate: string) {
  const parsedDate = parseIsoDate(date);
  const parsedWeekDate = parseIsoDate(weekDate);

  if (!parsedDate || !parsedWeekDate) {
    return false;
  }

  const weekStart = new Date(parsedWeekDate);
  const weekday = weekStart.getDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  weekStart.setDate(weekStart.getDate() - daysSinceMonday);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  return parsedDate >= weekStart && parsedDate <= weekEnd;
}

export function getSessionDate(firstSessionDate: string, dayOffset: number) {
  const parsedDate = parseIsoDate(firstSessionDate);

  if (!parsedDate) {
    return "";
  }

  parsedDate.setDate(parsedDate.getDate() + dayOffset);

  return formatIsoDate(parsedDate);
}

export function getSessionDay(firstSessionDate: string, dayOffset: number) {
  const sessionDate = getSessionDate(firstSessionDate, dayOffset);
  return getDayForDate(sessionDate);
}

export function getDayForDate(date: string) {
  const parsedDate = parseIsoDate(date);

  if (!parsedDate) {
    return "";
  }

  return new Intl.DateTimeFormat("en", {
    weekday: "long",
  }).format(parsedDate);
}

export function formatDisplayDate(date: string) {
  const parsedDate = parseIsoDate(date);

  if (!parsedDate) {
    return "";
  }

  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsedDate);
}

export function buildSelectionsForStartDate(
  firstSessionDate: string,
  currentSelections: BookingState = initialSelections,
  tag: StudyTag = defaultStudyTag,
) {
  const study = getStudyConfig(tag);

  return getSessionConfigs(tag).reduce((acc, session) => {
    const sessionDate =
      study.dateSelectionMode === "same-day-consecutive"
        ? firstSessionDate
        : getSessionDate(firstSessionDate, session.dayOffset);

    acc[session.id] = {
      day: getDayForDate(sessionDate),
      date: sessionDate,
      slot: currentSelections[session.id]?.slot ?? "",
    };
    return acc;
  }, { ...initialSelections } as BookingState);
}

export function slotKey(date: string, slot: string) {
  return `${date}|${slot}`;
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function isValidParticipantName(name: string) {
  return name.trim().length >= 2;
}

export function isValidIsoDate(date: string) {
  return Boolean(parseIsoDate(date));
}

export function emptyOccupiedSlots(): OccupiedSlots {
  return sessionConfigs.reduce((acc, session) => {
    acc[session.id] = [];
    return acc;
  }, {} as OccupiedSlots);
}

export function emptyOccupiedSlotReasons(): OccupiedSlotReasons {
  return sessionConfigs.reduce((acc, session) => {
    acc[session.id] = {};
    return acc;
  }, {} as OccupiedSlotReasons);
}
