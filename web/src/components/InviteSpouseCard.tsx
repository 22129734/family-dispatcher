import { useEffect, useState } from "react";
import { api, type Family, type Member } from "../api";
import { familyInviteText } from "../share";

/**
 * Пока в семье один взрослый, продукт не работает: поручать некому. Карточку нельзя скрыть —
 * она уходит сама, когда второй человек войдёт по ссылке.
 */
export function InviteSpouseCard({
  family,
  me,
  onMoreWays,
}: {
  family: Family;
  me: Member;
  onMoreWays: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = familyInviteText(family, me);

  useEffect(() => {
    api.track("screen_view", { screen: "invite_spouse_card" });
  }, []);

  async function send() {
    if (typeof navigator.share === "function") {
      api.track("invite_shared", { channel: "system", kind: "family", from: "today" });
      try {
        await navigator.share({ text });
      } catch {
        /* закрыли окно — ничего не делаем */
      }
      return;
    }
    api.track("invite_shared", { channel: "copy", kind: "family", from: "today" });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Скопируйте приглашение", text);
    }
  }

  return (
    <section className="appear mb-4 rounded-2xl border-2 border-accent bg-accent-soft p-4">
      <div className="flex items-start gap-3">
        <svg className="mt-0.5 shrink-0 text-accent" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6" />
        </svg>
        <div>
          <p className="font-semibold">Пригласите мужа или жену</p>
          <p className="mt-1 text-sm text-ink-2">
            Сейчас в семье только вы — все дела записываются на вас. Пригласите второго взрослого, и просьбы
            будут уходить ему.
          </p>
        </div>
      </div>
      <button
        onClick={() => void send()}
        className="mt-3 h-11 w-full rounded-xl bg-accent font-semibold text-accent-ink active:opacity-80"
      >
        {copied ? "Скопировано — вставьте в Max или любой чат" : "Отправить приглашение"}
      </button>
      <button onClick={onMoreWays} className="mt-2 w-full text-center text-sm text-ink-2 active:opacity-70">
        Другие способы: Max, Telegram, ВК
      </button>
    </section>
  );
}
