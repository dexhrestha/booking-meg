import { readFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

const allowedFlyers = new Set(["flyer_eye_ric.png"]);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;

  if (!allowedFlyers.has(file)) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const flyerPath = path.join(process.cwd(), "assets", file);
    const flyer = await readFile(flyerPath);

    return new NextResponse(flyer, {
      headers: {
        "Content-Type": "image/png",
      },
    });
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return new NextResponse(null, { status: 404 });
    }

    throw error;
  }
}
