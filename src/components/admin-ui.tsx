"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/result";

/** Shared by the admin forms and buttons: one way to run an action, show its error and style a control. */

const GENERIC_ERROR = "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export const PRIMARY =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-6 font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60";
export const SECONDARY =
  "inline-flex min-h-12 items-center justify-center rounded-full border border-line-strong bg-surface px-6 font-semibold hover:bg-sunken disabled:opacity-60";
export const DANGER =
  "inline-flex min-h-12 items-center justify-center rounded-full border border-danger-ink bg-danger-bg px-6 font-semibold text-danger-ink hover:bg-surface disabled:opacity-60";
export const FIELD =
  "mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base aria-[invalid=true]:border-danger-ink";

export type Failure = { message: string; fields?: Record<string, string> };

/**
 * Runs an admin action. On success the action has already revalidated the page; an expired or
 * missing session goes back to login, since nothing on this page can work without one.
 */
export function useAdminAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<Failure | null>(null);

  function run<T>(call: () => Promise<ActionResult<T>>, onSuccess?: (data: T) => void) {
    setFailure(null);
    startTransition(async () => {
      let result: ActionResult<T>;
      try {
        result = await call();
      } catch {
        setFailure({ message: GENERIC_ERROR });
        return;
      }
      if (result.ok) {
        onSuccess?.(result.data);
        return;
      }
      if (result.code === "UNAUTHORIZED") {
        router.replace("/admin/login");
        return;
      }
      setFailure({ message: result.message, fields: result.fieldErrors });
    });
  }

  return { pending, failure, run };
}

/** Announced by screen readers; a field's own error is shown under the field instead. */
export function ActionError({ failure, always = false }: { failure: Failure | null; always?: boolean }) {
  const show = failure && (always || !failure.fields);
  return (
    <div role="alert">
      {show ? (
        <p data-testid="action-error" className="rounded-lg border border-danger-ink bg-danger-bg p-3 text-danger-ink">
          {failure.message}
        </p>
      ) : null}
    </div>
  );
}

export function FieldError({ id, testId, message }: { id: string; testId: string; message?: string }) {
  return message ? (
    <p id={id} data-testid={testId} className="mt-1 text-danger-ink">
      {message}
    </p>
  ) : null;
}

type ControlProps = { id: string; "aria-describedby"?: string; "aria-invalid"?: true };

/** A labelled field whose hint and error are tied to the control for screen readers. */
export function FormField({
  id,
  label,
  hint,
  error,
  errorTestId,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  errorTestId: string;
  children: (control: ControlProps) => ReactNode;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div>
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-soft">
          {hint}
        </p>
      ) : null}
      {children({
        id,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(error ? { "aria-invalid": true as const } : {}),
      })}
      <FieldError id={`${id}-error`} testId={errorTestId} message={error} />
    </div>
  );
}
