import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { get, put } from "@vercel/blob";
import { BookingEntry } from "@/lib/booking";

const bookingsFile = path.join(process.cwd(), "data", "bookings.json");
const bookingsBlobPath = process.env.BLOB_BOOKINGS_PATH ?? "bookings.json";

function hasBlobToken() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function streamToText(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

async function readBlobBookings(): Promise<BookingEntry[]> {
  try {
    const result = await get(bookingsBlobPath, { access: "private" });

    if (!result || result.statusCode !== 200) {
      return [];
    }

    const text = await streamToText(result.stream);

    if (!text.trim()) {
      return [];
    }

    return JSON.parse(text) as BookingEntry[];
  } catch (error) {
    if (error instanceof Error && error.name === "BlobNotFoundError") {
      return [];
    }

    throw error;
  }
}

async function writeBlobBookings(bookings: BookingEntry[]) {
  if (!hasBlobToken()) {
    throw new Error("Vercel Blob write not configured (missing BLOB_READ_WRITE_TOKEN).");
  }

  await put(bookingsBlobPath, JSON.stringify(bookings, null, 2) + "\n", {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
  });
}

async function readLocalBookings(): Promise<BookingEntry[]> {
  try {
    const file = await readFile(bookingsFile, "utf8");
    return JSON.parse(file) as BookingEntry[];
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeLocalBookings(bookings: BookingEntry[]) {
  await mkdir(path.dirname(bookingsFile), { recursive: true });
  await writeFile(bookingsFile, JSON.stringify(bookings, null, 2) + "\n");
}

export async function readBookings(): Promise<BookingEntry[]> {
  if (hasBlobToken()) {
    return readBlobBookings();
  }

  return readLocalBookings();
}

export async function writeBookings(bookings: BookingEntry[]) {
  if (hasBlobToken()) {
    await writeBlobBookings(bookings);
    return;
  }

  await writeLocalBookings(bookings);
}

export function getStorageErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if ("code" in error) {
      const code = (error as any).code;

      if (["EROFS", "EACCES", "EPERM"].includes(code)) {
        return "Storage is not writable in this environment. Configure Vercel Blob.";
      }
    }

    if (error.message.includes("Vercel Blob") || error.name.includes("Blob")) {
      return "Vercel Blob is not configured correctly. Check BLOB_READ_WRITE_TOKEN.";
    }
  }

  return "Storage operation failed. Please try again.";
}
