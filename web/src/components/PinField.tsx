import { useEffect, useRef } from "react";

/** Поле PIN-кода из 4 цифр: одно скрытое поле ввода и четыре кружка. */
export function PinField({
  value,
  onChange,
  autoComplete,
  disabled,
  autoFocus = true,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && !disabled) input.current?.focus();
  }, [autoFocus, disabled, value]);

  return (
    <label className="relative block cursor-text" onClick={() => input.current?.focus()}>
      <span className="sr-only">PIN-код из 4 цифр</span>
      <div className="flex justify-center gap-4 py-2" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`flex h-14 w-14 items-center justify-center rounded-2xl border text-2xl ${
              i === value.length && !disabled ? "border-accent" : "border-line"
            } bg-surface`}
          >
            {i < value.length ? "●" : ""}
          </span>
        ))}
      </div>
      <input
        ref={input}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete={autoComplete}
        maxLength={4}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
        className="absolute inset-0 h-full w-full opacity-0"
      />
    </label>
  );
}
