import { after, NextRequest, NextResponse } from "next/server";
import {
  BlockedSlotEntry,
  BookingEntry,
  formatDisplayDate,
  getBlockedSlotTag,
  getBookingTag,
  getScheduleRequirement,
  getSharedLabClashSlotKeys,
  getSessionConfigs,
  getSlotOptions,
  getStudyTag,
  isAllowedStartDate,
  isCompleteBooking,
  isValidEmail,
  isValidIsoDate,
  isValidParticipantName,
  slotKey,
  StudyTag,
  validateSelections,
} from "@/lib/booking";
import {
  getStorageErrorMessage,
  readBlockedSlots,
  readBookings,
  writeBlockedSlots,
  writeBookings,
} from "@/lib/bookings-store";
import { getCimecBlockedSlots } from "@/lib/cimec-calendar";
import { syncBookingToGoogleCalendar } from "@/lib/google-calendar";
import {
  authorizeAdminRequest,
  createAdminSessionToken,
  unauthorizedAdminResponse,
} from "@/lib/admin-auth";

function getInvalidBookingMessage(tag: StudyTag) {
  return `Enter a name and a valid email, ${getScheduleRequirement(tag)}, and choose every session slot.`;
}

function isCompleteBlockedSlot(blockedSlot: BlockedSlotEntry) {
  const tag = getBlockedSlotTag(blockedSlot);

  return Boolean(
    blockedSlot.id &&
      isValidIsoDate(blockedSlot.date) &&
      getSlotOptions(tag).includes(blockedSlot.slot),
  );
}

function getAdminPayload(
  bookings: BookingEntry[],
  blockedSlots: BlockedSlotEntry[],
) {
  return {
    bookings: bookings.filter((booking) => isCompleteBooking(booking)),
    blockedSlots: blockedSlots.filter((blockedSlot) =>
      isCompleteBlockedSlot(blockedSlot),
    ),
    cimecBlockedSlots: getCimecBlockedSlots(),
  };
}

export async function GET(request: NextRequest) {
  const auth = authorizeAdminRequest(request);

  if (!auth.authorized) {
    return unauthorizedAdminResponse();
  }

  try {
    const bookings = await readBookings();
    const blockedSlots = await readBlockedSlots();

    return NextResponse.json({
      ...getAdminPayload(bookings, blockedSlots),
      adminSessionToken:
        auth.method === "totp" ? createAdminSessionToken() : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { message: getStorageErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!authorizeAdminRequest(request).authorized) {
    return unauthorizedAdminResponse();
  }

  try {
    const payload = (await request.json()) as {
      blockedSlot?: {
        tag?: string;
        date?: string;
        slot?: string;
        note?: string;
      };
    };
    const input = payload.blockedSlot;
    const tag = getStudyTag(input?.tag);
    const date = input?.date ?? "";
    const slot = input?.slot ?? "";
    const note = input?.note?.trim() ?? "";

    if (!input || !isValidIsoDate(date) || !getSlotOptions(tag).includes(slot)) {
      return NextResponse.json(
        { message: "Choose a study, date, and valid slot to block." },
        { status: 400 },
      );
    }

    const bookings = await readBookings();
    const blockedSlots = await readBlockedSlots();
    const alreadyBlocked = blockedSlots.some(
      (blockedSlot) =>
        getBlockedSlotTag(blockedSlot) === tag &&
        blockedSlot.date === date &&
        blockedSlot.slot === slot,
    );

    if (alreadyBlocked) {
      return NextResponse.json(
        { message: "That slot is already blocked." },
        { status: 409 },
      );
    }

    const bookedSlot = bookings.some(
      (booking) =>
        getBookingTag(booking) === tag &&
        getSessionConfigs(tag).some((session) => {
          const selection = booking.selections?.[session.id];

          return selection?.date === date && selection?.slot === slot;
        }),
    );

    if (bookedSlot) {
      return NextResponse.json(
        { message: "That slot already has a participant booking." },
        { status: 409 },
      );
    }

    const blockedSlot: BlockedSlotEntry = {
      id: crypto.randomUUID(),
      tag,
      date,
      slot,
      note: note || undefined,
      createdAt: new Date().toISOString(),
    };
    const updatedBlockedSlots = [...blockedSlots, blockedSlot];

    await writeBlockedSlots(updatedBlockedSlots);

    return NextResponse.json(
      {
        message: "Slot blocked.",
        ...getAdminPayload(bookings, updatedBlockedSlots),
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
  if (!authorizeAdminRequest(request).authorized) {
    return unauthorizedAdminResponse();
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
    const name = booking.name?.trim() ?? "";
    const tag = getStudyTag(booking.tag);

  if (
    !booking.id ||
    !isValidParticipantName(name) ||
    !isValidEmail(email) ||
    !isAllowedStartDate(booking.firstSessionDate, tag)
  ) {
    return NextResponse.json(
      {
        message: getInvalidBookingMessage(tag),
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
    const blockedSlots = await readBlockedSlots();
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

  const conflict = getSessionConfigs(tag).find((session) =>
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
        getSessionConfigs(tag).some((requestedSession) => {
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

  const labClash = getSessionConfigs(tag).find((session) => {
    const selection = booking.selections[session.id];

    return getSharedLabClashSlotKeys(
      bookings,
      tag,
      selection.date,
      booking.id,
    ).includes(slotKey(selection.date, selection.slot));
  });

  if (labClash) {
    const selection = booking.selections[labClash.id];

    return NextResponse.json(
      {
        message: `${labClash.title} on ${selection.day}, ${selection.date} at ${selection.slot} overlaps another experiment in the same lab.`,
      },
      { status: 409 },
    );
  }

  const blockedConflict = blockedSlots.find(
    (blockedSlot) =>
      getBlockedSlotTag(blockedSlot) === tag &&
      getSessionConfigs(tag).some((session) => {
        const selection = booking.selections[session.id];

        return (
          selection?.date === blockedSlot.date &&
          selection?.slot === blockedSlot.slot
        );
      }),
  );

  if (blockedConflict) {
    return NextResponse.json(
      {
        message: `${formatDisplayDate(blockedConflict.date)} at ${blockedConflict.slot} is blocked.`,
      },
      { status: 409 },
    );
  }

  const updatedBooking: BookingEntry = {
    ...bookings[bookingIndex],
    tag,
    name,
    email,
    speaksEnglish: booking.speaksEnglish === true,
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

    const previousBooking = bookings[bookingIndex];
    after(() => syncBookingToGoogleCalendar(previousBooking, updatedBooking));

    return NextResponse.json({
      message: "Booking updated.",
      ...getAdminPayload(updatedBookings, blockedSlots),
    });
  } catch (error) {
    return NextResponse.json(
      { message: getStorageErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!authorizeAdminRequest(request).authorized) {
    return unauthorizedAdminResponse();
  }

  try {
    const payload = (await request.json()) as {
      id?: string;
      blockedSlotId?: string;
    };
    const blockedSlotId = payload.blockedSlotId ?? "";
    const id = payload.id ?? "";

    if (!id && !blockedSlotId) {
      return NextResponse.json(
        { message: "Choose a booking or blocked slot to remove." },
        { status: 400 },
      );
    }

    const bookings = await readBookings();
    const blockedSlots = await readBlockedSlots();
    const updatedBookings = id
      ? bookings.filter((booking) => booking.id !== id)
      : bookings;
    const updatedBlockedSlots = blockedSlotId
      ? blockedSlots.filter((blockedSlot) => blockedSlot.id !== blockedSlotId)
      : blockedSlots;

    if (id) {
      await writeBookings(updatedBookings);

      const removedBooking = bookings.find((booking) => booking.id === id);

      if (removedBooking) {
        after(() => syncBookingToGoogleCalendar(removedBooking, null));
      }
    }

    if (blockedSlotId) {
      await writeBlockedSlots(updatedBlockedSlots);
    }

    return NextResponse.json({
      message: blockedSlotId ? "Blocked slot removed." : "Booking removed.",
      ...getAdminPayload(updatedBookings, updatedBlockedSlots),
    });
  } catch (error) {
    return NextResponse.json(
      { message: getStorageErrorMessage(error) },
      { status: 500 },
    );
  }
}
