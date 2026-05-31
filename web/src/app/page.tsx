import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">mtg</h1>
        <p className="text-muted-foreground">
          Search every Magic: The Gathering card, manage your collection and decks, and sell extras
          in the marketplace.
        </p>
        <div className="flex gap-3 pt-2">
          <Button asChild>
            <Link href="/cards">Browse cards</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <FeatureCard
          title="Collection"
          description="Track what you own by print, finish, condition, and language."
          href="/collection"
        />
        <FeatureCard
          title="Decks"
          description="Build and revise decks tied to real printings (alt-art / foil preserved)."
          href="/decks"
        />
        <FeatureCard
          title="Marketplace"
          description="List your extras for sale; configure shipping; message buyers."
          href="/marketplace"
        />
      </div>
    </div>
  );
}

function FeatureCard({ title, description, href }: { title: string; description: string; href: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="ghost" size="sm">
          <Link href={href}>Open →</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
