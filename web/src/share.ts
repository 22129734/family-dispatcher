import type { Family, Member } from "./api";

/** Ссылки в приглашениях — латиницей: кириллический адрес мессенджеры показывают как «xn--…». */
export const SHARE_ORIGIN = window.location.hostname.startsWith("xn--")
  ? "https://semeinidispetcher.ru"
  : window.location.origin;

export const familyInviteUrl = (family: Family) => `${SHARE_ORIGIN}/join/${family.invite_code}`;

/** Ссылка внутри текста: Max и часть мессенджеров на iPhone берут из «Поделиться» только текст. */
export const familyInviteText = (family: Family, me: Member) =>
  `${me.name} приглашает тебя в Семейный диспетчер — просьбы будут приходить уведомлением. Открой ссылку:\n${familyInviteUrl(family)}`;

/** Пока в семье нет второго взрослого или подростка, поручать некому. */
export const isAlone = (family: Family | null, meId: string) =>
  !!family && !family.members.some((m) => m.id !== meId && m.role !== "child");
