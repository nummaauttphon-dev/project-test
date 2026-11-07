"use client";

import { useActionState, useState } from "react";
import { loginAction } from "@/features/admin/actions";

const INPUT_CLASS =
  "mt-1 block min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3 text-base aria-[invalid=true]:border-danger-ink";

export function AdminLoginForm({ initialError }: { initialError?: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  // React resets a form after its action; only the password should be typed again.
  const [email, setEmail] = useState("");
  const error = state && !state.ok ? state.message : initialError;

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className="font-medium">
          อีเมล
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <label htmlFor="password" className="font-medium">
          รหัสผ่าน
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
          className={INPUT_CLASS}
        />
      </div>
      <div role="alert">
        {error ? (
          <p id="login-error" className="rounded-lg border border-danger-ink bg-danger-bg p-3 text-danger-ink">
            {error}
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-6 text-lg font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
      >
        {pending ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}
      </button>
    </form>
  );
}
