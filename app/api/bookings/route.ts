import { after, NextRequest, NextResponse } from "next/server";
import {
  BlockedSlotEntry,
  BookingEntry,
  BookingState,
  emptyOccupiedSlotReasons,
  emptyOccupiedSlots,
  getBlockedSlotTag,
  getBookingTag,
  getScheduleRequirement,
  getSharedLabClashSlotKeys,
  getSessionConfigs,
  getSessionDateForStudy,
  getSlotOptionsForDate,
  getStudyConfig,
  getStudyTag,
  isAllowedStartDate,
  isCompleteBooking,
  isFlexibleDateStudy,
  isValidEmail,
  isValidParticipantName,
  OccupiedSlotReasons,
  SessionId,
  SlotBlockReason,
  slotKey,
  slotsOverlap,
  StudyTag,
  validateSelections,
} from "@/lib/booking";
import {
  getStorageErrorMessage,
  readBlockedSlots,
  readBookings,
  writeBookings,
} from "@/lib/bookings-store";
import { getCimecOccupiedSlotKeys } from "@/lib/cimec-calendar";
import {
  getGoogleBusySlotKeys,
  studyUsesGoogleCalendars,
  syncBookingToGoogleCalendar,
} from "@/lib/google-calendar";

type SessionDateLookup = Partial<Record<SessionId, string>>;
type OccupiedSlotData = {
  occupiedSlotReasons: OccupiedSlotReasons;
  occupiedSlots: Record<SessionId, string[]>;
};

function getInvalidBookingMessage(tag: StudyTag) {
  const weekendRequirement = getStudyConfig(tag).requiresWeekendSessions
    ? " agree to the Saturday and Sunday sessions,"
    : "";

  return `Enter your name and a valid email, accept the eligibility criteria,${weekendRequirement} ${getScheduleRequirement(tag)}, and choose every session slot.`;
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

async function getOccupiedSlots(
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
          for (const slot of getSlotOptionsForDate(tag, requestedDate)) {
            if (slotsOverlap(slot, selection.slot)) {
              addOccupiedSlot(session.id, slotKey(requestedDate, slot), "unavailable");
            }
          }
        }
      }
    }
  }

  for (const blockedSlot of blockedSlots) {
    if (
      getBlockedSlotTag(blockedSlot) !== tag ||
      studyUsesGoogleCalendars(tag)
    ) {
      continue;
    }

    for (const session of getSessionConfigs(tag)) {
      const requestedDate = sessionDates[session.id];

      if (requestedDate === blockedSlot.date) {
        for (const slot of getSlotOptionsForDate(tag, requestedDate)) {
          if (slotsOverlap(slot, blockedSlot.slot)) {
            addOccupiedSlot(session.id, slotKey(requestedDate, slot), "unavailable");
          }
        }
      }
    }
  }

  const googleBusySlotKeys = await getGoogleBusySlotKeys(
    tag,
    Object.values(sessionDates),
  );

  for (const session of getSessionConfigs(tag)) {
    const requestedDate = sessionDates[session.id];

    if (!requestedDate) {
      continue;
    }

    for (const key of googleBusySlotKeys) {
      if (key.startsWith(`${requestedDate}|`)) {
        addOccupiedSlot(session.id, key, "unavailable");
      }
    }

    for (const key of await getCimecOccupiedSlotKeys(tag, requestedDate)) {
      addOccupiedSlot(session.id, key, "other-researcher");
    }

    for (const key of getSharedLabClashSlotKeys(
      bookings,
      tag,
      requestedDate,
      excludedBookingId,
    )) {
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
    acc[session.id] = getSessionDateForStudy(firstSessionDate, session, tag);
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
      ...await getOccupiedSlots(
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
      speaksEnglish?: boolean;
      weekendSessionsAccepted?: boolean;
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
    const speaksEnglish = payload.speaksEnglish === true;
    const weekendSessionsAccepted = payload.weekendSessionsAccepted === true;
    const selections = payload.selections;

    if (
      !isValidParticipantName(name) ||
      !isValidEmail(email) ||
      payload.criteriaAccepted !== true ||
      (study.requiresWeekendSessions && !weekendSessionsAccepted) ||
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
          ...await getOccupiedSlots(
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
    const occupiedSlotData = await getOccupiedSlots(
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
      speaksEnglish,
      ...(study.requiresWeekendSessions ? { weekendSessionsAccepted } : {}),
      firstSessionDate,
      selections,
      criteriaAcceptedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const updatedBookings = [...bookings, booking];
    await writeBookings(updatedBookings);
    after(() => syncBookingToGoogleCalendar(null, booking));

    return NextResponse.json(
      {
        message:
          `Booking confirmed. Your selected ${study.confirmationSubject} slots have been saved.`,
        booking,
        ...await getOccupiedSlots(
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
      speaksEnglish?: boolean;
      weekendSessionsAccepted?: boolean;
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
    const speaksEnglish = payload.speaksEnglish === true;
    const weekendSessionsAccepted = payload.weekendSessionsAccepted === true;
    const selections = payload.selections;

    if (
      !id ||
      !isValidParticipantName(name) ||
      !isValidEmail(email) ||
      payload.criteriaAccepted !== true ||
      (study.requiresWeekendSessions && !weekendSessionsAccepted) ||
      !selections
    ) {
      return NextResponse.json(
        {
          message: getInvalidBookingMessage(tag),
        },
        { status: 400 },
      );
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

    const previousBooking = bookings[bookingIndex];
    if (!isAllowedStartDate(firstSessionDate, tag) &&
      firstSessionDate !== previousBooking.firstSessionDate) {
      return NextResponse.json({ message: getInvalidBookingMessage(tag) }, { status: 400 });
    }
    const validationError = validateSelections(selections, firstSessionDate, tag, previousBooking);
    if (validationError) {
      return NextResponse.json({ message: validationError }, { status: 400 });
    }

    const selectedSessionDates = getSessionDatesForSelections(selections, tag);
    const occupiedSlotData = await getOccupiedSlots(
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
      speaksEnglish,
      ...(study.requiresWeekendSessions ? { weekendSessionsAccepted } : {}),
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

    const removedBookings = bookings.filter(
      (item) =>
        item.id !== booking.id &&
        !updatedBookings.some((updated) => updated.id === item.id),
    );

    after(async () => {
      await syncBookingToGoogleCalendar(previousBooking, booking);
      await Promise.all(
        removedBookings.map((removed) =>
          syncBookingToGoogleCalendar(removed, null),
        ),
      );
    });

    return NextResponse.json({
      message:
        `Booking updated. Your selected ${study.confirmationSubject} slots have been saved.`,
      booking,
      ...await getOccupiedSlots(
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
