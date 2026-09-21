import { NextRequest, NextResponse } from "next/server";
import { getStudyConfig, getStudyTag } from "@/lib/booking";
import {
  getStorageErrorMessage,
  readBlockedSlots,
  readBookings,
} from "@/lib/bookings-store";
import { buildExperimentIcsCalendar } from "@/lib/ics-calendar";
import {
  authorizeAdminRequest,
  unauthorizedAdminResponse,
} from "@/lib/admin-auth";

function getCalendarFeedToken() {
  return process.env.CALENDAR_FEED_TOKEN ?? "";
}

function isAuthorized(request: NextRequest) {
  return authorizeAdminRequest(request, [getCalendarFeedToken()]).authorized;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tag: string }> },
) {
  if (!isAuthorized(request)) {
    return unauthorizedAdminResponse();
  }

  try {
    const { tag: rawTag } = await context.params;
    const tag = getStudyTag(rawTag);
    const study = getStudyConfig(tag);
    const bookings = await readBookings();
    const blockedSlots = await readBlockedSlots();
    const startDate = request.nextUrl.searchParams.get("startDate") ?? undefined;
    const endDate = request.nextUrl.searchParams.get("endDate") ?? undefined;
    const ics = buildExperimentIcsCalendar(
      bookings,
      blockedSlots,
      tag,
      startDate,
      endDate,
    );
    const filename = `${tag}-calendar.ics`;

    return new NextResponse(ics, {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Calendar-Name": study.title,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { message: getStorageErrorMessage(error) },
      { status: 500 },
    );
  }
}
