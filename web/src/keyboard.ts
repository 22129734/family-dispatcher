/**
 * iPhone открывает клавиатуру, только если фокус поставлен прямо в момент нажатия пальцем.
 * Экран PIN-кода появляется позже — когда ответит сервер. Поэтому в момент нажатия «Войти»
 * фокусируем скрытое цифровое поле: клавиатура открывается и остаётся открытой, а когда
 * появятся ячейки PIN, фокус переходит к ним.
 */
let proxy: HTMLInputElement | null = null;

export function holdNumericKeyboard() {
  if (!proxy) {
    proxy = document.createElement("input");
    proxy.type = "tel";
    proxy.inputMode = "numeric";
    proxy.setAttribute("aria-hidden", "true");
    proxy.tabIndex = -1;
    // 16px — иначе iPhone приближает страницу; вне экрана — чтобы не мешать
    Object.assign(proxy.style, {
      position: "fixed",
      top: "0",
      left: "-1000px",
      width: "1px",
      height: "1px",
      opacity: "0",
      fontSize: "16px",
    });
    document.body.appendChild(proxy);
  }
  proxy.focus({ preventScroll: true });
}

/** Убрать клавиатуру, если PIN не понадобился (вход звонком). */
export function releaseKeyboard() {
  if (proxy && document.activeElement === proxy) proxy.blur();
}
