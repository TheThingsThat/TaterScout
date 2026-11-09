import type { Metadata } from "next";
import SignInForm from "@/components/SignInForm";
import { safeNext } from "@/lib/safeNext";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

interface Props {
  searchParams: Promise<{ next?: string | string[] }>;
}

// Signed-in visitors never see this page: the middleware forwards them to `next`.
export default async function SignInPage({ searchParams }: Props) {
  const raw = (await searchParams).next;
  const next = safeNext(Array.isArray(raw) ? raw[0] : raw);
  return (
    <div className="px-5 pb-20">
      <SignInForm next={next} />
    </div>
  );
}
