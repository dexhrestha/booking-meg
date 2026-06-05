import { NextRequest, NextResponse } from "next/server";
import {
  BookingEntry,
  BookingState,
  emptyOccupiedSlots,
  formatDisplayDate,
  getBookingTag,
  getDayForDate,
  getLatestBookingDate,
  getLatestFirstSessionDate,
  getSessionDate,
  getSessionDay,
  getSlotOptions,
  getStudyConfig,
  getStudyTag,
  isAllowedSensorimotorFirstSessionDate,
  isAllowedFirstSessionDate,
  isSameOrAfterDate,
  isWithinSameWeek,
  isWeekdayDate,
  isValidEmail,
  SessionId,
  sessionConfigs,
  slotKey,
  StudyTag,
} from "@/lib/booking";
import {
  getStorageErrorMessage,
  readBookings,
  writeBookings,
} from "@/lib/bookings-store";

type SessionDateLookup = Partial<Record<SessionId, string>>;

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

function getBookingForEmail(
  bookings: BookingEntry[],
  email: string,
  tag: StudyTag,
) {
  if (!isValidEmail(email)) {
    return null;
  }

  return (
    bookings.find(
      (booking) =>
        isCompleteBooking(booking, tag) &&
        booking.email.toLowerCase() === email.toLowerCase(),
    ) ?? null
  );
}

function removeExtraBookingsForEmail(
  bookings: BookingEntry[],
  email: string,
  tag: StudyTag,
  keptBookingId: string,
) {
  return bookings.filter(
    (booking) =>
      booking.id === keptBookingId ||
      getBookingTag(booking) !== tag ||
      booking.email.toLowerCase() !== email.toLowerCase(),
  );
}

function getOccupiedSlots(
  bookings: BookingEntry[],
  tag: StudyTag,
  sessionDates: SessionDateLookup,
  excludedBookingId?: string,
) {
  const occupied = emptyOccupiedSlots();

  for (const booking of bookings) {
    if (booking.id === excludedBookingId) {
      continue;
    }

    if (getBookingTag(booking) !== tag) {
      continue;
    }

    for (const session of sessionConfigs) {
      const requestedDate = sessionDates[session.id];

      if (!requestedDate) {
        continue;
      }

      for (const existingSession of sessionConfigs) {
        const selection = booking.selections[existingSession.id];

        if (selection?.date === requestedDate && selection.slot) {
          occupied[session.id].push(slotKey(requestedDate, selection.slot));
        }
      }
    }
  }

  return occupied;
}

function getSessionDatesForFirstSessionDate(firstSessionDate: string) {
  return sessionConfigs.reduce((acc, session) => {
    acc[session.id] = getSessionDate(firstSessionDate, session.dayOffset);
    return acc;
  }, {} as SessionDateLookup);
}

function getSessionDatesFromSearchParams(request: NextRequest) {
  return sessionConfigs.reduce((acc, session) => {
    const date = request.nextUrl.searchParams.get(`${session.id}Date`);

    if (date) {
      acc[session.id] = date;
    }

    return acc;
  }, {} as SessionDateLookup);
}

function getSessionDatesForSelections(selections: BookingState) {
  return sessionConfigs.reduce((acc, session) => {
    const date = selections[session.id]?.date;

    if (date) {
      acc[session.id] = date;
    }

    return acc;
  }, {} as SessionDateLookup);
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
  try {
    const tag = getStudyTag(request.nextUrl.searchParams.get("tag"));
    const firstSessionDate =
      request.nextUrl.searchParams.get("firstSessionDate");
    const email = request.nextUrl.searchParams
      .get("email")
      ?.trim()
      .toLowerCase();
    const excludedBookingId =
      request.nextUrl.searchParams.get("excludedBookingId") ?? undefined;
    const view = request.nextUrl.searchParams.get("view");
    const bookings = await readBookings();
    const existingBooking = email ? getBookingForEmail(bookings, email, tag) : null;

    if (view === "all") {
      return NextResponse.json({
        bookings: bookings.filter((booking) => isCompleteBooking(booking)),
      });
    }

    const validFirstSessionDate =
      tag === "sensorimotor-study"
        ? Boolean(
            firstSessionDate &&
              isAllowedSensorimotorFirstSessionDate(firstSessionDate),
          )
        : Boolean(firstSessionDate && isAllowedFirstSessionDate(firstSessionDate));

    if (!validFirstSessionDate && tag !== "sensorimotor-study") {
      return NextResponse.json({
        occupiedSlots: emptyOccupiedSlots(),
        bookingCount: 0,
        existingBooking,
      });
    }

    const sessionDates =
      tag === "sensorimotor-study"
        ? getSessionDatesFromSearchParams(request)
        : getSessionDatesForFirstSessionDate(firstSessionDate ?? "");

    return NextResponse.json({
      occupiedSlots: getOccupiedSlots(
        bookings,
        tag,
        sessionDates,
        excludedBookingId,
      ),
      bookingCount: bookings.filter(
        (booking) =>
          getBookingTag(booking) === tag &&
          booking.firstSessionDate === firstSessionDate,
      ).length,
      existingBooking,
    });
  } catch (error) {
    return NextResponse.json(
      { message: getStorageErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      email?: string;
      tag?: string;
      firstSessionDate?: string;
      selections?: BookingState;
    };
    const tag = getStudyTag(payload.tag);
    const study = getStudyConfig(tag);
    const email = payload.email?.trim().toLowerCase() ?? "";
    const firstSessionDate = payload.firstSessionDate ?? "";
    const selections = payload.selections;

    if (
      !isValidEmail(email) ||
      (tag === "sensorimotor-study"
        ? !isAllowedSensorimotorFirstSessionDate(firstSessionDate)
        : !isAllowedFirstSessionDate(firstSessionDate)) ||
      !selections
    ) {
      return NextResponse.json(
        {
          message:
            tag === "sensorimotor-study"
              ? `Enter a valid email, choose Session 1 on a Monday or Tuesday within the next 8 weeks through ${formatDisplayDate(getLatestBookingDate(8))}, keep the remaining sessions on weekdays in that same week, and choose every session slot.`
              : `Enter a valid email, choose a Monday or Tuesday date within the next 4 weeks through ${formatDisplayDate(getLatestFirstSessionDate())}, and choose every session slot.`,
        },
        { status: 400 },
      );
    }

    const validationError = validateSelections(selections, firstSessionDate, tag);

    if (validationError) {
      return NextResponse.json({ message: validationError }, { status: 400 });
    }

    const bookings = await readBookings();
    const existingBooking = getBookingForEmail(bookings, email, tag);

    if (existingBooking) {
      return NextResponse.json(
        {
          message:
            "This email already has a booking. The saved sessions have been loaded below for editing.",
          existingBooking,
          occupiedSlots: getOccupiedSlots(
            bookings,
            tag,
            getSessionDatesForSelections(selections),
          ),
        },
        { status: 409 },
      );
    }

    const selectedSessionDates = getSessionDatesForSelections(selections);
    const occupiedSlots = getOccupiedSlots(bookings, tag, selectedSessionDates);
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
      tag,
      email,
      firstSessionDate,
      selections,
      createdAt: new Date().toISOString(),
    };

    const updatedBookings = [...bookings, booking];
    await writeBookings(updatedBookings);

    return NextResponse.json(
      {
        message:
          `Booking confirmed. Your selected ${study.confirmationSubject} slots have been saved.`,
        booking,
        occupiedSlots: getOccupiedSlots(
          updatedBookings,
          tag,
          selectedSessionDates,
        ),
        existingBooking: booking,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { message: getStorageErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      id?: string;
      email?: string;
      tag?: string;
      firstSessionDate?: string;
      selections?: BookingState;
    };
  const tag = getStudyTag(payload.tag);
  const study = getStudyConfig(tag);
  const id = payload.id ?? "";
  const email = payload.email?.trim().toLowerCase() ?? "";
  const firstSessionDate = payload.firstSessionDate ?? "";
  const selections = payload.selections;

  if (
    !id ||
    !isValidEmail(email) ||
    (tag === "sensorimotor-study"
      ? !isAllowedSensorimotorFirstSessionDate(firstSessionDate)
      : !isAllowedFirstSessionDate(firstSessionDate)) ||
    !selections
  ) {
    return NextResponse.json(
      {
        message:
          tag === "sensorimotor-study"
            ? `Enter a valid email, choose Session 1 on a Monday or Tuesday within the next 8 weeks through ${formatDisplayDate(getLatestBookingDate(8))}, keep the remaining sessions on weekdays in that same week, and choose every session slot.`
            : `Enter a valid email, choose a Monday or Tuesday date within the next 4 weeks through ${formatDisplayDate(getLatestFirstSessionDate())}, and choose every session slot.`,
      },
      { status: 400 },
    );
  }

  const validationError = validateSelections(selections, firstSessionDate, tag);

  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }

  const bookings = await readBookings();
  const bookingIndex = bookings.findIndex(
    (booking) =>
      booking.id === id &&
      getBookingTag(booking) === tag &&
      booking.email.toLowerCase() === email.toLowerCase(),
  );

  if (bookingIndex === -1) {
    return NextResponse.json(
      { message: "No booking was found for this email to edit." },
      { status: 404 },
    );
  }

  const selectedSessionDates = getSessionDatesForSelections(selections);
  const occupiedSlots = getOccupiedSlots(bookings, tag, selectedSessionDates, id);
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
    tag,
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
    tag,
    booking.id,
  );

    await writeBookings(updatedBookings);

    return NextResponse.json({
      message:
        `Booking updated. Your selected ${study.confirmationSubject} slots have been saved.`,
      booking,
      occupiedSlots: getOccupiedSlots(
        updatedBookings,
        tag,
        selectedSessionDates,
        id,
      ),
      existingBooking: booking,
    });
  } catch (error) {
    return NextResponse.json(
      { message: getStorageErrorMessage(error) },
      { status: 500 },
    );
  }
}
