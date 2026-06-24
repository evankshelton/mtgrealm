import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-sm">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <h1 className="text-xl font-semibold text-white">Create an account</h1>
        <p className="mt-1 text-sm text-slate-400">Sign up to start your collection.</p>
        <div className="mt-4 space-y-4">
          <AuthForm mode="signup" />
          <p className="text-center text-sm text-slate-400">
            Already have an account?{" "}
            <Link href="/login" className="text-amber-400 underline hover:text-amber-300">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
