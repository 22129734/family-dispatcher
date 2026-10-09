import { useState } from "react";
import { api } from "../api";
import { Button, ErrorNote } from "../components/ui";
import { PinField } from "../components/PinField";

/** Сразу после первого входа звонком: PIN-код для следующих входов без звонка. */
export function SetPin({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value: string) {
    setBusy(true);
    try {
      await api.setPin(value);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  function enter(value: string) {
    setPin(value);
    setError(null);
    if (value.length < 4) return;
    if (first === null) {
      setFirst(value);
      setPin("");
    } else if (value === first) {
      void save(value);
    } else {
      setError("PIN-коды не совпали — придумайте заново");
      setFirst(null);
      setPin("");
    }
  }

  return (
    <main className="pt-safe mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8">
      <div className="pt-12 pb-6">
        <h1 className="text-3xl leading-tight font-bold tracking-tight">
          {first === null ? "Придумайте PIN-код" : "Повторите PIN-код"}
        </h1>
        <p className="mt-3 text-base text-ink-2">
          4 цифры. Дальше будете входить по номеру и PIN-коду — без звонка.
        </p>
      </div>
      <PinField value={pin} onChange={enter} autoComplete="new-password" disabled={busy} />
      <div className="mt-4">
        <ErrorNote>{error}</ErrorNote>
      </div>
      {onCancel && (
        <div className="mt-auto pt-6">
          <Button variant="ghost" className="w-full" onClick={onCancel}>
            Отмена
          </Button>
        </div>
      )}
    </main>
  );
}
