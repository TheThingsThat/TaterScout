import { redirect } from "next/navigation";

// Sign-in moved site-wide; keep old links and bookmarks working.
export default function ScoutSignIn() {
  redirect("/sign-in?next=/scout");
}
