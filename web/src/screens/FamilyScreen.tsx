import { useState } from "react";
import { api, type Family, type Member } from "../api";
import { Avatar, Button, Toggle } from "../components/ui";
import { plural } from "./Today";

export const CAR_LABEL = "Есть машина — можно поручать «отвезти» и «забрать»";

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

  async function share() {
    api.track("invite_shared");
    const text = `Присоединяйся к семье «${family.name}» в Семейном диспетчере — поручения будут приходить тебе сами`;
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
                  {m.has_car ? " · есть машина" : ""}
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
  async function save(changes: Parameters<typeof api.updateMe>[0]) {
    onChanged(await api.updateMe(changes));
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Мои настройки</h2>
      <Toggle checked={me.has_car} onChange={(value) => void save({ has_car: value })}>
        {CAR_LABEL}
      </Toggle>
    </section>
  );
}
