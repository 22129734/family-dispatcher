import { useEffect, useRef } from "react";

/**
 * Системная «Назад» на Android (и жест «назад»): закрывает верхний слой — шторку,
 * раздел «Ещё», вкладку — а не выходит из приложения. Каждый открытый слой кладёт
 * шаг в историю браузера; «Назад» снимает его и закрывает слой. Закрыли слой кнопкой
 * в интерфейсе — шаг убираем сами, чтобы следующая «Назад» не была «пустой».
 */

interface Layer {
  close: () => void;
}

const stack: Layer[] = [];
// Шаги, которые мы убираем сами (history.back) — их popstate не закрывает следующий слой
let ownPops = 0;

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (ownPops > 0) {
      ownPops -= 1;
      return;
    }
    stack.pop()?.close();
  });
}

/** Пока open — «Назад» вызывает close вместо выхода из приложения. */
export function useBackClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    const layer: Layer = { close: () => closeRef.current() };
    stack.push(layer);
    window.history.pushState({ fdLayer: stack.length }, "");
    return () => {
      const index = stack.indexOf(layer);
      if (index < 0) return; // закрыли «Назад» — шаг уже снят
      stack.splice(index, 1);
      ownPops += 1;
      window.history.back();
    };
  }, [open]);
}
