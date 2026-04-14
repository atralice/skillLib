import getUser from "@/utils/loaders/server/user/getUser";
import prisma from "@/lib/prisma";
import ApiKeyManager from "@/components/ApiKeyManager";

export default async function ApiKeysPage() {
  const user = await getUser();
  if (!user) return null;

  const apiKeys = await prisma.apiKey.findMany({
    where: { userId: user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold">API Keys</h1>
      <p className="mt-2 text-sm text-gray-500">
        Use API keys to authenticate the skilllib CLI. Keys are shown once at creation.
      </p>
      <ApiKeyManager initialKeys={apiKeys} />
    </div>
  );
}
