"use client";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ reset }: ErrorPageProps) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          We couldn’t load this page. Please try again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex h-9 items-center justify-center rounded-md bg-[#1877F2] px-4 text-sm font-medium text-white transition-colors hover:bg-[#166FE5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2] focus-visible:ring-offset-2"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
