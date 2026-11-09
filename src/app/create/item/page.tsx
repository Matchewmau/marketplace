"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Sidebar } from "@/components/layout/sidebar";
import { CreateListingForm } from "@/components/marketplace/create-listing-form";

function CreateItemPageContent() {
  const searchParams = useSearchParams();
  const type = searchParams.get("type");
  const initialCategory =
    type === "vehicle"
      ? "Vehicles"
      : type === "home"
        ? "Property Rentals"
        : undefined;

  return <CreateListingForm initialCategory={initialCategory} />;
}

export default function CreateItemPage() {
  return (
    <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-6">
      <Sidebar />
      <Suspense
        fallback={
          <div className="min-w-0 rounded-lg bg-white p-6 text-sm text-gray-500 shadow-sm">
            Loading form…
          </div>
        }
      >
        <CreateItemPageContent />
      </Suspense>
    </div>
  );
}
