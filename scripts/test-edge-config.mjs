import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { get } from "@vercel/edge-config";

const bookingsKey = "bookings";




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

function getEdgeConfigId() {
  if (process.env.EDGE_CONFIG_ID) {
    return process.env.EDGE_CONFIG_ID;
  }

  const connection = process.env.EDGE_CONFIG ?? "";
  const match = connection.match(/\/([^/?]+)(?:\?|$)/);

  return match?.[1] ?? "";
}

function getEdgeConfigApiUrl() {
  const edgeConfigId = getEdgeConfigId();

  if (!edgeConfigId) {
    throw new Error("Missing EDGE_CONFIG or EDGE_CONFIG_ID.");
  }

  const params = new URLSearchParams();

  if (process.env.VERCEL_TEAM_ID) {
    params.set("teamId", process.env.VERCEL_TEAM_ID);
  }

  if (process.env.VERCEL_TEAM_SLUG) {
    params.set("slug", process.env.VERCEL_TEAM_SLUG);
  }

  const query = params.toString();

  return `https://api.vercel.com/v1/edge-config/${edgeConfigId}/items${
    query ? `?${query}` : ""
  }`;
}

function assertBookingSchema(bookings) {
  if (!Array.isArray(bookings)) {
    throw new Error("Expected Edge Config bookings value to be an array.");
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

async function writeBookingsToEdgeConfig(bookings) {
  const token = process.env.VERCEL_OIDC_TOKEN;

  if (!token) {
    throw new Error("Missing VERCEL_OIDC_TOKEN.");
  }

  const response = await fetch(getEdgeConfigApiUrl(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
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
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Edge Config write failed: ${response.status} ${body}`);
  }
}

await loadEnvFile(".env.local");
await loadEnvFile(".env");

const localBookings = JSON.parse(await readFile("data/bookings.json", "utf8"));
assertBookingSchema(localBookings);

await writeBookingsToEdgeConfig(localBookings);

const readBack = await get(bookingsKey);
assertBookingSchema(readBack);




console.log(
  `Edge Config OK: wrote and read ${readBack.length} booking(s) using the same schema as data/bookings.json.`,
);
