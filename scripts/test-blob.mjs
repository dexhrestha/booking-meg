import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { get, put } from "@vercel/blob";

const bookingsBlobPath = process.env.BLOB_BOOKINGS_PATH ?? "bookings.json";

async function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const file = await readFile(filePath, "utf8");

  for (const line of file.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex);
    const rawValue = trimmed.slice(separatorIndex + 1);
    const value = rawValue.replace(/^["']|["']$/g, "");

    process.env[key] ??= value;
  }
}

function assertBookingSchema(bookings) {
  if (!Array.isArray(bookings)) {
    throw new Error("Expected Blob bookings value to be an array.");
  }

  for (const booking of bookings) {
    const hasBaseFields =
      typeof booking.id === "string" &&
      typeof booking.email === "string" &&
      typeof booking.firstSessionDate === "string" &&
      typeof booking.createdAt === "string" &&
      booking.selections &&
      typeof booking.selections === "object";

    if (!hasBaseFields) {
      throw new Error("A booking is missing required top-level fields.");
    }

    for (const sessionId of ["session1", "session2", "session3", "session4"]) {
      const selection = booking.selections[sessionId];
      const validSelection =
        selection &&
        typeof selection.day === "string" &&
        typeof selection.date === "string" &&
        typeof selection.slot === "string";

      if (!validSelection) {
        throw new Error(`A booking is missing ${sessionId} day/date/slot.`);
      }
    }
  }
}

async function readBlobJson(pathname) {
  const result = await get(pathname, { access: "private" });

  if (!result || result.statusCode !== 200) {
    throw new Error(`Could not read ${pathname} from Vercel Blob.`);
  }

  const text = await new Response(result.stream).text();

  return JSON.parse(text);
}

await loadEnvFile(".env.local");
await loadEnvFile(".env");

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  throw new Error("Missing BLOB_READ_WRITE_TOKEN.");
}

const localBookings = JSON.parse(await readFile("data/bookings.json", "utf8"));
assertBookingSchema(localBookings);

await put(bookingsBlobPath, JSON.stringify(localBookings, null, 2) + "\n", {
  access: "private",
  allowOverwrite: true,
  contentType: "application/json",
});

const readBack = await readBlobJson(bookingsBlobPath);
assertBookingSchema(readBack);

console.log(
  `Vercel Blob OK: wrote and read ${readBack.length} booking(s) at ${bookingsBlobPath} using the same schema as data/bookings.json.`,
);
