"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type ImageWithFallbackProps = {
  src?: string | null;
  alt: string;
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
  className?: string;
  priority?: boolean;
};

export function ImageWithFallback({
  src,
  alt,
  fill,
  width,
  height,
  sizes,
  className,
  priority,
}: ImageWithFallbackProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const resolvedSrc = !src || failed ? "/placeholder.svg" : src;

  if (fill) {
    return (
      <Image
        src={resolvedSrc}
        alt={alt}
        fill
        sizes={sizes ?? "100vw"}
        className={className}
        priority={priority}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <Image
      src={resolvedSrc}
      alt={alt}
      width={width ?? 400}
      height={height ?? 400}
      sizes={sizes}
      className={className}
      priority={priority}
      onError={() => setFailed(true)}
    />
  );
}
