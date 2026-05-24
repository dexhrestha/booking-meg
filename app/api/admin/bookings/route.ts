import { mkdir, readFile, writeFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import {
  BookingEntry,
  BookingState,
  getLatestFirstSessionDate,
  formatDisplayDate,
  getSessionDate,
  getSessionDay,
  isAllowedFirstSessionDate,
  isValidEmail,
  sessionConfigs,
  slotOptions,
} from "@/lib/booking";

const bookingsFile = path.join(process.cwd(), "data", "bookings.json");

function getAdminPassword() {
  return (
    process.env.BOOKING_ADMIN_PASSWORD ??
    process.env.VIEW_BOOKINGS_PASSWORD ??
    process.env.ADMIN_PASSWORD ??
    ""
  );
}

function isAuthorized(request: NextRequest) {
  const password = request.headers.get("x-admin-password") ?? "";
  const adminPassword = getAdminPassword();

  return adminPassword !== "" && password === adminPassword;
}

function unauthorizedResponse() {
  return NextResponse.json(
    { message: "Enter the correct bookings password." },
    { status: 401 },
  );
}

async function readBookings(): Promise<BookingEntry[]> {
  try {
    const file = await readFile(bookingsFile, "utf8");
    return JSON.parse(file) as BookingEntry[];
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }
}

async function writeBookings(bookings: BookingEntry[]) {
  await mkdir(path.dirname(bookingsFile), { recursive: true });
  await writeFile(bookingsFile, `${JSON.stringify(bookings, null, 2)}\n`);
}

function isCompleteBooking(booking: BookingEntry) {
  return (
    booking.id &&
    booking.email &&
    booking.firstSessionDate &&
    booking.selections &&
    sessionConfigs.every((session) => {
      const selection = booking.selections[session.id];
      return selection?.day && selection?.date && selection?.slot;
    })
  );
}

function validateSelections(selections: BookingState, firstSessionDate: string) {
  for (const session of sessionConfigs) {
    const selection = selections?.[session.id];
    const validDay =
      selection?.day === getSessionDay(firstSessionDate, session.dayOffset);
    const validDate =
      selection?.date === getSessionDate(firstSessionDate, session.dayOffset);
    const validSlot = slotOptions.includes(selection?.slot);

    if (!validDay || !validDate || !validSlot) {
      return `${session.title} has an invalid day, date, or slot.`;
    }
  }

  return "";
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return unauthorizedResponse();
  }

  const bookings = await readBookings();

  return NextResponse.json({
    bookings: bookings.filter(isCompleteBooking),
  });
}

export async function PUT(request: NextRequest) {
  if (!isAuthorized(request)) {
    return unauthorizedResponse();
  }

  const payload = (await request.json()) as {
    booking?: BookingEntry;
  };
  const booking = payload.booking;

  if (!booking) {
    return NextResponse.json(
      { message: "Choose a booking to edit." },
      { status: 400 },
    );
  }

  const email = booking.email.trim().toLowerCase();

  if (
    !booking.id ||
    !isValidEmail(email) ||
    !isAllowedFirstSessionDate(booking.firstSessionDate)
  ) {
    return NextResponse.json(
      {
        message: `Enter a valid email and a Monday or Tuesday first-session date within the next 4 weeks, through ${formatDisplayDate(getLatestFirstSessionDate())}.`,
      },
      { status: 400 },
    );
  }

  const validationError = validateSelections(
    booking.selections,
    booking.firstSessionDate,
  );

  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }

  const bookings = await readBookings();
  const bookingIndex = bookings.findIndex((item) => item.id === booking.id);

  if (bookingIndex === -1) {
    return NextResponse.json(
      { message: "This booking no longer exists." },
      { status: 404 },
    );
  }

  const emailUsed = bookings.some(
    (item) =>
      item.id !== booking.id && item.email.toLowerCase() === email.toLowerCase(),
  );

  if (emailUsed) {
    return NextResponse.json(
      { message: "Another booking already uses this email." },
      { status: 409 },
    );
  }

  const conflict = sessionConfigs.find((session) =>
    bookings.some((item) => {
      const existing = item.selections?.[session.id];
      const next = booking.selections[session.id];

      return (
        item.id !== booking.id &&
        item.firstSessionDate === booking.firstSessionDate &&
        existing?.date &&
        existing?.slot &&
        existing.date === next.date &&
        existing.slot === next.slot
      );
    }),
  );

  if (conflict) {
    const selection = booking.selections[conflict.id];

    return NextResponse.json(
      {
        message: `${conflict.title} on ${selection.day}, ${selection.date} at ${selection.slot} is already booked.`,
      },
      { status: 409 },
    );
  }

  const updatedBooking: BookingEntry = {
    ...bookings[bookingIndex],
    email,
    firstSessionDate: booking.firstSessionDate,
    selections: booking.selections,
    updatedAt: new Date().toISOString(),
  };
  const updatedBookings = [
    ...bookings.slice(0, bookingIndex),
    updatedBooking,
    ...bookings.slice(bookingIndex + 1),
  ];

  await writeBookings(updatedBookings);

  return NextResponse.json({
    message: "Booking updated.",
    bookings: updatedBookings.filter(isCompleteBooking),
  });
}

export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return unauthorizedResponse();
  }

  const payload = (await request.json()) as {
    id?: string;
  };
  const id = payload.id ?? "";

  if (!id) {
    return NextResponse.json(
      { message: "Choose a booking to remove." },
      { status: 400 },
    );
  }

  const bookings = await readBookings();
  const updatedBookings = bookings.filter((booking) => booking.id !== id);

  await writeBookings(updatedBookings);

  return NextResponse.json({
    message: "Booking removed.",
    bookings: updatedBookings.filter(isCompleteBooking),
  });
}
