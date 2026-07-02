import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import path from "path";
import { get, put } from "@vercel/blob";
import { BlockedSlotEntry, BookingEntry } from "@/lib/booking";

const bookingsFile = path.join(process.cwd(), "data", "bookings.json");
const blockedSlotsFile = path.join(process.cwd(), "data", "blocked-slots.json");
const dataDirectory = path.join(process.cwd(), "data");
const bookingsBlobPath = process.env.BLOB_BOOKINGS_PATH ?? "bookings.json";
const blockedSlotsBlobPath =
  process.env.BLOB_BLOCKED_SLOTS_PATH ?? "blocked-slots.json";
const blockedSlotsLocalFilePattern = /^blocked[-_]slots.*\.json$/i;

function hasBlobToken() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function isVercelDeployment() {
  return process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "development";
}

function shouldUseBlobStorage() {
  return isVercelDeployment();
}

async function streamToText(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

async function readBlobJson<T>(blobPath: string): Promise<T[]> {
  if (!hasBlobToken()) {
    throw new Error("Vercel Blob read not configured (missing BLOB_READ_WRITE_TOKEN).");
  }

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

async function readLocalJsonFiles<T>(
  directoryPath: string,
  filePattern: RegExp,
): Promise<T[]> {
  try {
    const fileNames = await readdir(directoryPath);
    const matchingFilePaths = fileNames
      .filter((fileName) => filePattern.test(fileName))
      .sort()
      .map((fileName) => path.join(directoryPath, fileName));

    const data = await Promise.all(
      matchingFilePaths.map((filePath) => readLocalJson<T>(filePath)),
    );

    return data.flat();
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
  if (shouldUseBlobStorage()) {
    return readBlobJson<BookingEntry>(bookingsBlobPath);
  }

  return readLocalJson<BookingEntry>(bookingsFile);
}

export async function writeBookings(bookings: BookingEntry[]) {
  if (shouldUseBlobStorage()) {
    await writeBlobJson(bookingsBlobPath, bookings);
    return;
  }

  await writeLocalJson(bookingsFile, bookings);
}

export async function readBlockedSlots(): Promise<BlockedSlotEntry[]> {
  if (shouldUseBlobStorage()) {
    return readBlobJson<BlockedSlotEntry>(blockedSlotsBlobPath);
  }

  return readLocalJsonFiles<BlockedSlotEntry>(
    dataDirectory,
    blockedSlotsLocalFilePattern,
  );
}

export async function writeBlockedSlots(blockedSlots: BlockedSlotEntry[]) {
  if (shouldUseBlobStorage()) {
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
