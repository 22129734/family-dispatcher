import { useState } from "react";
import { api, type Family, type Member } from "../api";
import { Avatar, Button } from "../components/ui";
import { plural } from "./Today";
import { SetPin } from "./SetPin";

const ROLE_LABEL: Record<Member["role"], string> = { adult: "взрослый", teen: "подросток", child: "ребёнок" };

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
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Invite family={family} me={me} />

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
  const url = `${window.location.origin}/join/${family.invite_code}`;
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
