import { useState } from "react";
import { api, type Family, type Member } from "../api";
import { Avatar, Button } from "../components/ui";
import { plural } from "./Today";
import { SetPin } from "./SetPin";

const ROLE_LABEL: Record<Member["role"], string> = { adult: "взрослый", teen: "подросток", child: "ребёнок" };

/** Ссылки в приглашении — латиницей: кириллический адрес мессенджеры показывают как «xn--…». */
const SHARE_ORIGIN = window.location.hostname.startsWith("xn--")
  ? "https://semeinidispetcher.ru"
  : window.location.origin;

const REMIND_OPTIONS: [number, string][] = [
  [15, "За 15 мин"],
  [30, "За 30 мин"],
  [60, "За час"],
  [120, "За 2 часа"],
  [1440, "За день"],
  [0, "Не напоминать"],
];

export function FamilyScreen({
  family,
  me,
  onLogout,
}: {
  family: Family;
  me: Member;
  onLogout: () => void;
}) {
  const [changingPin, setChangingPin] = useState(false);
  const [pinChanged, setPinChanged] = useState(false);

  if (changingPin) {
    return (
      <div className="fixed inset-0 z-20 overflow-y-auto bg-bg">
        <SetPin
          onDone={() => {
            setChangingPin(false);
            setPinChanged(true);
          }}
          onCancel={() => setChangingPin(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 px-4 pt-6 pb-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Семья</h1>
      </header>

      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">
          {family.members.length} {plural(family.members.length, "участник", "участника", "участников")}
        </h2>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {family.members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar member={m} members={family.members} size={36} />
              <div className="flex-1">
                <p className="font-medium">
                  {m.name}
                  {m.id === me.id && <span className="text-ink-3"> · вы</span>}
                </p>
                <p className="text-sm text-ink-2">{ROLE_LABEL[m.role]}</p>
                {m.role !== "child" &&
                  (m.notifications ? (
                    <p className="text-xs text-ok">🔔 Уведомления включены</p>
                  ) : (
                    <p className="text-xs font-medium text-warn">
                      🔕 Уведомления выключены —{" "}
                      {m.id === me.id ? "включите на вкладке «Дела»" : "поручения сами не дойдут"}
                    </p>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Invite family={family} me={me} />

      <Reminders initial={family.members.find((m) => m.id === me.id)?.remind_before_min ?? 60} />

      <section className="space-y-2">
        <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Вход</h2>
        <Button variant="soft" className="w-full" onClick={() => setChangingPin(true)}>
          {pinChanged ? "PIN-код изменён" : "Сменить PIN-код"}
        </Button>
        <Button variant="ghost" className="w-full" onClick={onLogout}>
          Выйти на этом устройстве
        </Button>
      </section>
    </div>
  );
}

/**
 * Приглашение. Ссылку кладём в текст сообщения, а не отдельным полем: Max и часть
 * мессенджеров на iPhone берут из системного «Поделиться» только текст.
 */
function Invite({ family, me }: { family: Family; me: Member }) {
  const [copied, setCopied] = useState(false);
  const url = `${SHARE_ORIGIN}/join/${family.invite_code}`;
  const text = `${me.name} приглашает тебя в Семейный диспетчер — поручения будут приходить уведомлением. Открой ссылку:\n${url}`;
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);

  const track = (channel: string) => api.track("invite_shared", { channel });

  async function share() {
    track("system");
    try {
      await navigator.share({ text });
    } catch {
      /* закрыли окно — ничего не делаем */
    }
  }

  async function copy() {
    track("copy");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Скопируйте сообщение", text);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Пригласить в семью</h2>
      <p className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm break-all text-ink-2 select-all">{url}</p>

      <Button className="w-full" onClick={copy}>
        {copied ? "Скопировано — вставьте в Max или любой чат" : "Скопировать приглашение"}
      </Button>

      <div className="grid grid-cols-3 gap-2">
        <a
          href={`https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(`${me.name} приглашает тебя в Семейный диспетчер`)}`}
          target="_blank"
          rel="noreferrer"
          onClick={() => track("telegram")}
          className="flex h-11 items-center justify-center rounded-xl bg-surface-2 text-sm font-medium active:opacity-70"
        >
          Telegram
        </a>
        <a
          href={`https://vk.com/share.php?url=${encodedUrl}`}
          target="_blank"
          rel="noreferrer"
          onClick={() => track("vk")}
          className="flex h-11 items-center justify-center rounded-xl bg-surface-2 text-sm font-medium active:opacity-70"
        >
          ВКонтакте
        </a>
        {"share" in navigator ? (
          <button onClick={share} className="h-11 rounded-xl bg-surface-2 text-sm font-medium active:opacity-70">
            Ещё…
          </button>
        ) : (
          <a
            href={`sms:?&body=${encodedText}`}
            onClick={() => track("sms")}
            className="flex h-11 items-center justify-center rounded-xl bg-surface-2 text-sm font-medium active:opacity-70"
          >
            SMS
          </a>
        )}
      </div>
      <p className="text-xs text-ink-3">
        Для Max: нажмите «Скопировать приглашение» и вставьте сообщение в чат — ссылка будет внутри.
      </p>
    </section>
  );
}

/** Личная настройка: за сколько до срока напоминать о моих делах. */
function Reminders({ initial }: { initial: number }) {
  const [value, setValue] = useState(initial);

  async function choose(minutes: number) {
    const previous = value;
    setValue(minutes);
    try {
      await api.updateMe({ remind_before_min: minutes });
    } catch {
      setValue(previous);
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Напоминать о моих делах</h2>
      <div className="flex flex-wrap gap-2">
        {REMIND_OPTIONS.map(([minutes, label]) => (
          <button
            key={minutes}
            onClick={() => void choose(minutes)}
            className={`h-9 rounded-full border px-3 text-sm ${
              value === minutes ? "border-accent bg-accent-soft" : "border-line"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-3">Придёт уведомление с кнопками «Я помню» и «Сделано».</p>
    </section>
  );
}
