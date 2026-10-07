import { useEffect, useState, type FormEvent } from "react";
import { api, type Role, type Session } from "../api";
import { Button, ErrorNote, Field } from "../components/ui";

export function Welcome({ onSession }: { onSession: (s: Session) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSession(await api.createFamily(name));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="pt-safe mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8">
      <div className="pt-12 pb-8">
        <img src="/icon.svg" alt="" className="mb-6 h-14 w-14" />
        <h1 className="text-3xl leading-tight font-bold tracking-tight">Как вас зовут?</h1>
        <p className="mt-3 text-base text-ink-2">
          Так вас увидят близкие. Потом пригласите мужа или жену по ссылке — поручения будут
          приходить им сами.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-1 flex-col gap-4">
        <Field
          label="Ваше имя"
          placeholder="Как вас называют дома"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          autoComplete="given-name"
        />
        <ErrorNote>{error}</ErrorNote>
        <div className="mt-auto pt-4">
          <Button type="submit" className="w-full" disabled={busy || !name.trim()}>
            {busy ? "Создаём…" : "Продолжить"}
          </Button>
          <p className="mt-3 text-center text-xs text-ink-3">
            Уже есть семья? Попросите близких прислать ссылку-приглашение.
          </p>
        </div>
      </form>
    </main>
  );
}

const ROLES: { value: Role; label: string }[] = [
  { value: "adult", label: "Взрослый" },
  { value: "teen", label: "Подросток" },
  { value: "child", label: "Ребёнок" },
];

export function Join({ code, onSession }: { code: string; onSession: (s: Session) => void }) {
  const [info, setInfo] = useState<{ family_name: string; members: string[] } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("adult");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.inviteInfo(code).then(setInfo, () => setNotFound(true));
  }, [code]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSession(await api.join(code, name, role));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 text-center">
        <h1 className="text-2xl font-bold">Приглашение не найдено</h1>
        <p className="mt-2 text-ink-2">Попросите прислать ссылку ещё раз.</p>
        <Button variant="soft" className="mt-6" onClick={() => (window.location.href = "/")}>
          Создать свою семью
        </Button>
      </main>
    );
  }

  return (
    <main className="pt-safe mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8">
      <div className="pt-12 pb-8">
        <img src="/icon.svg" alt="" className="mb-6 h-14 w-14" />
        <p className="text-sm font-medium text-accent">Приглашение</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          {info ? `Вас приглашает ${info.members.join(", ")}` : "…"}
        </h1>
        <p className="mt-2 text-ink-2">Поручения будут приходить вам уведомлением — с кнопкой «Беру».</p>
      </div>

      <form onSubmit={submit} className="flex flex-1 flex-col gap-4">
        <Field
          label="Ваше имя"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          autoComplete="given-name"
        />
        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink-2">Кто вы в семье</span>
          <div className="grid grid-cols-3 gap-2">
            {ROLES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRole(r.value)}
                className={`h-11 rounded-xl border text-sm font-medium ${
                  role === r.value ? "border-accent bg-accent-soft text-ink" : "border-line bg-surface text-ink-2"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="mt-auto pt-4">
          <Button type="submit" className="w-full" disabled={busy || !info || !name.trim()}>
            {busy ? "Входим…" : "Присоединиться"}
          </Button>
        </div>
      </form>
    </main>
  );
}
