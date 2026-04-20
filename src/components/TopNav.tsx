import getUser from "@/utils/loaders/server/user/getUser";
import AuthedTopNav from "./TopNav/AuthedTopNav";
import PublicTopNav from "./TopNav/PublicTopNav";

export default async function TopNav() {
  const user = await getUser();
  return user ? <AuthedTopNav user={user} /> : <PublicTopNav />;
}
