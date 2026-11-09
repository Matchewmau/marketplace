import { Sidebar } from "@/components/layout/sidebar";

export default function Home() {
  return (
    <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-6">
      <Sidebar />
      <section className="min-w-0 rounded-lg bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
        Listings will appear here.
      </section>
    </div>
  );
}
