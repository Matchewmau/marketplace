export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const INVALID_IMAGE_TYPE_ERROR =
  "Choose a JPEG, PNG, or WebP image.";

const DECODE_ERROR =
  "Could not read that image. Try a different JPEG, PNG, or WebP file.";
const PROCESS_ERROR = "Could not process that image. Try a different photo.";

export function isAllowedImageType(type: string): type is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}

type Drawable = ImageBitmap | HTMLImageElement;

function isImageBitmap(value: Drawable): value is ImageBitmap {
  return typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap;
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(DECODE_ERROR));
    };

    image.src = objectUrl;
  });
}

async function decodeImage(file: File): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the HTMLImageElement decoder below.
    }
  }

  try {
    return await loadImageElement(file);
  } catch {
    throw new Error(DECODE_ERROR);
  }
}

export async function compressImage(
  file: File,
  maxEdge = 1600,
  quality = 0.82,
): Promise<File> {
  if (!isAllowedImageType(file.type)) {
    throw new Error(INVALID_IMAGE_TYPE_ERROR);
  }

  const source = await decodeImage(file);

  try {
    const width = isImageBitmap(source)
      ? source.width
      : source.naturalWidth || source.width;
    const height = isImageBitmap(source)
      ? source.height
      : source.naturalHeight || source.height;

    if (!width || !height) {
      throw new Error(DECODE_ERROR);
    }

    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error(PROCESS_ERROR);
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(source, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", quality);
    });

    if (!blob) {
      throw new Error(PROCESS_ERROR);
    }

    const baseName =
      file.name.replace(/\.[^./\\]+$/, "").trim() || "listing-photo";

    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } finally {
    if (isImageBitmap(source)) {
      source.close();
    }
  }
}
