"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { dashboardErrorMessage } from "../lib/apiClient.js";

export interface DashboardActionButtonProps<T> {
  action: () => Promise<T>;
  label: string;
  pendingLabel: string;
  errorFallback: string;
  confirm?: string;
  className?: string;
  disabled?: boolean;
  onSuccess?: (result: T) => void;
  refreshOnSuccess?: boolean;
}

/** Shared pending/error/confirmation behavior for Dashboard mutations. */
export function DashboardActionButton<T>({
  action,
  label,
  pendingLabel,
  errorFallback,
  confirm,
  className,
  disabled = false,
  onSuccess,
  refreshOnSuccess = true,
}: DashboardActionButtonProps<T>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (confirm && !window.confirm(confirm)) return;
    setPending(true);
    setError(null);
    try {
      const result = await action();
      onSuccess?.(result);
      if (refreshOnSuccess) startTransition(() => router.refresh());
    } catch (reason) {
      setError(dashboardErrorMessage(reason, errorFallback));
    } finally {
      setPending(false);
    }
  }

  return (
    <span>
      <button type="button" className={className} onClick={submit} disabled={disabled || pending}>
        {pending ? pendingLabel : label}
      </button>
      {error ? <span className="task-action-error" role="alert">{error}</span> : null}
    </span>
  );
}
