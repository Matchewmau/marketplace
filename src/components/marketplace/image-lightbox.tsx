"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { ImageWithFallback } from "@/components/marketplace/image-with-fallback";

type ImageLightboxProps = {
  open: boolean;
  src: string | null;
  alt: string;
  onClose: () => void;
};

export function ImageLightbox({
  open,
  src,
  alt,
  onClose,
}: ImageLightboxProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);

  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        closeButtonRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} — full screen preview`}
      className="fixed inset-0 z-[60] flex animate-in fade-in items-center justify-center bg-black/90 p-4 backdrop-blur-sm duration-150 motion-reduce:animate-none sm:p-8"
      onClick={() => onCloseRef.current()}
    >
      <button
        ref={closeButtonRef}
        type="button"
        aria-label="Close full screen image"
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:right-6 sm:top-6"
        onClick={(event) => {
          event.stopPropagation();
          onCloseRef.current();
        }}
      >
        <X className="h-5 w-5" />
      </button>

      <div
        className="relative h-[82vh] w-full max-w-6xl animate-in zoom-in-95 duration-150 motion-reduce:animate-none"
        onClick={(event) => event.stopPropagation()}
      >
        <ImageWithFallback
          src={src}
          alt={alt}
          fill
          sizes="100vw"
          className="object-contain"
        />
      </div>

      <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 text-xs text-white/70">
        Press Esc to close
      </p>
    </div>
  );
}
