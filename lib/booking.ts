export type SessionId = "session1" | "session2" | "session3" | "session4";
export type StudyTag = "meg-study" | "sensorimotor-study";

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
  email: string;
  firstSessionDate: string;
  selections: BookingState;
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
  slotOptions: string[];
  dateSelectionMode: "first-session" | "per-session";
};

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

export const studyConfigs: Record<StudyTag, StudyConfig> = {
  "meg-study": {
    tag: "meg-study",
    title: "MEG experiment",
    confirmationSubject: "MEG experiment",
    flyerAlt: "MEG long-term memory study recruitment flyer",
    dateSelectionMode: "first-session",
    slotOptions: [
      "09:00 - 11:00",
      "11:00 - 13:00",
      "14:00 - 16:00",
      "16:00 - 18:00",
    ],
  },
  "sensorimotor-study": {
    tag: "sensorimotor-study",
    title: "Sensorimotor study",
    confirmationSubject: "sensorimotor study",
    flyerAlt: "Sensorimotor study recruitment flyer",
    dateSelectionMode: "per-session",
    slotOptions: [
      "08:00 - 09:00",
      "09:00 - 10:00",
      "10:00 - 11:00",
      "11:00 - 12:00",
      "12:00 - 13:00",
      "14:00 - 15:00",
      "15:00 - 16:00",
      "16:00 - 17:00",
      "17:00 - 18:00",
      "18:00 - 19:00",
    ],
  },
};

export const defaultStudyTag: StudyTag = "meg-study";

export const slotOptions = studyConfigs[defaultStudyTag].slotOptions;

export function getStudyTag(tag?: string | null): StudyTag {
  return tag === "sensorimotor-study" ? "sensorimotor-study" : defaultStudyTag;
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

export function getLatestFirstSessionDate() {
  return getLatestBookingDate(4);
}

export function getLatestBookingDate(weeks: number) {
  const latestDate = startOfToday();
  latestDate.setDate(latestDate.getDate() + weeks * 7);

  return formatIsoDate(latestDate);
}

export function isWithinBookingWindow(date: string) {
  return isWithinBookingWindowWeeks(date, 4);
}

export function isWithinBookingWindowWeeks(date: string, weeks: number) {
  const parsedDate = parseIsoDate(date);

  if (!parsedDate) {
    return false;
  }

  const today = startOfToday();
  const latestDate = startOfToday();
  latestDate.setDate(today.getDate() + weeks * 7);

  return parsedDate >= today && parsedDate <= latestDate;
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
) {
  return sessionConfigs.reduce((acc, session) => {
    acc[session.id] = {
      day: getSessionDay(firstSessionDate, session.dayOffset),
      date: getSessionDate(firstSessionDate, session.dayOffset),
      slot: currentSelections[session.id]?.slot ?? "",
    };
    return acc;
  }, {} as BookingState);
}

export function slotKey(date: string, slot: string) {
  return `${date}|${slot}`;
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
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
