import { notFound } from "next/navigation";

import { Sidebar } from "@/components/layout/sidebar";
import { ListingBrowser } from "@/components/marketplace/listing-browser";
import { getCategoryBySlug } from "@/lib/categories";

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { slug } = await params;
  const category = getCategoryBySlug(slug);

  if (!category) {
    notFound();
  }

  return (
    <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-6">
      <Sidebar activeCategory={slug} />
      <ListingBrowser category={category.name} heading={category.name} />
    </div>
  );
}
