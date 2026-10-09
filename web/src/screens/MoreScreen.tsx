import { useState } from "react";
import { api, type Family, type Member } from "../api";
import { Button } from "../components/ui";
import { applyTheme, currentTheme, THEMES, type ThemeKey } from "../theme";
import { SetPin } from "./SetPin";
import { InstallCard } from "../components/InstallCard";
import { platform } from "../push";

const SUPPORT_EMAIL = "family-dispatcher@yandex.ru";
const TESTERS_GROUP = "https://max.ru/join/q1xQqMBZWi_VmWKnjUzJgoQeHkbnfyuzjgYbbu9YV9Q";

const REMIND_OPTIONS: [number, string][] = [
  [15, "За 15 мин"],
  [30, "За 30 мин"],
  [60, "За час"],
  [120, "За 2 часа"],
  [1440, "За день"],
  [0, "Не напоминать"],
];


interface Contact {
  name: string;
  tone: string;
  links: [label: string, url: string][];
}

const TEAM: Contact[] = [
  {
    name: "Михаил",
    tone: "tone-a",
    links: [
      ["ВК", "https://vk.ru/o987kk"],
      ["Max", "https://max.ru/u/f9LHodD0cOLul4ARUfaxPuqj_x3bL16-Ln_c5XBOZvB5t235YqF43FVY2II"],
    ],
  },
  { name: "Ярослав", tone: "tone-b", links: [["ВК", "https://vk.com/id481065077"]] },
  { name: "Владислав", tone: "tone-c", links: [["ВК", "https://vk.com/vladusha09"]] },
];

const buildDate = new Date(__BUILD_TIME__);
const VERSION = buildDate.toLocaleString("ru-RU", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

/** Данные для разбора ошибки — без имени и телефона: о себе человек напишет сам. */
function deviceInfo(): string {
  const p = platform();
  const mode = p.standalone ? "приложение на экране" : "браузер";
  return [
    `Версия: ${VERSION}`,
    `Режим: ${mode}`,
    `Уведомления: ${"Notification" in window ? Notification.permission : "не поддерживаются"}`,
    `Экран: ${window.screen.width}×${window.screen.height}`,
    `Время: ${new Date().toLocaleString("ru-RU")}`,
    `Устройство: ${navigator.userAgent}`,
  ].join("\n");
}

export function MoreScreen({
  family,
  me,
  onLogout,
}: {
  family: Family | null;
  me: Member;
  onLogout: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [changingPin, setChangingPin] = useState(false);
  const [pinChanged, setPinChanged] = useState(false);

  if (changingPin) {
    return (
      <div className="fixed inset-0 z-40 overflow-y-auto">
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

  function mail() {
    api.track("screen_view", { screen: "help_mail" });
    const body = `Что делал(а):\n\nЧто произошло:\n\n\n— — —\n${deviceInfo()}`;
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
      "Семейный диспетчер: ошибка",
    )}&body=${encodeURIComponent(body)}`;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(deviceInfo());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Скопируйте данные устройства", deviceInfo());
    }
  }

  return (
    <div className="space-y-5 px-4 pt-6 pb-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Ещё</h1>
      </header>

      <ThemePicker />

      <Reminders initial={family?.members.find((m) => m.id === me.id)?.remind_before_min ?? me.remind_before_min} />

      <InstallCard always />

      <section className="space-y-2">
        <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Вход</h2>
        <Button variant="soft" className="w-full" onClick={() => setChangingPin(true)}>
          {pinChanged ? "PIN-код изменён" : "Сменить PIN-код"}
        </Button>
        <Button variant="ghost" className="w-full" onClick={onLogout}>
          Выйти на этом устройстве
        </Button>
      </section>

      <div>
        <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Помощь</h2>
        <p className="mt-1 text-sm text-ink-2">
          Что-то не работает или есть идея? Напишите нам — отвечаем сами, без ботов.
        </p>
      </div>

      <section className="rounded-2xl bg-accent-soft p-4">
        <p className="font-semibold">Написать в поддержку</p>
        <p className="mt-0.5 text-sm text-ink-2 select-all">{SUPPORT_EMAIL}</p>
        <button
          onClick={mail}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent font-semibold text-accent-ink active:opacity-80"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
            <path d="M22 6l-10 7L2 6" />
          </svg>
          Написать письмо
        </button>
        <p className="mt-2 text-xs text-ink-2">
          В письмо сами подставятся модель телефона, браузер и версия приложения. Добавьте, что делали, и скриншот.
        </p>
      </section>

      <a
        href={TESTERS_GROUP}
        target="_blank"
        rel="noreferrer"
        onClick={() => api.track("screen_view", { screen: "help_testers" })}
        className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 active:bg-surface-2"
      >
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent" aria-hidden>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Группа тестировщиков в Max</span>
          <span className="block text-xs text-ink-2">Новости, вопросы и ошибки — вместе с командой и другими семьями</span>
        </span>
        <span className="text-sm font-medium text-accent">Вступить</span>
      </a>

      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Или напрямую команде</h2>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {TEAM.map((person) => (
            <li key={person.name} className="flex items-center gap-3 px-4 py-3">
              <span
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${person.tone}`}
                aria-hidden
              >
                {person.name[0]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{person.name}</p>
                <p className="text-xs text-ink-2">сооснователь проекта</p>
              </div>
              {person.links.map(([label, url]) => (
                <a
                  key={label}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => api.track("screen_view", { screen: `help_${label === "ВК" ? "vk" : "max"}` })}
                  className="flex h-9 items-center rounded-full border border-line px-3 text-sm font-medium active:bg-surface-2"
                >
                  {label}
                </a>
              ))}
            </li>
          ))}
        </ul>
      </section>

      <button onClick={copy} className="flex items-center gap-2 text-sm text-ink-2 active:opacity-70">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        {copied ? "Скопировано — вставьте в сообщение" : "Скопировать данные устройства"}
      </button>

      <p className="text-xs text-ink-3">
        Версия от {VERSION} ·{" "}
        <a href="/privacy.html" target="_blank" className="underline">
          Политика конфиденциальности
        </a>
      </p>
    </div>
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

/** Тема оформления: применяется сразу, сохраняется в профиле и в памяти телефона. */
function ThemePicker() {
  const [selected, setSelected] = useState<ThemeKey>(currentTheme());

  function choose(key: ThemeKey) {
    setSelected(key);
    applyTheme(key);
    api.track("screen_view", { screen: "theme", theme: key });
    void api.updateMe({ theme: key }).catch(() => undefined);
  }

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Оформление</h2>
      <div className="grid grid-cols-2 gap-3">
        {THEMES.map((theme) => (
          <button
            key={theme.key}
            onClick={() => choose(theme.key)}
            aria-pressed={selected === theme.key}
            className={`rounded-2xl p-1.5 text-left transition ${
              selected === theme.key ? "ring-2 ring-accent" : "ring-1 ring-line"
            }`}
          >
            <span className="block rounded-xl p-2" style={{ background: theme.page }}>
              <span className="block h-7 rounded-lg" style={{ background: theme.hero }} />
              <span className="mt-1.5 grid grid-cols-2 gap-1.5">
                <span className="block h-5 rounded-md" style={{ background: theme.glass, border: `1px solid ${theme.glassBorder}` }} />
                <span className="block h-5 rounded-md" style={{ background: theme.glass, border: `1px solid ${theme.glassBorder}` }} />
              </span>
            </span>
            <span className="mt-1.5 block px-1 text-sm font-semibold">
              {theme.title}
              {selected === theme.key && <span className="text-accent"> ✓</span>}
            </span>
            <span className="block px-1 pb-1 text-xs text-ink-3">{theme.note}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
