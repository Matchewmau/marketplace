import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { supabase } from "@/lib/supabase";

const MAX_FILE_SIZE = 4 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const INVALID_FILE_ERROR = "Choose a JPEG, PNG, or WebP image.";

export async function POST(request: Request) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: INVALID_FILE_ERROR },
      { status: 400 },
    );
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: INVALID_FILE_ERROR },
      { status: 400 },
    );
  }

  const extension = EXTENSIONS[file.type];

  if (!extension) {
    return NextResponse.json(
      { error: INVALID_FILE_ERROR },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "Image must be 4 MB or smaller." },
      { status: 413 },
    );
  }

  try {
    const path = `${randomUUID()}.${extension}`;
    const { error } = await supabase.storage
      .from("listing-images")
      .upload(path, file, { contentType: file.type });

    if (error) {
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    const { data } = supabase.storage
      .from("listing-images")
      .getPublicUrl(path);

    return NextResponse.json({ url: data.publicUrl }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
