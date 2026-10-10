import { Hint } from "../components/Hint";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, type Family, type Member, type WeekStats } from "../api";
import { Avatar, Button } from "../components/ui";
import { plural } from "./Today";
import { familyInviteText, familyInviteUrl, SHARE_ORIGIN } from "../share";

const ROLE_LABEL: Record<Member["role"], string> = { adult: "взрослый", teen: "подросток", child: "ребёнок" };

type Sheet = "invite" | "recommend" | null;

export function FamilyScreen({ family, me }: { family: Family; me: Member }) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const alone = family.members.length < 2;
  const [week, setWeek] = useState<WeekStats | null>(null);
  useEffect(() => {
    api.familyWeek().then(setWeek, () => undefined);
  }, []);
  return (
    <div className="space-y-5 px-4 pt-6 pb-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Семья</h1>
      </header>
      <Hint id="family">
        Здесь ваша семья. Пригласите близких по ссылке — просьбы будут уходить им, а вы увидите «Беру» и «Сделано».
      </Hint>

      {week?.show && <WeekCard week={week} family={family} me={me} />}

      {alone && (
        <section className="bg-hero rounded-[24px] p-5 text-white shadow-lg">
          <p className="font-display text-lg leading-snug font-bold">Пока в семье только вы</p>
          <p className="mt-1 text-sm opacity-95">
            Пригласите мужа, жену, маму или старших детей — просьбы будут уходить им, а вы увидите «Беру» и «Сделано».
          </p>
          <button
            onClick={() => setSheet("invite")}
            className="mt-4 h-12 w-full rounded-2xl bg-white font-semibold text-accent active:opacity-80"
          >
            Пригласить
          </button>
        </section>
      )}

      <ul className="space-y-2">
        {family.members.map((m) => (
          <li key={m.id} className="glass flex items-center gap-3 rounded-2xl px-4 py-3">
            <Avatar member={m} members={family.members} size={36} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {m.name}
                {m.id === me.id && <span className="text-ink-3"> · вы</span>}
                {m.role !== "adult" && <span className="text-ink-3"> · {ROLE_LABEL[m.role]}</span>}
              </p>
              {/* Показываем только проблему: без уведомлений просьбы сами не дойдут */}
              {m.role !== "child" && !m.notifications && (
                <p className="text-xs font-medium text-warn">
                  Уведомления выключены — {m.id === me.id ? "включите на вкладке «Дела»" : "просьбы сами не дойдут, скажите"}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!alone && (
        <button
          onClick={() => setSheet("invite")}
          className="h-11 w-full rounded-2xl border border-dashed border-accent/50 text-sm font-semibold text-accent active:bg-accent-soft"
        >
          + Пригласить ещё
        </button>
      )}

      <button onClick={() => setSheet("recommend")} className="block w-full text-center text-sm font-medium text-ink-2">
        Посоветовать приложение знакомым →
      </button>

      {sheet && (
        <BottomSheet onClose={() => setSheet(null)}>
          {sheet === "invite" ? <Invite family={family} me={me} /> : <Recommend family={family} />}
        </BottomSheet>
      )}
    </div>
  );
}

const DAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/** «Итоги недели»: сколько сделали вместе — без мест и рейтинга, с похвалой. */
function WeekCard({ week, family, me }: { week: WeekStats; family: Family; me: Member }) {
  const max = Math.max(1, ...week.by_day);
  const today = (new Date().getDay() + 6) % 7;
  const people = week.members
    .map((row) => ({ ...row, member: family.members.find((m) => m.id === row.member_id) }))
    .filter((row) => row.member && (row.done > 0 || row.thanks > 0));
  return (
    <section className="bg-hero appear rounded-[24px] p-4 text-white shadow-lg">
      <p className="text-[11px] font-bold tracking-wider uppercase opacity-90">Итоги недели</p>
      <p className="font-display mt-1 text-xl leading-snug font-bold">
        Семья сделала {week.total} {plural(week.total, "дело", "дела", "дел")}
      </p>
      <div className="mt-3 flex h-12 items-end gap-1.5" aria-hidden>
        {week.by_day.map((count, i) => (
          <span
            key={i}
            className={`flex-1 rounded-md ${i === today ? "bg-white" : "bg-white/60"}`}
            style={{ height: `${Math.max(8, (count / max) * 100)}%`, opacity: i > today ? 0.35 : 1 }}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 text-center text-[10px] opacity-85" aria-hidden>
        {DAYS.map((d) => (
          <span key={d} className="flex-1">
            {d}
          </span>
        ))}
      </div>
      {people.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {people.map(({ member, done, thanks }) => (
            <span key={member!.id} className="flex items-center gap-1.5 rounded-full bg-white/20 py-1 pr-3 pl-1 text-sm font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-bold text-accent">
                {member!.name.slice(0, 1).toUpperCase()}
              </span>
              {member!.id === me.id ? "Вы" : member!.name} · {done}
              {thanks > 0 && <span className="opacity-90"> · 💜 {thanks}</span>}
            </span>
          ))}
        </div>
      )}
      <p className="mt-3 rounded-xl bg-white/20 px-3 py-2 text-sm font-semibold">{week.praise}</p>
    </section>
  );
}

/** Выезжающая снизу панель — способы отправить ссылку. */
function BottomSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/35" onClick={onClose}>
      <div
        className="glass appear pb-safe max-h-[90dvh] overflow-y-auto rounded-t-[28px] px-4 pt-3 pb-5 shadow-2xl"
        style={{ background: "var(--surface-solid)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink-3/40" />
        {children}
        <button onClick={onClose} className="mt-3 h-10 w-full text-sm font-medium text-ink-2">
          Закрыть
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Приглашение в свою семью: человек присоединяется к вашим делам. */
function Invite({ family, me }: { family: Family; me: Member }) {
  const url = familyInviteUrl(family);
  return (
    <ShareBlock
      kind="family"
      title="Пригласить в семью"
      description="Отправьте ссылку близкому — он присоединится к вашим делам."
      url={url}
      text={familyInviteText(family, me)}
      shortText={`${me.name} приглашает тебя в Семейный диспетчер`}
      copyLabel="Скопировать приглашение"
    />
  );
}

/** Рекомендация другой семье: по ссылке человек создаёт свою семью, а мы знаем, откуда он пришёл. */
function Recommend({ family }: { family: Family }) {
  const url = `${SHARE_ORIGIN}/?from=${family.ref_code}`;
  return (
    <ShareBlock
      kind="referral"
      title="Посоветовать знакомым"
      description="Для другой семьи — у неё будет своё пространство, ваши дела она не увидит."
      url={url}
      text={`Попробуй Семейный диспетчер: пишешь «завтра в 6 забрать Машу» — второму взрослому приходит уведомление, он жмёт «Беру», и видно, что дело взято. Без «я же тебе писала». Бесплатно:
${url}`}
      shortText="Семейный диспетчер — просьбы, которые доходят и выполняются"
      copyLabel="Скопировать рекомендацию"
    />
  );
}

/**
 * Ссылка, копирование и мессенджеры. Ссылку кладём в текст сообщения, а не отдельным полем:
 * Max и часть мессенджеров на iPhone берут из системного «Поделиться» только текст.
 */
function ShareBlock({
  kind,
  title,
  description,
  url,
  text,
  shortText,
  copyLabel,
}: {
  kind: "family" | "referral";
  title: string;
  description?: string;
  url: string;
  text: string;
  shortText: string;
  copyLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const encodedUrl = encodeURIComponent(url);

  const track = (channel: string) => api.track("invite_shared", { channel, kind });

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
      <div>
        <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
      </div>
      <p className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm break-all text-ink-2 select-all">{url}</p>

      <Button className="w-full" onClick={copy}>
        {copied ? "Скопировано — вставьте в Max или любой чат" : copyLabel}
      </Button>

      <div className="grid grid-cols-3 gap-2">
        <a
          href={`https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(shortText)}`}
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
            href={`sms:?&body=${encodeURIComponent(text)}`}
            onClick={() => track("sms")}
            className="flex h-11 items-center justify-center rounded-xl bg-surface-2 text-sm font-medium active:opacity-70"
          >
            SMS
          </a>
        )}
      </div>
      <p className="text-xs text-ink-3">Для Max: скопируйте сообщение и вставьте в чат — ссылка будет внутри.</p>
    </section>
  );
}
