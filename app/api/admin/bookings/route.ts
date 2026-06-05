import { NextRequest, NextResponse } from "next/server";
import {
  BookingEntry,
  BookingState,
  formatDisplayDate,
  getBookingTag,
  getDayForDate,
  getLatestBookingDate,
  getLatestFirstSessionDate,
  getSessionDate,
  getSessionDay,
  getSlotOptions,
  getStudyTag,
  isAllowedSensorimotorFirstSessionDate,
  isAllowedFirstSessionDate,
  isSameOrAfterDate,
  isWithinSameWeek,
  isWeekdayDate,
  isValidEmail,
  sessionConfigs,
  StudyTag,
} from "@/lib/booking";
import {
  getStorageErrorMessage,
  readBookings,
  writeBookings,
} from "@/lib/bookings-store";

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

function isCompleteBooking(booking: BookingEntry, tag?: StudyTag) {
  return Boolean(
    (!tag || getBookingTag(booking) === tag) &&
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

function validateSelections(
  selections: BookingState,
  firstSessionDate: string,
  tag: StudyTag,
) {
  const slotOptions = getSlotOptions(tag);

  for (const session of sessionConfigs) {
    const selection = selections?.[session.id];
    const validSlot = slotOptions.includes(selection?.slot);
    let validDay = false;
    let validDate = false;

    if (tag === "sensorimotor-study") {
      validDay = selection?.day === getDayForDate(selection?.date ?? "");
      validDate =
        session.id === "session1"
          ? isAllowedSensorimotorFirstSessionDate(selection?.date ?? "")
          : isWithinSameWeek(selection?.date ?? "", selections.session1.date) &&
            isWeekdayDate(selection?.date ?? "") &&
            isSameOrAfterDate(
              selection?.date ?? "",
              selections[sessionConfigs[sessionConfigs.indexOf(session) - 1].id]
                .date,
            );
    } else {
      validDay =
        selection?.day === getSessionDay(firstSessionDate, session.dayOffset);
      validDate =
        selection?.date === getSessionDate(firstSessionDate, session.dayOffset);
    }

    if (!validDay || !validDate || !validSlot) {
      return `${session.title} has an invalid day, date, or slot.`;
    }
  }

  const duplicateSelection = sessionConfigs.find((session, index) =>
    sessionConfigs.slice(0, index).some((previousSession) => {
      const current = selections[session.id];
      const previous = selections[previousSession.id];

      return current.date === previous.date && current.slot === previous.slot;
    }),
  );

  if (duplicateSelection) {
    return `${duplicateSelection.title} uses a date and time already selected for an earlier session.`;
  }

  if (
    tag === "sensorimotor-study" &&
    selections.session1.date !== firstSessionDate
  ) {
    return "Session 1 date must match the booking start date.";
  }

  return "";
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    const bookings = await readBookings();

    return NextResponse.json({
      bookings: bookings.filter((booking) => isCompleteBooking(booking)),
    });
  } catch (error) {
    return NextResponse.json(
      { message: getStorageErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  if (!isAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
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
    const tag = getStudyTag(booking.tag);

  if (
    !booking.id ||
    !isValidEmail(email) ||
    (tag === "sensorimotor-study"
      ? !isAllowedSensorimotorFirstSessionDate(booking.firstSessionDate)
      : !isAllowedFirstSessionDate(booking.firstSessionDate))
  ) {
    return NextResponse.json(
      {
        message:
          tag === "sensorimotor-study"
            ? `Enter a valid email, choose Session 1 on a Monday or Tuesday within the next 8 weeks through ${formatDisplayDate(getLatestBookingDate(8))}, and keep the remaining sessions on weekdays in that same week.`
            : `Enter a valid email and a Monday or Tuesday first-session date within the next 4 weeks, through ${formatDisplayDate(getLatestFirstSessionDate())}.`,
      },
      { status: 400 },
    );
  }

  const validationError = validateSelections(
    booking.selections,
    booking.firstSessionDate,
    tag,
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
      item.id !== booking.id &&
      getBookingTag(item) === tag &&
      item.email.toLowerCase() === email.toLowerCase(),
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
        getBookingTag(item) === tag &&
        existing?.date &&
        existing?.slot &&
        next?.date &&
        next?.slot &&
        sessionConfigs.some((requestedSession) => {
          const requested = booking.selections[requestedSession.id];

          return (
            existing.date === requested.date &&
            existing.slot === requested.slot
          );
        })
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
    tag,
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
      bookings: updatedBookings.filter((booking) => isCompleteBooking(booking)),
    });
  } catch (error) {
    return NextResponse.json(
      { message: getStorageErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
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
      bookings: updatedBookings.filter((booking) => isCompleteBooking(booking)),
    });
  } catch (error) {
    return NextResponse.json(
      { message: getStorageErrorMessage(error) },
      { status: 500 },
    );
  }
}
