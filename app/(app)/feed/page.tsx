import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { getFeed, getPostableNovelas } from "@/lib/repositories/feed";
import { PainelFeed } from "./PainelFeed";

export const metadata = { title: "Plantão da comunidade" };

export default async function FeedPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/entrar");

  const [posts, novelas] = await Promise.all([
    getFeed(viewer.id, { take: 30 }),
    getPostableNovelas(viewer.id),
  ]);

  return (
    <PainelFeed
      posts={posts}
      novelas={novelas}
      viewer={{
        nome: viewer.name,
        handle: viewer.handle,
        avatarSeed: viewer.avatarSeed,
      }}
      esconderSpoiler={viewer.preferences.spoilerGuard}
    />
  );
}
