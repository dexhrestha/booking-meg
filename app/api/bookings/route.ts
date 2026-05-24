import { mkdir, readFile, writeFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import {
  BookingEntry,
  BookingState,
  emptyOccupiedSlots,
  getSessionDate,
  getSessionDay,
  getLatestFirstSessionDate,
  formatDisplayDate,
  isAllowedFirstSessionDate,
  isValidEmail,
  sessionConfigs,
  slotKey,
  slotOptions,
} from "@/lib/booking";

const bookingsFile = path.join(process.cwd(), "data", "bookings.json");

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

function getBookingForEmail(bookings: BookingEntry[], email: string) {
  if (!isValidEmail(email)) {
    return null;
  }

  return (
    bookings.find(
      (booking) =>
        isCompleteBooking(booking) &&
        booking.email.toLowerCase() === email.toLowerCase(),
    ) ?? null
  );
}

function removeExtraBookingsForEmail(
  bookings: BookingEntry[],
  email: string,
  keptBookingId: string,
) {
  return bookings.filter(
    (booking) =>
      booking.id === keptBookingId ||
      booking.email.toLowerCase() !== email.toLowerCase(),
  );
}

function getOccupiedSlots(
  bookings: BookingEntry[],
  firstSessionDate: string,
  excludedBookingId?: string,
) {
  const occupied = emptyOccupiedSlots();

  for (const booking of bookings) {
    if (booking.id === excludedBookingId) {
      continue;
    }

    if (booking.firstSessionDate !== firstSessionDate) {
      continue;
    }

    for (const session of sessionConfigs) {
      const selection = booking.selections[session.id];

      if (selection?.date && selection?.slot) {
        occupied[session.id].push(slotKey(selection.date, selection.slot));
      }
    }
  }

  return occupied;
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
  const firstSessionDate = request.nextUrl.searchParams.get("firstSessionDate");
  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  const excludedBookingId =
    request.nextUrl.searchParams.get("excludedBookingId") ?? undefined;
  const view = request.nextUrl.searchParams.get("view");
  const bookings = await readBookings();
  const existingBooking = email ? getBookingForEmail(bookings, email) : null;

  if (view === "all") {
    return NextResponse.json({
      bookings: bookings.filter(isCompleteBooking),
    });
  }

  if (!firstSessionDate || !isAllowedFirstSessionDate(firstSessionDate)) {
    return NextResponse.json({
      occupiedSlots: emptyOccupiedSlots(),
      bookingCount: 0,
      existingBooking,
    });
  }

  return NextResponse.json({
    occupiedSlots: getOccupiedSlots(
      bookings,
      firstSessionDate,
      excludedBookingId,
    ),
    bookingCount: bookings.filter(
      (booking) => booking.firstSessionDate === firstSessionDate,
    ).length,
    existingBooking,
  });
}

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as {
    email?: string;
    firstSessionDate?: string;
    selections?: BookingState;
  };
  const email = payload.email?.trim().toLowerCase() ?? "";
  const firstSessionDate = payload.firstSessionDate ?? "";
  const selections = payload.selections;

  if (
    !isValidEmail(email) ||
    !isAllowedFirstSessionDate(firstSessionDate) ||
    !selections
  ) {
    return NextResponse.json(
      {
        message:
          `Enter a valid email, choose a Monday or Tuesday date within the next 4 weeks through ${formatDisplayDate(getLatestFirstSessionDate())}, and choose every session slot.`,
      },
      { status: 400 },
    );
  }

  const validationError = validateSelections(selections, firstSessionDate);

  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }

  const bookings = await readBookings();
  const existingBooking = getBookingForEmail(bookings, email);

  if (existingBooking) {
    return NextResponse.json(
      {
        message:
          "This email already has a booking. The saved sessions have been loaded below for editing.",
        existingBooking,
        occupiedSlots: getOccupiedSlots(bookings, firstSessionDate),
      },
      { status: 409 },
    );
  }

  const occupiedSlots = getOccupiedSlots(bookings, firstSessionDate);
  const conflict = sessionConfigs.find((session) =>
    occupiedSlots[session.id].includes(
      slotKey(selections[session.id].date, selections[session.id].slot),
    ),
  );

  if (conflict) {
    const conflictSelection = selections[conflict.id];

    return NextResponse.json(
      {
        message: `${conflict.title} on ${conflictSelection.day}, ${conflictSelection.date} at ${conflictSelection.slot} is already booked. Choose another slot.`,
        occupiedSlots,
      },
      { status: 409 },
    );
  }

  const booking: BookingEntry = {
    id: crypto.randomUUID(),
    email,
    firstSessionDate,
    selections,
    createdAt: new Date().toISOString(),
  };

  const updatedBookings = [...bookings, booking];
  await writeBookings(updatedBookings);

  return NextResponse.json(
    {
      message: "Booking confirmed. Your selected MEG experiment slots have been saved.",
      booking,
      occupiedSlots: getOccupiedSlots(updatedBookings, firstSessionDate),
      existingBooking: booking,
    },
    { status: 201 },
  );
}

export async function PUT(request: NextRequest) {
  const payload = (await request.json()) as {
    id?: string;
    email?: string;
    firstSessionDate?: string;
    selections?: BookingState;
  };
  const id = payload.id ?? "";
  const email = payload.email?.trim().toLowerCase() ?? "";
  const firstSessionDate = payload.firstSessionDate ?? "";
  const selections = payload.selections;

  if (
    !id ||
    !isValidEmail(email) ||
    !isAllowedFirstSessionDate(firstSessionDate) ||
    !selections
  ) {
    return NextResponse.json(
      {
        message:
          `Enter a valid email, choose a Monday or Tuesday date within the next 4 weeks through ${formatDisplayDate(getLatestFirstSessionDate())}, and choose every session slot.`,
      },
      { status: 400 },
    );
  }

  const validationError = validateSelections(selections, firstSessionDate);

  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }

  const bookings = await readBookings();
  const bookingIndex = bookings.findIndex(
    (booking) =>
      booking.id === id && booking.email.toLowerCase() === email.toLowerCase(),
  );

  if (bookingIndex === -1) {
    return NextResponse.json(
      { message: "No booking was found for this email to edit." },
      { status: 404 },
    );
  }

  const occupiedSlots = getOccupiedSlots(bookings, firstSessionDate, id);
  const conflict = sessionConfigs.find((session) =>
    occupiedSlots[session.id].includes(
      slotKey(selections[session.id].date, selections[session.id].slot),
    ),
  );

  if (conflict) {
    const conflictSelection = selections[conflict.id];

    return NextResponse.json(
      {
        message: `${conflict.title} on ${conflictSelection.day}, ${conflictSelection.date} at ${conflictSelection.slot} is already booked. Choose another slot.`,
        occupiedSlots,
      },
      { status: 409 },
    );
  }

  const booking: BookingEntry = {
    ...bookings[bookingIndex],
    email,
    firstSessionDate,
    selections,
    updatedAt: new Date().toISOString(),
  };
  const updatedBookings = removeExtraBookingsForEmail(
    [
      ...bookings.slice(0, bookingIndex),
      booking,
      ...bookings.slice(bookingIndex + 1),
    ],
    email,
    booking.id,
  );

  await writeBookings(updatedBookings);

  return NextResponse.json({
    message: "Booking updated. Your selected MEG experiment slots have been saved.",
    booking,
    occupiedSlots: getOccupiedSlots(updatedBookings, firstSessionDate, id),
    existingBooking: booking,
  });
}
