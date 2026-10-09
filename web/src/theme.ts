/**
 * Темы оформления. Выбор хранится на сервере у участника (переезжает между устройствами)
 * и в памяти телефона — чтобы при запуске сразу рисовать нужную тему, без мигания.
 * Кто тему не выбирал — получает «Лаванду».
 */
export type ThemeKey = "lavender" | "dawn" | "night" | "mint";

export const DEFAULT_THEME: ThemeKey = "lavender";

export interface ThemeInfo {
  key: ThemeKey;
  title: string;
  note: string;
  page: string;
  hero: string;
  glass: string;
  glassBorder: string;
  ink: string;
}

export const THEMES: ThemeInfo[] = [
  {
    key: "lavender",
    title: "Лаванда",
    note: "современная, светлая",
    page: "linear-gradient(160deg,#e7e2ff,#dbeaff 55%,#f3e8ff)",
    hero: "linear-gradient(135deg,#6c4cf5,#9b6bff 60%,#ff7fb6 130%)",
    glass: "rgba(255,255,255,.6)",
    glassBorder: "rgba(255,255,255,.9)",
    ink: "#1d1530",
  },
  {
    key: "dawn",
    title: "Рассвет",
    note: "тёплая, мягкая",
    page: "linear-gradient(165deg,#ffe3d3,#ffd0e1 48%,#f6e7ff)",
    hero: "linear-gradient(135deg,#ff8a5b,#ff5f8f)",
    glass: "rgba(255,255,255,.6)",
    glassBorder: "rgba(255,255,255,.9)",
    ink: "#2b1720",
  },
  {
    key: "night",
    title: "Вечер",
    note: "тёмная",
    page: "linear-gradient(165deg,#1b1640,#2c1a3d 50%,#3a1f2e)",
    hero: "linear-gradient(135deg,#ff8a5b,#ff5f8f)",
    glass: "rgba(255,255,255,.1)",
    glassBorder: "rgba(255,255,255,.16)",
    ink: "#f7f1ff",
  },
  {
    key: "mint",
    title: "Мята и персик",
    note: "свежая, лучше читается",
    page: "linear-gradient(170deg,#e3f7ef,#fff3e6 60%,#ffe9dc)",
    hero: "linear-gradient(135deg,#1fae7a,#5cc99a)",
    glass: "rgba(255,255,255,.95)",
    glassBorder: "#ffffff",
    ink: "#17261f",
  },
];

const KEY = "fd.theme";
const THEME_COLORS: Record<ThemeKey, string> = {
  lavender: "#e7e2ff",
  dawn: "#ffe3d3",
  night: "#1b1640",
  mint: "#e3f7ef",
};

const isTheme = (value: unknown): value is ThemeKey =>
  typeof value === "string" && THEMES.some((t) => t.key === value);

function stored(): ThemeKey {
  try {
    const value = localStorage.getItem(KEY);
    return isTheme(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

let current: ThemeKey = stored();

export const currentTheme = () => current;

export function applyTheme(theme: string | null | undefined) {
  current = isTheme(theme) ? theme : DEFAULT_THEME;
  document.documentElement.dataset.theme = current;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[current]);
  try {
    localStorage.setItem(KEY, current);
  } catch {
    /* приватный режим — тема проживёт до перезагрузки */
  }
}

/**
 * Слабые телефоны тормозят на размытии под стеклом — там рисуем плотную подложку того же цвета.
 */
function detectLite() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lowMemory = (nav.deviceMemory ?? 8) <= 3;
  const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4;
  if (lowMemory || fewCores) document.documentElement.classList.add("lite");
}

applyTheme(current);
detectLite();
