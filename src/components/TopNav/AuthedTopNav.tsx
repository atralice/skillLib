import Link from "next/link";
import SignOutButton from "@/components/SignOutButton";
import hasSystemRole from "@/lib/user/hasSystemRole";
import type { NonNullableSessionUser } from "@/utils/loaders/server/user/getUser";
import NavShell from "./NavShell";

const NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/skills", label: "My Skills" },
  { href: "/dashboard/available", label: "Available" },
  { href: "/dashboard/teams", label: "Teams" },
  { href: "/skills", label: "Browse" },
  { href: "/settings", label: "Settings" },
];

export default function AuthedTopNav({ user }: { user: NonNullableSessionUser }) {
  return (
    <NavShell
      logoHref="/dashboard"
      links={
        <>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              {link.label}
            </Link>
          ))}
          {hasSystemRole(user) && (
            <Link
              href="/settings/invite-codes"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Invites
            </Link>
          )}
        </>
      }
      actions={
        <>
          <span className="text-sm text-gray-500">
            {user.firstName} {user.lastName}
          </span>
          <SignOutButton />
        </>
      }
    />
  );
}
