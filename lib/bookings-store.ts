import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { get, put } from "@vercel/blob";
import { BlockedSlotEntry, BookingEntry } from "@/lib/booking";

const bookingsFile = path.join(process.cwd(), "data", "bookings.json");
const blockedSlotsFile = path.join(process.cwd(), "data", "blocked-slots.json");
const bookingsBlobPath = process.env.BLOB_BOOKINGS_PATH ?? "bookings.json";
const blockedSlotsBlobPath =
  process.env.BLOB_BLOCKED_SLOTS_PATH ?? "blocked-slots.json";

function hasBlobToken() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function streamToText(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

async function readBlobJson<T>(blobPath: string): Promise<T[]> {
  try {
    const result = await get(blobPath, { access: "private" });

    if (!result || result.statusCode !== 200) {
      return [];
    }

    const text = await streamToText(result.stream);

    if (!text.trim()) {
      return [];
    }

    return JSON.parse(text) as T[];
  } catch (error) {
    if (error instanceof Error && error.name === "BlobNotFoundError") {
      return [];
    }

    throw error;
  }
}

async function writeBlobJson<T>(blobPath: string, data: T[]) {
  if (!hasBlobToken()) {
    throw new Error("Vercel Blob write not configured (missing BLOB_READ_WRITE_TOKEN).");
  }

  await put(blobPath, JSON.stringify(data, null, 2) + "\n", {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
  });
}

async function readLocalJson<T>(filePath: string): Promise<T[]> {
  try {
    const file = await readFile(filePath, "utf8");
    return JSON.parse(file) as T[];
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeLocalJson<T>(filePath: string, data: T[]) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
}

export async function readBookings(): Promise<BookingEntry[]> {
  if (hasBlobToken()) {
    return readBlobJson<BookingEntry>(bookingsBlobPath);
  }

  return readLocalJson<BookingEntry>(bookingsFile);
}

export async function writeBookings(bookings: BookingEntry[]) {
  if (hasBlobToken()) {
    await writeBlobJson(bookingsBlobPath, bookings);
    return;
  }

  await writeLocalJson(bookingsFile, bookings);
}

export async function readBlockedSlots(): Promise<BlockedSlotEntry[]> {
  if (hasBlobToken()) {
    return readBlobJson<BlockedSlotEntry>(blockedSlotsBlobPath);
  }

  return readLocalJson<BlockedSlotEntry>(blockedSlotsFile);
}

export async function writeBlockedSlots(blockedSlots: BlockedSlotEntry[]) {
  if (hasBlobToken()) {
    await writeBlobJson(blockedSlotsBlobPath, blockedSlots);
    return;
  }

  await writeLocalJson(blockedSlotsFile, blockedSlots);
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
