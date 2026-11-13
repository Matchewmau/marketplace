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
    body: "Open Messages from the top navigation to read buyer messages. Reply from the email address you publish with.",
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

      <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-black/[0.03]">
        <h1 className="text-2xl font-semibold text-gray-800">Seller help</h1>
        <p className="mt-1 text-sm text-gray-600">
          A few tips for a listing that sells.
        </p>

        <ul className="mt-6 space-y-4">
          {TIPS.map((tip) => {
            const Icon = tip.icon;

            return (
              <li key={tip.title} className="flex gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-brand-ink">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-medium text-gray-800">{tip.title}</h2>
                  <p className="mt-0.5 text-sm leading-6 text-gray-600">
                    {tip.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <h2 className="font-medium text-gray-800">
            How messaging works
          </h2>
          <p className="mt-1 leading-6">
            Messages sent from a listing appear in the Messages inbox, tied to
            the email you used when posting. Open it with that same email and
            reply to the buyer&apos;s address. The email is remembered in this
            browser, but anyone who knows it can view these messages. This is
            not an account, and no email is sent automatically.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            asChild
            className="bg-brand-strong text-white hover:bg-brand-hover"
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
