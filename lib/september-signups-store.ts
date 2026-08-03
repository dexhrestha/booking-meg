import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { get, put } from "@vercel/blob";

export type SeptemberSignup = {
  id: string;
  email: string;
  createdAt: string;
};

const localFile = path.join(process.cwd(), "data", "september-signups.json");
const blobPath =
  process.env.BLOB_SEPTEMBER_SIGNUPS_PATH ?? "september-signups.json";

function shouldUseBlobStorage() {
  return process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "development";
}

async function readLocalSignups() {
  try {
    const file = await readFile(localFile, "utf8");
    return JSON.parse(file) as SeptemberSignup[];
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeLocalSignups(signups: SeptemberSignup[]) {
  await mkdir(path.dirname(localFile), { recursive: true });
  await writeFile(localFile, JSON.stringify(signups, null, 2) + "\n");
}

async function readBlobSignups() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Vercel Blob read not configured (missing BLOB_READ_WRITE_TOKEN).");
  }

  try {
    const result = await get(blobPath, { access: "private" });

    if (!result || result.statusCode !== 200) return [];

    const text = await new Response(result.stream).text();
    return text.trim() ? (JSON.parse(text) as SeptemberSignup[]) : [];
  } catch (error) {
    if (error instanceof Error && error.name === "BlobNotFoundError") return [];
    throw error;
  }
}

async function writeBlobSignups(signups: SeptemberSignup[]) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Vercel Blob write not configured (missing BLOB_READ_WRITE_TOKEN).");
  }

  await put(blobPath, JSON.stringify(signups, null, 2) + "\n", {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function readSeptemberSignups() {
  return shouldUseBlobStorage() ? readBlobSignups() : readLocalSignups();
}

export async function writeSeptemberSignups(signups: SeptemberSignup[]) {
  if (shouldUseBlobStorage()) {
    await writeBlobSignups(signups);
    return;
  }

  await writeLocalSignups(signups);
}
