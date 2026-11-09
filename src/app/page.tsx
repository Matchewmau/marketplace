import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#F0F2F5]">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 py-20 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-[var(--fb-blue)]">
          Marketplace
        </h1>
        <p className="max-w-md text-muted-foreground">
          Buy and sell items in your community.
        </p>
        <Card className="w-full max-w-sm text-left">
          <CardHeader>
            <CardTitle>Scaffold ready</CardTitle>
            <CardDescription>
              Next.js 15, Tailwind 3.4, and shadcn/ui are configured.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button>Browse listings</Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
