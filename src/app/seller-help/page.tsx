import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  CircleDollarSign,
  ClipboardList,
  Mail,
} from "lucide-react";

import { Button } from "@/components/ui/button";

const TIPS = [
  {
    icon: Camera,
    title: "Use clear photos",
    body: "Use natural light and a clean background. Show the item from several angles and photograph any flaws.",
  },
  {
    icon: ClipboardList,
    title: "Describe it honestly",
    body: "Include dimensions, what is included, and any wear. Pick the condition that matches the item's real state.",
  },
  {
    icon: CircleDollarSign,
    title: "Price it fairly",
    body: "Check similar listings before posting. Free listings are welcome too — just set the price to 0.",
  },
  {
    icon: Mail,
    title: "Respond by email",
    body: "Buyers can message you from the listing and see your seller email. Reply from the email you publish with.",
  },
] as const;

export default function SellerHelpPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Marketplace
      </Link>

      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">Seller help</h1>
        <p className="mt-1 text-sm text-gray-600">
          A few tips for a listing that sells.
        </p>

        <ul className="mt-6 space-y-4">
          {TIPS.map((tip) => {
            const Icon = tip.icon;

            return (
              <li key={tip.title} className="flex gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#1877F2]">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-semibold text-gray-900">{tip.title}</h2>
                  <p className="mt-0.5 text-sm leading-6 text-gray-600">
                    {tip.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <h2 className="font-semibold text-gray-900">
            How messaging works
          </h2>
          <p className="mt-1 leading-6">
            Messages sent from a listing are stored with the listing, and the
            seller email shown on each listing is where buyers can reach you.
            No email is sent automatically, so check that inbox for a reply.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            asChild
            className="bg-[#1877F2] text-white hover:bg-[#166FE5]"
          >
            <Link href="/create">Create a listing</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Browse Marketplace</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
