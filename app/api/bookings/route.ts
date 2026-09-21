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
  getEarliestBookingDate,
  getLatestBookingDate,
  getLatestFirstSessionDate,
  getSessionConfigs,
  getSessionDate,
  getSessionDayOffset,
  getSessionDay,
  getSlotOptions,
  getStudyConfig,
  getStudyTag,
  isAllowedEyeTrackingDate,
  isAllowedSensorimotorFirstSessionDate,
  isAllowedFirstSessionDate,
  isSameOrAfterDate,
  isWithinSameWeek,
  isWeekdayDate,
  isValidEmail,
  isValidParticipantName,
  OccupiedSlotReasons,
  SessionId,
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
  const bookingTag = getBookingTag(booking);

  return Boolean(
    (!tag || bookingTag === tag) &&
      booking.id &&
      booking.email &&
    booking.firstSessionDate &&
    booking.selections &&
    getSessionConfigs(bookingTag).every((session) => {
      const selection = booking.selections[session.id];
      return selection?.day && selection?.date && selection?.slot;
    })
  );
}

function isFlexibleDateStudy(tag: StudyTag) {
  return tag === "sensorimotor-study";
}

function isAllowedStartDate(firstSessionDate: string, tag: StudyTag) {
  if (tag === "sensorimotor-study") {
    return isAllowedSensorimotorFirstSessionDate(firstSessionDate);
  }

  if (tag === "eye-track-monpath") {
    return isAllowedEyeTrackingDate(firstSessionDate);
  }

  return isAllowedFirstSessionDate(firstSessionDate);
}

function getInvalidBookingMessage(tag: StudyTag) {
  if (tag === "sensorimotor-study") {
    return `Enter your name and a valid email, accept the eligibility criteria, choose Session 1 on a Monday or Tuesday between ${formatDisplayDate(getEarliestBookingDate())} and ${formatDisplayDate(getLatestBookingDate(8))}, keep the remaining sessions on weekdays in that same week, and choose every session slot.`;
  }

  if (tag === "eye-track-monpath") {
    return `Enter your name and a valid email, accept the eligibility criteria, choose a Monday first-session date between ${formatDisplayDate(getEarliestBookingDate())} and ${formatDisplayDate(getLatestBookingDate(8))}, and choose every session slot.`;
  }

  return `Enter your name and a valid email, accept the eligibility criteria, choose a Thursday date between ${formatDisplayDate(getEarliestBookingDate())} and ${formatDisplayDate(getLatestFirstSessionDate())}, and choose every session slot.`;
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

    for (const session of getSessionConfigs(tag)) {
      const requestedDate = sessionDates[session.id];

      if (!requestedDate) {
        continue;
      }

      for (const existingSession of getSessionConfigs(tag)) {
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

    for (const session of getSessionConfigs(tag)) {
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

  for (const session of getSessionConfigs(tag)) {
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

function getSessionDatesForFirstSessionDate(
  firstSessionDate: string,
  tag: StudyTag,
) {
  return getSessionConfigs(tag).reduce((acc, session) => {
    acc[session.id] = getSessionDate(
      firstSessionDate,
      getSessionDayOffset(session, tag),
    );
    return acc;
  }, {} as SessionDateLookup);
}

function getSessionDatesFromSearchParams(request: NextRequest, tag: StudyTag) {
  return getSessionConfigs(tag).reduce((acc, session) => {
    const date = request.nextUrl.searchParams.get(`${session.id}Date`);

    if (date) {
      acc[session.id] = date;
    }

    return acc;
  }, {} as SessionDateLookup);
}

function getSessionDatesForSelections(selections: BookingState, tag: StudyTag) {
  return getSessionConfigs(tag).reduce((acc, session) => {
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
  const studySessions = getSessionConfigs(tag);

  for (const session of studySessions) {
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
              selections[studySessions[studySessions.indexOf(session) - 1].id]
                .date,
            );
    } else {
      validDay =
        selection?.day ===
        getSessionDay(firstSessionDate, getSessionDayOffset(session, tag));
      validDate =
        selection?.date ===
        getSessionDate(firstSessionDate, getSessionDayOffset(session, tag));
    }

    if (!validDay || !validDate || !validSlot) {
      return `${session.title} has an invalid day, date, or slot.`;
    }
  }

  const duplicateSelection = studySessions.find((session, index) =>
    studySessions.slice(0, index).some((previousSession) => {
      const current = selections[session.id];
      const previous = selections[previousSession.id];

      return current.date === previous.date && current.slot === previous.slot;
    }),
  );

  if (duplicateSelection) {
    return `${duplicateSelection.title} uses a date and time already selected for an earlier session.`;
  }

  if (
    isFlexibleDateStudy(tag) &&
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

    const validFirstSessionDate = Boolean(
      firstSessionDate && isAllowedStartDate(firstSessionDate, tag),
    );

    if (!validFirstSessionDate && !isFlexibleDateStudy(tag)) {
      return NextResponse.json({
        occupiedSlotReasons: emptyOccupiedSlotReasons(),
        occupiedSlots: emptyOccupiedSlots(),
        bookingCount: 0,
        existingBooking,
      });
    }

    const sessionDates =
      isFlexibleDateStudy(tag)
        ? getSessionDatesFromSearchParams(request, tag)
        : getSessionDatesForFirstSessionDate(firstSessionDate ?? "", tag);

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
      name?: string;
      criteriaAccepted?: boolean;
      tag?: string;
      firstSessionDate?: string;
      selections?: BookingState;
    };
    const tag = getStudyTag(payload.tag);
    const study = getStudyConfig(tag);
    const name = payload.name?.trim() ?? "";
    const email = payload.email?.trim().toLowerCase() ?? "";
    const firstSessionDate = payload.firstSessionDate ?? "";
    const selections = payload.selections;

    if (
      !isValidParticipantName(name) ||
      !isValidEmail(email) ||
      payload.criteriaAccepted !== true ||
      !isAllowedStartDate(firstSessionDate, tag) ||
      !selections
    ) {
      return NextResponse.json(
        {
          message: getInvalidBookingMessage(tag),
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
            getSessionDatesForSelections(selections, tag),
          ),
        },
        { status: 409 },
      );
    }

    const selectedSessionDates = getSessionDatesForSelections(selections, tag);
    const occupiedSlotData = getOccupiedSlots(
      bookings,
      blockedSlots,
      tag,
      selectedSessionDates,
    );
    const conflict = getSessionConfigs(tag).find((session) =>
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
      name,
      email,
      firstSessionDate,
      selections,
      criteriaAcceptedAt: new Date().toISOString(),
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
      name?: string;
      criteriaAccepted?: boolean;
      tag?: string;
      firstSessionDate?: string;
      selections?: BookingState;
    };
  const tag = getStudyTag(payload.tag);
  const study = getStudyConfig(tag);
  const id = payload.id ?? "";
  const name = payload.name?.trim() ?? "";
  const email = payload.email?.trim().toLowerCase() ?? "";
  const firstSessionDate = payload.firstSessionDate ?? "";
  const selections = payload.selections;

  if (
    !id ||
    !isValidParticipantName(name) ||
    !isValidEmail(email) ||
    payload.criteriaAccepted !== true ||
    !isAllowedStartDate(firstSessionDate, tag) ||
    !selections
  ) {
    return NextResponse.json(
      {
        message: getInvalidBookingMessage(tag),
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

  const selectedSessionDates = getSessionDatesForSelections(selections, tag);
  const occupiedSlotData = getOccupiedSlots(
    bookings,
    blockedSlots,
    tag,
    selectedSessionDates,
    id,
  );
  const conflict = getSessionConfigs(tag).find((session) =>
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
    name,
    email,
    firstSessionDate,
    selections,
    criteriaAcceptedAt: new Date().toISOString(),
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
