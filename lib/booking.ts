export type SessionId = "session1" | "session2" | "session3" | "session4";

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
  email: string;
  firstSessionDate: string;
  selections: BookingState;
  createdAt: string;
  updatedAt?: string;
};

export type OccupiedSlots = Record<SessionId, string[]>;

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
    dayOffset: 2,
  },
  {
    id: "session4",
    title: "Session 4",
    dayOffset: 3,
  },
];

export const slotOptions = [
  "09:00 - 11:00",
  "11:00 - 13:00",
  "13:00 - 15:00",
  "15:00 - 17:00",
];

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

  return new Date(year, month - 1, day);
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
  const latestDate = startOfToday();
  latestDate.setDate(latestDate.getDate() + 28);

  return formatIsoDate(latestDate);
}

export function isWithinBookingWindow(date: string) {
  const parsedDate = parseIsoDate(date);

  if (!parsedDate) {
    return false;
  }

  const today = startOfToday();
  const latestDate = startOfToday();
  latestDate.setDate(today.getDate() + 28);

  return parsedDate >= today && parsedDate <= latestDate;
}

export function isAllowedFirstSessionDate(date: string) {
  const parsedDate = parseIsoDate(date);
  const weekday = parsedDate?.getDay();

  return (weekday === 1 || weekday === 2) && isWithinBookingWindow(date);
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
  const parsedDate = parseIsoDate(sessionDate);

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

export function emptyOccupiedSlots(): OccupiedSlots {
  return sessionConfigs.reduce((acc, session) => {
    acc[session.id] = [];
    return acc;
  }, {} as OccupiedSlots);
}
