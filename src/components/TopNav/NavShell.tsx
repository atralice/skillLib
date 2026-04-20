import Link from "next/link";
import type { ReactNode } from "react";

export default function NavShell({
  logoHref,
  links,
  actions,
}: {
  logoHref: string;
  links: ReactNode;
  actions: ReactNode;
}) {
  return (
    <nav className="border-b bg-white px-6 py-4">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href={logoHref} className="text-xl font-bold">
            skillLib
          </Link>
          <div className="flex gap-4">{links}</div>
        </div>
        <div className="flex items-center gap-3">{actions}</div>
      </div>
    </nav>
  );
}
