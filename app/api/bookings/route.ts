import { NextRequest, NextResponse } from "next/server";
import {
  BlockedSlotEntry,
  BookingEntry,
  BookingState,
  emptyOccupiedSlotReasons,
  emptyOccupiedSlots,
  formatDisplayDate,
  getBlockedSlotTag,
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
  OccupiedSlotReasons,
  SessionId,
  sessionConfigs,
  SlotBlockReason,
  slotKey,
  StudyTag,
} from "@/lib/booking";
import {
  getStorageErrorMessage,
  readBlockedSlots,
  readBookings,
  writeBookings,
} from "@/lib/bookings-store";
import { getCimecOccupiedSlotKeys } from "@/lib/cimec-calendar";

type SessionDateLookup = Partial<Record<SessionId, string>>;
type OccupiedSlotData = {
  occupiedSlotReasons: OccupiedSlotReasons;
  occupiedSlots: Record<SessionId, string[]>;
};

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
  blockedSlots: BlockedSlotEntry[],
  tag: StudyTag,
  sessionDates: SessionDateLookup,
  excludedBookingId?: string,
) {
  const occupied = emptyOccupiedSlots();
  const occupiedSlotReasons = emptyOccupiedSlotReasons();

  function addOccupiedSlot(
    sessionId: SessionId,
    key: string,
    reason: SlotBlockReason,
  ) {
    if (!occupied[sessionId].includes(key)) {
      occupied[sessionId].push(key);
    }

    if (
      reason === "other-researcher" ||
      !occupiedSlotReasons[sessionId][key]
    ) {
      occupiedSlotReasons[sessionId][key] = reason;
    }
  }

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
          addOccupiedSlot(
            session.id,
            slotKey(requestedDate, selection.slot),
            "unavailable",
          );
        }
      }
    }
  }

  for (const blockedSlot of blockedSlots) {
    if (getBlockedSlotTag(blockedSlot) !== tag) {
      continue;
    }

    for (const session of sessionConfigs) {
      const requestedDate = sessionDates[session.id];

      if (requestedDate === blockedSlot.date) {
        addOccupiedSlot(
          session.id,
          slotKey(blockedSlot.date, blockedSlot.slot),
          "unavailable",
        );
      }
    }
  }

  for (const session of sessionConfigs) {
    const requestedDate = sessionDates[session.id];

    if (!requestedDate) {
      continue;
    }

    for (const key of getCimecOccupiedSlotKeys(tag, requestedDate)) {
      addOccupiedSlot(session.id, key, "other-researcher");
    }
  }

  return {
    occupiedSlotReasons,
    occupiedSlots: occupied,
  } satisfies OccupiedSlotData;
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
    const blockedSlots = await readBlockedSlots();
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
        occupiedSlotReasons: emptyOccupiedSlotReasons(),
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
      ...getOccupiedSlots(
        bookings,
        blockedSlots,
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
              : `Enter a valid email, choose a Thursday date within the next 4 weeks through ${formatDisplayDate(getLatestFirstSessionDate())}, and choose every session slot.`,
        },
        { status: 400 },
      );
    }

    const validationError = validateSelections(selections, firstSessionDate, tag);

    if (validationError) {
      return NextResponse.json({ message: validationError }, { status: 400 });
    }

    const bookings = await readBookings();
    const blockedSlots = await readBlockedSlots();
    const existingBooking = getBookingForEmail(bookings, email, tag);

    if (existingBooking) {
      return NextResponse.json(
        {
          message:
            "This email already has a booking. The saved sessions have been loaded below for editing.",
          existingBooking,
          ...getOccupiedSlots(
            bookings,
            blockedSlots,
            tag,
            getSessionDatesForSelections(selections),
          ),
        },
        { status: 409 },
      );
    }

    const selectedSessionDates = getSessionDatesForSelections(selections);
    const occupiedSlotData = getOccupiedSlots(
      bookings,
      blockedSlots,
      tag,
      selectedSessionDates,
    );
    const conflict = sessionConfigs.find((session) =>
      occupiedSlotData.occupiedSlots[session.id].includes(
        slotKey(selections[session.id].date, selections[session.id].slot),
      ),
    );

    if (conflict) {
      const conflictSelection = selections[conflict.id];

      return NextResponse.json(
        {
          message: `${conflict.title} on ${conflictSelection.day}, ${conflictSelection.date} at ${conflictSelection.slot} is unavailable. Choose another slot.`,
          ...occupiedSlotData,
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
        ...getOccupiedSlots(
          updatedBookings,
          blockedSlots,
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
            : `Enter a valid email, choose a Thursday date within the next 4 weeks through ${formatDisplayDate(getLatestFirstSessionDate())}, and choose every session slot.`,
      },
      { status: 400 },
    );
  }

  const validationError = validateSelections(selections, firstSessionDate, tag);

  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }

  const bookings = await readBookings();
  const blockedSlots = await readBlockedSlots();
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
  const occupiedSlotData = getOccupiedSlots(
    bookings,
    blockedSlots,
    tag,
    selectedSessionDates,
    id,
  );
  const conflict = sessionConfigs.find((session) =>
    occupiedSlotData.occupiedSlots[session.id].includes(
      slotKey(selections[session.id].date, selections[session.id].slot),
    ),
  );

  if (conflict) {
    const conflictSelection = selections[conflict.id];

    return NextResponse.json(
      {
        message: `${conflict.title} on ${conflictSelection.day}, ${conflictSelection.date} at ${conflictSelection.slot} is unavailable. Choose another slot.`,
        ...occupiedSlotData,
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
      ...getOccupiedSlots(
        updatedBookings,
        blockedSlots,
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
