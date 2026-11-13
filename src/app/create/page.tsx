import Link from "next/link";
import { Car, Home, Layers, Tag } from "lucide-react";

import { Sidebar } from "@/components/layout/sidebar";

const LISTING_TYPES = [
  {
    type: "item",
    title: "Item for sale",
    description: "Sell a single item to someone nearby.",
    icon: Tag,
  },
  {
    type: "multiple",
    title: "Create multiple listings",
    description: "Create one listing at a time in this demo.",
    icon: Layers,
  },
  {
    type: "vehicle",
    title: "Vehicle for sale",
    description: "List a car, truck, or motorcycle.",
    icon: Car,
  },
  {
    type: "home",
    title: "Home for sale or rent",
    description: "List a home, apartment, or room.",
    icon: Home,
  },
] as const;

export default function CreatePage() {
  return (
    <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-6">
      <Sidebar />
      <section className="min-w-0">
        <h1 className="text-2xl font-semibold text-gray-800">
          Choose listing type
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          What are you listing today?
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {LISTING_TYPES.map((listingType) => {
            const Icon = listingType.icon;

            return (
              <Link
                key={listingType.type}
                href={`/create/item?type=${listingType.type}`}
                className="group rounded-xl bg-white p-6 shadow-sm ring-1 ring-black/[0.03] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-brand-ink">
                  <Icon className="h-6 w-6" />
                </span>
                <h2 className="mt-4 text-lg font-semibold text-gray-800 transition-colors group-hover:text-brand-ink">
                  {listingType.title}
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  {listingType.description}
                </p>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
