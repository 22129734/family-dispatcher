import { useState } from "react";
import { api, type Family, type Member } from "../api";
import { Avatar, Button } from "../components/ui";
import { familyInviteText, familyInviteUrl, SHARE_ORIGIN } from "../share";
import { plural } from "./Today";

const ROLE_LABEL: Record<Member["role"], string> = { adult: "взрослый", teen: "подросток", child: "ребёнок" };

export function FamilyScreen({ family, me }: { family: Family; me: Member }) {
  return (
    <div className="space-y-6 px-4 pt-6 pb-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Семья</h1>
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
                      {m.id === me.id ? "включите на вкладке «Дела»" : "просьбы сами не дойдут"}
                    </p>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Invite family={family} me={me} />

      <Recommend family={family} />

    </div>
  );
}

/** Приглашение в свою семью: человек присоединяется к вашим делам. */
function Invite({ family, me }: { family: Family; me: Member }) {
  const url = familyInviteUrl(family);
  return (
    <ShareBlock
      kind="family"
      title="Пригласить в семью"
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

      <Button className="w-full" variant={kind === "family" ? "primary" : "soft"} onClick={copy}>
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
