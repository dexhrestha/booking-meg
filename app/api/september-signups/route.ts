import { NextRequest, NextResponse } from "next/server";
import { isValidEmail } from "@/lib/booking";
import { getStorageErrorMessage } from "@/lib/bookings-store";
import {
  readSeptemberSignups,
  SeptemberSignup,
  writeSeptemberSignups,
} from "@/lib/september-signups-store";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as { email?: string };
    const email = payload.email?.trim().toLowerCase() ?? "";

    if (!isValidEmail(email)) {
      return NextResponse.json(
        { message: "Enter a valid email address." },
        { status: 400 },
      );
    }

    const signups = await readSeptemberSignups();
    const alreadySignedUp = signups.some((signup) => signup.email === email);

    if (!alreadySignedUp) {
      const signup: SeptemberSignup = {
        id: crypto.randomUUID(),
        email,
        createdAt: new Date().toISOString(),
      };
      await writeSeptemberSignups([...signups, signup]);
    }

    return NextResponse.json(
      { message: "You’re on the list. See you in September!" },
      { status: alreadySignedUp ? 200 : 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { message: getStorageErrorMessage(error) },
      { status: 500 },
    );
  }
}
