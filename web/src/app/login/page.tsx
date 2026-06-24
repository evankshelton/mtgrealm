import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <h1 className="text-xl font-semibold text-white">Sign in</h1>
        <p className="mt-1 text-sm text-slate-400">Welcome back.</p>
        <div className="mt-4 space-y-4">
          <AuthForm mode="login" />
          <p className="text-center text-sm text-slate-400">
            No account?{" "}
            <Link href="/signup" className="text-amber-400 underline hover:text-amber-300">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
