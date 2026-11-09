import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-black/[0.03]">
        <h1 className="text-2xl font-semibold text-gray-800">Page not found</h1>
        <p className="mt-2 text-sm text-gray-600">
          The page you’re looking for doesn’t exist or may have moved.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-9 items-center justify-center rounded-md bg-[#1877F2] px-4 text-sm font-medium text-white transition-colors hover:bg-[#166FE5]"
        >
          Back to Marketplace
        </Link>
      </div>
    </div>
  );
}
