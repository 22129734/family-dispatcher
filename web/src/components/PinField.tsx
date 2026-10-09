import { useEffect, useRef, useState } from "react";

/** Поле PIN-кода из 4 цифр: одно скрытое поле ввода и четыре ячейки со своим курсором. */
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
  const [focused, setFocused] = useState(false);

  // Фокус сразу при появлении. На iPhone клавиатура откроется, если перед этим уже было
  // сфокусировано поле (см. PhoneLogin: фокус ставится в момент нажатия «Войти»).
  useEffect(() => {
    if (autoFocus) input.current?.focus({ preventScroll: true });
  }, [autoFocus, value]);

  return (
    <label className="relative block cursor-text" onClick={() => input.current?.focus()}>
      <span className="sr-only">PIN-код из 4 цифр</span>
      <div className="flex justify-center gap-4 py-2" aria-hidden>
        {[0, 1, 2, 3].map((i) => {
          const active = focused && !disabled && i === Math.min(value.length, 3) && value.length < 4;
          return (
            <span
              key={i}
              className={`bg-surface flex h-14 w-14 items-center justify-center rounded-2xl border text-2xl transition ${
                active ? "border-accent ring-2 ring-accent/30" : "border-line"
              }`}
            >
              {i < value.length ? "●" : active ? <span className="pin-caret h-7 w-0.5 rounded-full bg-accent" /> : ""}
            </span>
          );
        })}
      </div>
      <input
        ref={input}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete={autoComplete}
        maxLength={4}
        value={value}
        // readOnly, а не disabled: заблокированное поле теряет фокус и iPhone прячет клавиатуру
        readOnly={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
        // Невидимое поле: без своего курсора и текста, иначе iPhone рисует курсор у края
        className="absolute inset-0 h-full w-full text-base opacity-0 caret-transparent"
        style={{ color: "transparent" }}
      />
    </label>
  );
}
