import Link from "next/link";
import NavShell from "./NavShell";

export default function PublicTopNav() {
  return (
    <NavShell
      logoHref="/"
      links={
        <Link href="/skills" className="text-sm text-gray-600 hover:text-gray-900">
          Skills
        </Link>
      }
      actions={
        <>
          <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700"
          >
            Sign up
          </Link>
        </>
      }
    />
  );
}
