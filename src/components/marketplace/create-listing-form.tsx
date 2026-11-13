"use client";

import { ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORIES, isCategoryName } from "@/lib/categories";
import { CONDITIONS, DEFAULT_CONDITION, isCondition } from "@/lib/conditions";
import { formatPrice } from "@/lib/format";
import {
  INVALID_IMAGE_TYPE_ERROR,
  compressImage,
  isAllowedImageType,
} from "@/lib/image";
import type { Listing } from "@/lib/types";
import { isValidEmail } from "@/lib/validation";

type CreateListingFormProps = {
  initialCategory?: string;
};

type FieldName =
  | "title"
  | "price"
  | "email"
  | "category"
  | "condition"
  | "location"
  | "description"
  | "photo";

type FieldErrors = Partial<Record<FieldName, string>>;

type ValidationFields = {
  title: string;
  description: string;
  price: string;
  category: string;
  condition: string;
  email: string;
  location: string;
};

function validateFields(fields: ValidationFields): FieldErrors {
  const errors: FieldErrors = {};

  const title = fields.title.trim();
  if (title.length < 3 || title.length > 255) {
    errors.title = "Title must be between 3 and 255 characters.";
  }

  if (fields.description.trim().length === 0) {
    errors.description = "Description is required.";
  }

  const price = Number(fields.price);
  if (
    fields.price.trim() === "" ||
    !Number.isFinite(price) ||
    price < 0
  ) {
    errors.price = "Price must be a non-negative number.";
  }

  if (!isCategoryName(fields.category)) {
    errors.category = "Category is invalid.";
  }

  if (!isCondition(fields.condition)) {
    errors.condition = "Condition is invalid.";
  }

  if (!isValidEmail(fields.email.trim())) {
    errors.email = "Seller email is invalid.";
  }

  if (fields.location.trim().length > 255) {
    errors.location = "Location must be 255 characters or fewer.";
  }

  return errors;
}

function previewPrice(value: string): string {
  if (value.trim() === "") {
    return "Price";
  }

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    return "Price";
  }

  return formatPrice(amount);
}

export function CreateListingForm({
  initialCategory,
}: CreateListingFormProps) {
  const router = useRouter();

  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState(() =>
    initialCategory && isCategoryName(initialCategory) ? initialCategory : "",
  );
  const [condition, setCondition] = useState<string>(DEFAULT_CONDITION);
  const [location, setLocation] = useState("Palo Alto, CA");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!photo) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(photo);
    setPreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [photo]);

  function choosePhoto(file: File | null) {
    if (!file) {
      return;
    }

    if (!isAllowedImageType(file.type)) {
      setPhoto(null);
      setErrors((current) => ({
        ...current,
        photo: INVALID_IMAGE_TYPE_ERROR,
      }));
      return;
    }

    setPhoto(file);
    setErrors((current) => {
      const next = { ...current };
      delete next.photo;
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBannerError(null);

    if (!photo) {
      setErrors((current) => ({
        ...current,
        photo: "Add a photo to publish your listing.",
      }));
      return;
    }

    const fieldErrors = validateFields({
      title,
      description,
      price,
      category,
      condition,
      email,
      location,
    });
    setErrors(fieldErrors);

    if (Object.keys(fieldErrors).length > 0) {
      return;
    }

    setSubmitting(true);

    try {
      const compressed = await compressImage(photo);
      const formData = new FormData();
      formData.append("file", compressed);

      const uploadResponse = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const uploadData = (await uploadResponse.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;

      if (!uploadResponse.ok || !uploadData?.url) {
        throw new Error(uploadData?.error ?? "Upload failed");
      }

      const sellerEmail = email.trim().toLowerCase();
      const listingResponse = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          price: Number(price),
          category,
          condition,
          seller_email: sellerEmail,
          image_url: uploadData.url,
          location: location.trim() || "Palo Alto, CA",
        }),
      });
      const listingData = (await listingResponse.json().catch(() => null)) as {
        listing?: Listing;
        error?: string;
      } | null;

      if (!listingResponse.ok || !listingData?.listing) {
        throw new Error(listingData?.error ?? "Failed to create listing");
      }

      try {
        localStorage.setItem("marketplace_seller_email", sellerEmail);
      } catch {
        // Storage can be unavailable in private browsing; publishing still works.
      }

      router.push(`/item/${listingData.listing.id}`);
    } catch (error) {
      setBannerError(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const previewTitle = title.trim() || "Your listing title";
  const previewLocation = location.trim() || "Palo Alto, CA";
  const previewEmail = email.trim() || "you@example.com";

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="min-w-0 space-y-5 rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/[0.03] sm:p-6"
      >
        <h1 className="text-2xl font-semibold text-gray-800">Create listing</h1>

        {bannerError ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {bannerError}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="photo">Photo</Label>
          <label
            htmlFor="photo"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              choosePhoto(event.dataTransfer.files?.[0] ?? null);
            }}
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center transition-colors hover:border-brand hover:bg-blue-50/40"
          >
            <ImagePlus className="h-8 w-8 text-gray-400" />
            <span className="mt-2 max-w-full truncate text-sm font-medium text-gray-700">
              {photo ? photo.name : "Add a photo"}
            </span>
            <span className="mt-1 text-xs text-gray-500">
              JPEG, PNG, or WebP
            </span>
            <input
              id="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => {
                choosePhoto(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
          </label>
          {errors.photo ? (
            <p className="text-xs text-red-600">{errors.photo}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={title}
            maxLength={255}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What are you selling?"
            aria-invalid={Boolean(errors.title)}
          />
          {errors.title ? (
            <p className="text-xs text-red-600">{errors.title}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="price">Price</Label>
          <Input
            id="price"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder="0"
            aria-invalid={Boolean(errors.price)}
          />
          {errors.price ? (
            <p className="text-xs text-red-600">{errors.price}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            aria-invalid={Boolean(errors.email)}
          />
          {errors.email ? (
            <p className="text-xs text-red-600">{errors.email}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <Select
            value={category || undefined}
            onValueChange={(value) => setCategory(value)}
          >
            <SelectTrigger
              id="category"
              aria-invalid={Boolean(errors.category)}
            >
              <SelectValue placeholder="Choose a category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((option) => (
                <SelectItem key={option.slug} value={option.name}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.category ? (
            <p className="text-xs text-red-600">{errors.category}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="condition">Condition</Label>
          <Select
            value={condition}
            onValueChange={(value) => setCondition(value)}
          >
            <SelectTrigger
              id="condition"
              aria-invalid={Boolean(errors.condition)}
            >
              <SelectValue placeholder="Choose a condition" />
            </SelectTrigger>
            <SelectContent>
              {CONDITIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.condition ? (
            <p className="text-xs text-red-600">{errors.condition}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="location">Location</Label>
          <Input
            id="location"
            value={location}
            maxLength={255}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Palo Alto, CA"
            aria-invalid={Boolean(errors.location)}
          />
          {errors.location ? (
            <p className="text-xs text-red-600">{errors.location}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe your item, its condition, and pickup details."
            rows={6}
            aria-invalid={Boolean(errors.description)}
          />
          {errors.description ? (
            <p className="text-xs text-red-600">{errors.description}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
          <p className="mr-auto text-xs text-gray-500">
            Add a photo to enable publishing.
          </p>
          <Button
            type="submit"
            disabled={!photo || submitting}
            className="bg-brand-strong text-white hover:bg-brand-hover"
          >
            {submitting ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </form>

      <aside className="min-w-0 xl:sticky xl:top-20">
        <div className="overflow-hidden rounded-lg bg-white shadow-sm">
          <div className="relative aspect-square bg-gray-100">
            {previewUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={previewUrl}
                alt="Listing preview"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-gray-500">
                Your photo appears here
              </div>
            )}
          </div>
          <div className="space-y-2 p-4">
            <h2 className="line-clamp-2 text-lg font-semibold text-gray-800">
              {previewTitle}
            </h2>
            <p className="text-2xl font-semibold text-gray-800">
              {previewPrice(price)}
            </p>
            <Badge variant="outline">{condition}</Badge>
            <p className="text-xs text-gray-500">
              Listed just now in {previewLocation}
            </p>
            <p className="break-all text-sm text-gray-600">{previewEmail}</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
