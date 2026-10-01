import { useState } from "react";
import { api, type Family, type Member } from "../api";
import { Avatar, Button, Toggle } from "../components/ui";
import { avatarTone, formatMinutes } from "../format";
import { plural } from "./Today";

const ROLE_LABEL: Record<Member["role"], string> = { adult: "взрослый", teen: "подросток", child: "ребёнок" };

export function FamilyScreen({
  family,
  me,
  onMeChanged,
  onLogout,
}: {
  family: Family;
  me: Member;
  onMeChanged: (m: Member) => void;
  onLogout: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const inviteUrl = `${window.location.origin}/join/${family.invite_code}`;
  const totalMinutes = family.labour.reduce((sum, row) => sum + row.minutes, 0);
  const leader = [...family.labour].sort((a, b) => b.share - a.share)[0];

  async function share() {
    api.track("invite_shared");
    const text = `Присоединяйся к семье «${family.name}» в Семейном диспетчере — он сам распределяет домашние дела`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Семейный диспетчер", text, url: inviteUrl });
        return;
      } catch {
        /* пользователь закрыл окно — пробуем скопировать */
      }
    }
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Скопируйте ссылку", inviteUrl);
    }
  }

  return (
    <div className="space-y-6 px-4 pt-6 pb-6">
      <header>
        <p className="text-sm text-ink-2">Семья</p>
        <h1 className="text-2xl font-bold tracking-tight">{family.name}</h1>
      </header>

      <section className="rounded-3xl bg-surface p-5 shadow-sm">
        <h2 className="text-base font-semibold">Индекс невидимого труда</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          {totalMinutes
            ? `На этой неделе — ${formatMinutes(totalMinutes)} домашних дел`
            : "Появится, когда в семье будут дела на этой неделе"}
        </p>

        {totalMinutes > 0 && (
          <>
            <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-surface-2">
              {family.labour
                .filter((row) => row.share > 0)
                .map((row) => (
                  <div
                    key={row.member_id}
                    className={avatarTone(row.member_id, family.members)}
                    style={{ width: `${row.share * 100}%` }}
                  />
                ))}
            </div>
            <ul className="mt-4 space-y-3">
              {family.labour.map((row) => {
                const member = family.members.find((m) => m.id === row.member_id);
                return (
                  <li key={row.member_id} className="flex items-center gap-3">
                    <Avatar member={member} members={family.members} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {row.name}
                        {row.member_id === me.id && <span className="text-ink-3"> · вы</span>}
                      </p>
                      <p className="text-xs text-ink-2">
                        {formatMinutes(row.minutes)} · сделано {row.done_tasks}, в работе {row.open_tasks}
                      </p>
                    </div>
                    <span className="text-lg font-semibold tabular-nums">{Math.round(row.share * 100)}%</span>
                  </li>
                );
              })}
            </ul>
            {leader && leader.share >= 0.6 && family.members.length > 1 && (
              <p className="mt-4 rounded-xl bg-accent-soft px-3 py-2 text-sm">
                Больше половины дел на {leader.name}. Новые задачи диспетчер будет чаще отдавать остальным.
              </p>
            )}
          </>
        )}
      </section>

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
                <p className="text-sm text-ink-2">
                  {ROLE_LABEL[m.role]}
                  {m.has_car ? " · за рулём" : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <Button className="mt-3 w-full" onClick={share}>
          {copied ? "Ссылка скопирована" : "Пригласить в семью"}
        </Button>
      </section>

      <Profile me={me} onChanged={onMeChanged} />

      <Button variant="ghost" className="w-full" onClick={onLogout}>
        Выйти на этом устройстве
      </Button>
    </div>
  );
}

function Profile({ me, onChanged }: { me: Member; onChanged: (m: Member) => void }) {
  const [dislikes, setDislikes] = useState(me.dislikes.join(", "));

  async function save(changes: Parameters<typeof api.updateMe>[0]) {
    onChanged(await api.updateMe(changes));
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Мои настройки</h2>
      <Toggle checked={me.has_car} onChange={(value) => void save({ has_car: value })}>
        Я за рулём и могу возить
      </Toggle>
      <label className="block rounded-2xl border border-line bg-surface px-4 py-3">
        <span className="block text-sm font-medium">Чего я избегаю</span>
        <span className="block text-xs text-ink-2">Через запятую — диспетчер учтёт при распределении</span>
        <input
          value={dislikes}
          onChange={(e) => setDislikes(e.target.value)}
          onBlur={() =>
            void save({
              dislikes: dislikes
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="готовить, гладить"
          className="mt-2 h-10 w-full rounded-xl bg-surface-2 px-3 text-base outline-none"
        />
      </label>
    </section>
  );
}
