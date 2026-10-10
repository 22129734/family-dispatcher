import { Hint, resetHints } from "../components/Hint";
import { useState, type ReactNode } from "react";
import { api, type Family, type Member } from "../api";
import { Button } from "../components/ui";
import { applyTheme, currentTheme, THEMES, type ThemeKey } from "../theme";
import type { ConfirmMode } from "../api";
import { SetPin } from "./SetPin";
import { InstallCard } from "../components/InstallCard";
import { VoiceFeedback } from "../components/VoiceFeedback";
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
  role: string;
  tone: string;
  links: [label: string, url: string][];
}

const TEAM: Contact[] = [
  {
    name: "Михаил",
    role: "основатель проекта",
    tone: "tone-a",
    links: [
      ["ВК", "https://vk.ru/o987kk"],
      ["Max", "https://max.ru/u/f9LHodD0cOLul4ARUfaxPuqj_x3bL16-Ln_c5XBOZvB5t235YqF43FVY2II"],
    ],
  },
  { name: "Ярослав", role: "сооснователь проекта", tone: "tone-b", links: [["ВК", "https://vk.com/id481065077"]] },
  { name: "Владислав", role: "сооснователь проекта", tone: "tone-c", links: [["ВК", "https://vk.com/vladusha09"]] },
  { name: "Илья", role: "разработчик", tone: "tone-d", links: [["Почта", "mailto:onepeople458@gmail.com"]] },
];

type Sub = "reminders" | "theme" | "confirm" | "install" | "account" | "voice" | "team" | null;

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
  const [hintsReset, setHintsReset] = useState(false);
  // Экран второго уровня: строки «Ещё» открывают каждая свой
  const [sub, setSub] = useState<Sub>(null);
  const meRow = family?.members.find((m) => m.id === me.id);
  const [remind, setRemind] = useState(meRow?.remind_before_min ?? me.remind_before_min);
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(meRow?.confirm_mode ?? "auto");

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

  const remindLabel = REMIND_OPTIONS.find(([minutes]) => minutes === remind)?.[1] ?? "";
  const themeLabel = THEMES.find((theme) => theme.key === currentTheme())?.title ?? "";
  const confirmLabel = { never: "сразу", auto: "если неясно", always: "всегда" }[confirmMode];

  if (sub) {
    const titles: Record<Exclude<Sub, null>, string> = {
      reminders: "Напоминания",
      theme: "Оформление",
      confirm: "Перед отправкой просьбы",
      install: "Установить на экран",
      account: "Вход и PIN-код",
      voice: "Надиктовать отзыв",
      team: "Команда и контакты",
    };
    return (
      <div className="space-y-5 px-4 pt-6 pb-6">
        <header>
          <button onClick={() => setSub(null)} className="-ml-1 h-9 px-1 text-sm font-medium text-accent active:opacity-60">
            ‹ Ещё
          </button>
          <h1 className="font-display mt-1 text-2xl font-bold">{titles[sub]}</h1>
        </header>

        {sub === "reminders" && <Reminders initial={remind} onChange={setRemind} />}
        {sub === "theme" && <ThemePicker />}
        {sub === "confirm" && <ConfirmModeSetting initial={confirmMode} onChange={setConfirmMode} />}
        {sub === "install" && <InstallCard always />}
        {sub === "account" && (
          <section className="space-y-2">
            <Button variant="soft" className="w-full" onClick={() => setChangingPin(true)}>
              {pinChanged ? "PIN-код изменён" : "Сменить PIN-код"}
            </Button>
            <Button variant="ghost" className="w-full" onClick={onLogout}>
              Выйти на этом устройстве
            </Button>
          </section>
        )}
        {sub === "voice" && <VoiceFeedback deviceInfo={deviceInfo} />}
        {sub === "team" && (
          <>
            <p className="text-sm text-ink-2">
              Мы участвуем в акселераторе Sber500 × Disrupt. Пишите напрямую — отвечаем сами, без ботов.
            </p>
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
                    <p className="text-xs text-ink-2">{person.role}</p>
                  </div>
                  {person.links.map(([label, url]) => (
                    <a
                      key={label}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => api.track("screen_view", { screen: `help_${{ ВК: "vk", Max: "max", Почта: "mail" }[label] ?? "link"}` })}
                      className="flex h-9 items-center rounded-full border border-line px-3 text-sm font-medium active:bg-surface-2"
                    >
                      {label}
                    </a>
                  ))}
                </li>
              ))}
            </ul>
            <button onClick={copy} className="flex items-center gap-2 text-sm text-ink-2 active:opacity-70">
              {copied ? "Скопировано — вставьте в сообщение" : "Скопировать данные устройства для разбора ошибки"}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5 px-4 pt-6 pb-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Ещё</h1>
      </header>
      <Hint id="more">Настройки, помощь и контакты команды. Нажмите на строку, чтобы открыть.</Hint>

      <Group title="Настройки">
        <Row label="Напоминания" value={remindLabel} onClick={() => setSub("reminders")} />
        <Row label="Оформление" value={themeLabel} onClick={() => setSub("theme")} />
        <Row label="Перед отправкой просьбы" value={confirmLabel} onClick={() => setSub("confirm")} />
        {!platform().standalone && <Row label="Установить на экран" onClick={() => setSub("install")} />}
        <Row label="Вход и PIN-код" onClick={() => setSub("account")} />
      </Group>

      <Group title="Помощь">
        <Row label="Надиктовать отзыв" value="голосом" onClick={() => setSub("voice")} />
        <Row label="Написать в поддержку" value="письмо" onClick={mail} />
        <Row
          label="Группа тестировщиков в Max"
          href={TESTERS_GROUP}
          onClick={() => api.track("screen_view", { screen: "help_testers" })}
        />
        <Row
          label="Показать подсказки заново"
          value={hintsReset ? "готово" : ""}
          onClick={() => {
            resetHints();
            setHintsReset(true);
          }}
        />
      </Group>

      <Group title="О нас">
        <Row label="Команда и контакты" onClick={() => setSub("team")} />
      </Group>

      <p className="text-xs text-ink-3">
        Версия от {VERSION} ·{" "}
        <a href="/privacy.html" target="_blank" className="underline">
          Политика конфиденциальности
        </a>
      </p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">{title}</h2>
      <div className="glass divide-y divide-line overflow-hidden rounded-2xl">{children}</div>
    </section>
  );
}

/** Строка настроек: название, текущее значение и стрелка; ссылка — во внешнее приложение. */
function Row({ label, value = "", onClick, href }: { label: string; value?: string; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      <span className="min-w-0 flex-1 font-medium">{label}</span>
      {value && <span className="shrink-0 text-sm text-ink-3">{value}</span>}
      <span className="shrink-0 text-ink-3" aria-hidden>
        ›
      </span>
    </>
  );
  const cls = "flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" onClick={onClick} className={cls}>
      {inner}
    </a>
  ) : (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

/** Личная настройка: за сколько до срока напоминать о моих делах. */
function Reminders({ initial, onChange }: { initial: number; onChange: (minutes: number) => void }) {
  const [value, setValue] = useState(initial);

  async function choose(minutes: number) {
    const previous = value;
    setValue(minutes);
    onChange(minutes);
    try {
      await api.updateMe({ remind_before_min: minutes });
    } catch {
      setValue(previous);
      onChange(previous);
    }
  }

  return (
    <section className="space-y-2">
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

const CONFIRM_OPTIONS: [ConfirmMode, string, string][] = [
  ["never", "Отправлять сразу", "Сказали — просьба ушла. Поправить можно карандашом."],
  ["auto", "Проверять, если что-то неясно", "Покажем просьбу, только когда не поняли срок или кому. Рекомендуем."],
  ["always", "Всегда проверять", "Перед каждой отправкой: день, время, повтор, кому, список и файлы."],
];

/** Проверка просьбы перед отправкой — для тех, кто хочет всё уточнять сам. */
function ConfirmModeSetting({ initial, onChange }: { initial: ConfirmMode; onChange: (mode: ConfirmMode) => void }) {
  const [mode, setMode] = useState<ConfirmMode>(initial);

  async function choose(value: ConfirmMode) {
    const previous = mode;
    setMode(value);
    onChange(value);
    try {
      await api.updateMe({ confirm_mode: value });
    } catch {
      setMode(previous);
      onChange(previous);
    }
  }

  return (
    <section className="space-y-2">
      {CONFIRM_OPTIONS.map(([value, title, note]) => (
        <button
          key={value}
          onClick={() => void choose(value)}
          aria-pressed={mode === value}
          className={`bg-surface w-full rounded-2xl border p-3 text-left transition ${
            mode === value ? "ring-2 ring-accent" : ""
          }`}
        >
          <span className="block text-sm font-semibold">
            {title}
            {mode === value && <span className="text-accent"> ✓</span>}
          </span>
          <span className="mt-0.5 block text-xs text-ink-2">{note}</span>
        </button>
      ))}
    </section>
  );
}
