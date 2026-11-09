import { ListingDetail } from "@/components/marketplace/listing-detail";

type ItemPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ItemPage({ params }: ItemPageProps) {
  const { id } = await params;

  return (
    <div className="mx-auto max-w-5xl">
      <ListingDetail listingId={id} />
    </div>
  );
}
