import { redirect } from "next/navigation";
import Link from "next/link";
import getUser from "@/utils/loaders/server/user/getUser";
import SignOutButton from "@/components/SignOutButton";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-xl font-bold">
              skillLib
            </Link>
            <div className="flex gap-4">
              <Link href="/dashboard" className="text-sm text-gray-600 hover:text-gray-900">
                Dashboard
              </Link>
              <Link href="/dashboard/skills" className="text-sm text-gray-600 hover:text-gray-900">
                My Skills
              </Link>
              <Link href="/skills" className="text-sm text-gray-600 hover:text-gray-900">
                Browse
              </Link>
              <Link href="/settings" className="text-sm text-gray-600 hover:text-gray-900">
                Settings
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">
              {user.firstName} {user.lastName}
            </span>
            <SignOutButton />
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
