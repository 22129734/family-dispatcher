import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import type { Member } from "../api";
import { avatarTone, initials } from "../format";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "soft" }) {
  const styles = {
    primary: "bg-accent text-accent-ink font-semibold active:opacity-80",
    soft: "bg-surface-2 text-ink font-medium active:opacity-70",
    ghost: "text-ink-2 font-medium active:opacity-60",
  }[variant];
  return (
    <button
      className={`h-12 rounded-2xl px-5 transition disabled:opacity-40 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>
      <input
        className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base text-ink outline-none placeholder:text-ink-3 focus:border-accent"
        {...props}
      />
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-left"
    >
      <span className="text-base">{children}</span>
      <span className={`relative h-7 w-12 rounded-full transition ${checked ? "bg-accent" : "bg-line"}`}>
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-6" : "left-1"}`}
        />
      </span>
    </button>
  );
}

export function Avatar({ member, members, size = 28 }: { member?: Member; members: Member[]; size?: number }) {
  if (!member) {
    return (
      <span
        style={{ width: size, height: size }}
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-ink-3 text-xs text-ink-3"
      >
        ?
      </span>
    );
  }
  return (
    <span
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${avatarTone(member.id, members)}`}
    >
      {initials(member.name)}
    </span>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{children}</p>;
}
