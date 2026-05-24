import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { get } from "@vercel/edge-config";
import { BookingEntry } from "@/lib/booking";

const bookingsFile = path.join(process.cwd(), "data", "bookings.json");
const bookingsKey = "bookings";

/**
 * Extract Edge Config ID from env
 */
function getEdgeConfigId(): string {
  const explicitId = process.env.EDGE_CONFIG_ID;
  if (explicitId) return explicitId;

  const connection = process.env.EDGE_CONFIG ?? "";
  const match = connection.match(/\/([^/?]+)(?:\?|$)/);

  return match?.[1] ?? "";
}

/**
 * Build write config for Edge Config REST API
 */
function getEdgeConfigWriteConfig() {
  const edgeConfigId = getEdgeConfigId();
  const token = process.env.VERCEL_API_TOKEN;

  if (!edgeConfigId || !token) return null;

  const params = new URLSearchParams();

  if (process.env.VERCEL_TEAM_ID) {
    params.set("teamId", process.env.VERCEL_TEAM_ID);
  }

  const query = params.toString();

  return {
    edgeConfigId,
    token,
    url: `https://api.vercel.com/v1/edge-config/${edgeConfigId}/items${
      query ? `?${query}` : ""
    }`,
  };
}

/**
 * READ from Edge Config (SDK - read-only)
 */
async function readEdgeConfigBookings(): Promise<BookingEntry[]> {
  const value = await get<BookingEntry[] | string | null>(bookingsKey);

  if (!value) return [];

  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as BookingEntry[];
    } catch {
      return [];
    }
  }

  return [];
}

/**
 * WRITE to Edge Config (REST API)
 */
async function writeEdgeConfigBookings(bookings: BookingEntry[]) {
  const config = getEdgeConfigWriteConfig();

  if (!config) {
    throw new Error("Edge Config write not configured (missing token or ID).");
  }

  const response = await fetch(config.url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [
        {
          operation: "upsert",
          key: bookingsKey,
          value: bookings,
        },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Edge Config write failed: ${text}`);
  }
}

/**
 * LOCAL fallback read
 */
async function readLocalBookings(): Promise<BookingEntry[]> {
  try {
    const file = await readFile(bookingsFile, "utf8");
    return JSON.parse(file) as BookingEntry[];
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

/**
 * LOCAL fallback write
 */
async function writeLocalBookings(bookings: BookingEntry[]) {
  await mkdir(path.dirname(bookingsFile), { recursive: true });
  await writeFile(bookingsFile, JSON.stringify(bookings, null, 2) + "\n");
}

/**
 * PUBLIC READ API
 */
export async function readBookings(): Promise<BookingEntry[]> {
  if (process.env.EDGE_CONFIG) {
    return readEdgeConfigBookings();
  }

  return readLocalBookings();
}

/**
 * PUBLIC WRITE API
 */
export async function writeBookings(bookings: BookingEntry[]) {
  const writeConfig = getEdgeConfigWriteConfig();

  if (writeConfig) {
    await writeEdgeConfigBookings(bookings);
    return;
  }

  await writeLocalBookings(bookings);
}

/**
 * ERROR NORMALIZATION
 */
export function getStorageErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if ("code" in error) {
      const code = (error as any).code;

      if (["EROFS", "EACCES", "EPERM"].includes(code)) {
        return "Storage is not writable in this environment. Configure Edge Config credentials.";
      }
    }

    if (error.message.includes("Edge Config")) {
      return "Edge Config is not configured correctly. Check VERCEL_API_TOKEN and EDGE_CONFIG_ID.";
    }
  }

  return "Storage operation failed. Please try again.";
}