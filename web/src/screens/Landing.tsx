import type { ReactNode } from "react";

/**
 * Первое знакомство до входа: человеку прислали ссылку — сначала рассказываем, что это,
 * и только по «Попробовать» просим номер. Вошедшим и установившим приложение не показываем.
 */

const STEPS: [string, string][] = [
  ["Скажите дело голосом", "«Олег, завтра после работы забери посылку с Ozon»"],
  ["Близкий нажмёт «Беру»", "ИИ сам поймёт, кому это и на когда, и напомнит"],
  ["Вы увидите «Сделано»", "Без «я же тебе писала!» и переспрашиваний"],
];

const FEATURES = [
  "Голосом или текстом",
  "Напоминания",
  "Списки покупок",
  "Календарь семьи",
  "Заметки и файлы",
  "Повторы",
  "Без скачивания",
];

function Logo({ size = 40 }: { size?: number }) {
  return <img src="/icon.svg" alt="" width={size} height={size} className="shrink-0 rounded-[28%]" />;
}

function Header({ onLogin }: { onLogin?: () => void }) {
  return (
    <header className="flex items-center gap-2.5">
      <Logo size={36} />
      <span className="font-display text-[15px] font-bold">Семейный диспетчер</span>
      {onLogin && (
        <button onClick={onLogin} className="ml-auto h-10 px-2 text-sm font-semibold text-accent active:opacity-60">
          Войти
        </button>
      )}
    </header>
  );
}

function TryButton({ onClick, children = "Попробовать" }: { onClick: () => void; children?: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="bg-hero h-14 w-full rounded-2xl text-lg font-semibold text-white shadow-lg transition active:scale-[0.98]"
    >
      {children}
    </button>
  );
}

/** Пример карточки — как просьба выглядит у близкого. */
function SampleTask({ done = false }: { done?: boolean }) {
  return (
    <div className="glass rounded-2xl p-3.5 shadow-sm">
      <div className="flex items-center gap-2.5">
        {done && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ok text-white">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12l5 5 9-10" />
            </svg>
          </span>
        )}
        <p className={`text-base font-semibold ${done ? "text-ink-2 line-through" : ""}`}>Забрать посылку с&nbsp;Ozon</p>
      </div>
      {done ? (
        <p className="mt-1.5 text-sm font-semibold text-ok">Олег сделал!</p>
      ) : (
        <>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--tone-b)] text-[11px] font-bold text-white">О</span>
            завтра, 19:00 · Олег
          </p>
          <div className="mt-2.5 flex gap-2">
            <span className="flex h-9 flex-1 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-accent-ink">Беру</span>
            <span className="flex h-9 flex-1 items-center justify-center rounded-xl bg-surface-2 text-sm font-medium text-ink-2">Не могу</span>
          </div>
        </>
      )}
    </div>
  );
}

function Steps() {
  return (
    <ol className="space-y-3">
      {STEPS.map(([title, text], i) => (
        <li key={title} className="flex gap-3">
          <span className="bg-hero flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-display text-sm font-bold text-white">
            {i + 1}
          </span>
          <div>
            <p className="font-semibold">{title}</p>
            <p className="text-sm text-ink-2">{text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function WhyPhone() {
  return (
    <div className="rounded-2xl border border-ok/25 bg-ok-soft p-4 text-sm leading-relaxed">
      <p className="font-semibold text-ok">Зачем номер телефона?</p>
      <p className="mt-1 text-ink">
        Это ваш вход: по бесплатному звонку, без паролей и СМС. Номер никому не передаём —{" "}
        <a href="/privacy.html" target="_blank" className="text-accent underline">
          политика конфиденциальности
        </a>
        .
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Страница о проекте — для любой ссылки на сайт. */
export function Landing({ onTry, onLogin }: { onTry: () => void; onLogin: () => void }) {
  return (
    <main className="pt-safe pb-safe mx-auto min-h-dvh max-w-md px-5 pt-4 pb-10">
      <Header onLogin={onLogin} />

      <section className="pt-10">
        <h1 className="font-display text-[40px] leading-[1.05] font-extrabold tracking-tight">
          Попросил —{" "}
          <span
            style={{ backgroundImage: "var(--hero)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}
          >
            сделано.
          </span>
        </h1>
        <p className="mt-4 text-lg leading-snug text-ink-2">
          Общие дела семьи в одном месте. Скажите дело голосом — ИИ поймёт, кому и на когда, и напомнит. Вы видите, что
          взяли и что уже сделано.
        </p>
        <div className="mt-6">
          <TryButton onClick={onTry} />
          <p className="mt-2 text-center text-sm text-ink-3">Бесплатно · без скачивания · 1 минута</p>
        </div>
        <div className="mt-8">
          <SampleTask />
        </div>
      </section>

      <Section title="Знакомо?">
        <div className="space-y-2 text-[15px]">
          <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-accent-ink">
            Купи хлеб и забери Машу в 7
          </p>
          <p className="w-fit max-w-[80%] rounded-2xl rounded-bl-md bg-surface-2 px-3.5 py-2">Ок</p>
          <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-accent-ink">
            Ты забрал Машу??
          </p>
          <p className="w-fit max-w-[80%] rounded-2xl rounded-bl-md bg-surface-2 px-3.5 py-2">Какую Машу? Ты не писала</p>
        </div>
        <p className="mt-4 text-ink-2">
          Просьбы теряются в переписке, а держать всё в голове приходится одному человеку. Семейный диспетчер
          забирает это на себя.
        </p>
      </Section>

      <Section title="Как это работает">
        <Steps />
        <div className="mt-5">
          <SampleTask done />
        </div>
      </Section>

      <Section title="Что умеет">
        <div className="flex flex-wrap gap-2">
          {FEATURES.map((f) => (
            <span key={f} className="glass rounded-full px-3.5 py-2 text-sm font-medium">
              {f}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Кто мы">
        <p className="text-ink-2">
          Команда из четырёх человек. Участвуем в акселераторе Sber500 × Disrupt. Прежде чем делать приложение, провели
          исследование: как семьи договариваются о делах и где всё ломается.
        </p>
        <div className="mt-4">
          <WhyPhone />
        </div>
      </Section>

      <div className="mt-12">
        <TryButton onClick={onTry} />
        <button onClick={onLogin} className="mt-2 h-11 w-full text-sm font-medium text-ink-2 active:opacity-60">
          Уже пользуюсь — войти
        </button>
      </div>
    </main>
  );
}

/** Первая буква имени в цветном круге — как аватар в приложении. */
function BigAvatar({ name, tone }: { name: string; tone: string }) {
  return (
    <span
      className="flex h-20 w-20 items-center justify-center rounded-full font-display text-3xl font-extrabold text-white shadow-lg ring-4 ring-white/70"
      style={{ background: tone }}
    >
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Ссылка-приглашение в семью: зовёт знакомый человек — рассказ о продукте не нужен. */
export function InviteIntro({ inviter, onJoin }: { inviter: string | null; onJoin: () => void }) {
  const who = inviter ?? "Близкий";
  return (
    <main className="pt-safe pb-safe mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-4 pb-8">
      <Header />
      <div className="flex flex-col items-center pt-10 text-center">
        <BigAvatar name={who} tone="var(--tone-a)" />
        <h1 className="mt-5 font-display text-[26px] leading-tight font-bold">
          {who} приглашает вас вести семейные дела вместе
        </h1>
        <p className="mt-3 text-ink-2">
          {who} будет просить о делах — голосом или текстом. Вам придёт уведомление: нажмите «Беру», а когда сделаете —
          «Сделано».
        </p>
      </div>
      <div className="mt-6">
        <SampleTask />
      </div>
      <div className="mt-auto pt-8">
        <TryButton onClick={onJoin}>Присоединиться к семье</TryButton>
        <p className="mt-2 text-center text-sm text-ink-3">Вход по бесплатному звонку · номер никому не передаём</p>
      </div>
    </main>
  );
}

/** Ссылка-рекомендация: «Михаил советует» — коротко и с кнопкой; подробности — на странице о проекте. */
export function RecommendIntro({
  from,
  onTry,
  onMore,
  onLogin,
}: {
  from: string;
  onTry: () => void;
  onMore: () => void;
  onLogin: () => void;
}) {
  return (
    <main className="pt-safe pb-safe mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-4 pb-8">
      <Header onLogin={onLogin} />
      <div className="flex flex-col items-center pt-10 text-center">
        <BigAvatar name={from} tone="var(--color-accent)" />
        <h1 className="mt-5 font-display text-[26px] leading-tight font-bold">{from} советует «Семейный диспетчер»</h1>
        <p className="mt-3 text-ink-2">Приложение для общих дел семьи: попросил — взяли — сделано.</p>
      </div>
      <div className="mt-8">
        <Steps />
      </div>
      <div className="mt-auto pt-8">
        <TryButton onClick={onTry} />
        <button onClick={onMore} className="mt-2 h-11 w-full text-sm font-medium text-accent active:opacity-60">
          Узнать больше о проекте
        </button>
      </div>
    </main>
  );
}
