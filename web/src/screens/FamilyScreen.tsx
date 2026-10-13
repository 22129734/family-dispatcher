import { Hint } from "../components/Hint";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, type Family, type Member, type PhoneInvite as PhoneInviteRow, type WeekStats } from "../api";
import { PhoneInvite, RecommendSms } from "../components/PhoneInvite";
import { SharePanel } from "../components/SharePanel";
import { useBackClose } from "../backButton";
import { Avatar } from "../components/ui";
import { plural } from "./Today";
import { familyInviteText, familyInviteUrl, SHARE_ORIGIN } from "../share";

const ROLE_LABEL: Record<Member["role"], string> = { adult: "взрослый", teen: "подросток", child: "ребёнок" };

type Sheet = "invite" | "recommend" | null;

export function FamilyScreen({ family, me }: { family: Family; me: Member }) {
  const [sheet, setSheet] = useState<Sheet>(null);
  useBackClose(sheet !== null, () => setSheet(null));
  const alone = family.members.length < 2;
  const [week, setWeek] = useState<WeekStats | null>(null);
  useEffect(() => {
    api.familyWeek().then(setWeek, () => undefined);
  }, []);
  const [phoneInvites, setPhoneInvites] = useState<PhoneInviteRow[]>([]);
  const loadInvites = () => {
    api.phoneInvites().then(setPhoneInvites, () => undefined);
  };
  useEffect(loadInvites, []);
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

      {phoneInvites.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Ждём по номеру</h2>
          <ul className="space-y-2">
            {phoneInvites.map((invite) => (
              <li key={invite.id} className="glass flex items-center gap-3 rounded-2xl px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium tabular-nums">{invite.phone_masked}</p>
                  <p className="text-xs text-ink-2">
                    {invite.sms_sent ? "СМС отправлено · " : ""}войдёт с этим номером — окажется в семье
                  </p>
                </div>
                <button
                  onClick={() => void api.cancelPhoneInvite(invite.id).then(loadInvites)}
                  className="h-9 shrink-0 rounded-xl px-3 text-sm text-ink-3 active:bg-surface-2"
                >
                  Отменить
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!alone && (
        <button
          onClick={() => setSheet("invite")}
          className="h-11 w-full rounded-2xl border border-dashed border-accent/50 text-sm font-semibold text-accent active:bg-accent-soft"
        >
          + Пригласить ещё
        </button>
      )}

      {/* Рекомендация — заметной карточкой: новые семьи приходят от знакомых */}
      <button
        onClick={() => setSheet("recommend")}
        className="glass flex w-full items-center gap-3 rounded-2xl p-4 text-left active:opacity-80"
      >
        <span className="bg-fab flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl" aria-hidden>
          💌
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Посоветуйте знакомым</span>
          <span className="block text-sm text-ink-2">У них будет своя семья и свои дела — ваших они не увидят</span>
        </span>
        <span className="shrink-0 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-accent-ink">Поделиться</span>
      </button>

      {sheet && (
        <BottomSheet onClose={() => setSheet(null)}>
          {sheet === "invite" ? (
            <SharePanel
              kind="family"
              title="Пригласите близкого"
              subtitle="Мужа, жену, маму или старших детей — просьбы будут уходить им, а вы увидите «Беру» и «Сделано»."
              url={familyInviteUrl(family)}
              text={familyInviteText(family, me)}
              qrCaption="Близкий рядом? Пусть наведёт камеру телефона"
              phoneLabel="По номеру"
              phone={<PhoneInvite onInvited={loadInvites} />}
            />
          ) : (
            <SharePanel
              kind="referral"
              title="Посоветуйте знакомым"
              subtitle="У них будет своя семья и свои дела — ваших они не увидят."
              url={referralUrl(family)}
              text={referralText(family)}
              qrCaption="Знакомый рядом? Пусть наведёт камеру телефона"
              phoneLabel="СМС"
              phone={<RecommendSms />}
            />
          )}
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

/** Рекомендация другой семье: по ссылке человек создаёт свою семью, а мы знаем, откуда он пришёл. */
const referralUrl = (family: Family) => `${SHARE_ORIGIN}/?from=${family.ref_code}`;

const referralText = (family: Family) =>
  `Попробуй Семейный диспетчер: пишешь «завтра в 6 забрать Машу» — второму взрослому приходит уведомление, он жмёт «Беру», и видно, что дело взято. Без «я же тебе писала». Бесплатно:
${referralUrl(family)}`;
