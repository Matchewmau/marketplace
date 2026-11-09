import { Sidebar } from "@/components/layout/sidebar";
import { ListingBrowser } from "@/components/marketplace/listing-browser";

export default function Home() {
  return (
    <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-6">
      <Sidebar />
      <ListingBrowser />
    </div>
  );
}
