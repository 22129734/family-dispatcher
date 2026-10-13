import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Голосовой ввод через Web Speech API браузера — временное решение для MVP.
 * Работает в Chrome/Edge/Safari; распознавание идёт на стороне браузера.
 * Для продакшена по 152-ФЗ заменить на запись аудио и SaluteSpeech на нашем бэкенде.
 */

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onaudiostart: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Микрофон не включился за это время (окно разрешения закрыли, ушли в другое приложение) —
// сбрасываем кнопку, а не оставляем её «слушать» вечно
const START_TIMEOUT_MS = 8000;
// После «стоп» браузер должен сообщить об окончании; не сообщил — заканчиваем сами
const STOP_TIMEOUT_MS = 1500;
const DENIED = "Микрофон запрещён. Разрешите его в настройках браузера для этого сайта и нажмите ещё раз";

export function useSpeech(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const finalText = useRef("");
  const lastText = useRef("");
  const timer = useRef<number | undefined>(undefined);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const supported = recognitionCtor() !== null;

  /** Закончить запись: отдать распознанное и вернуть кнопку. Повторный вызов — без эффекта. */
  const finish = useCallback((rec: Recognition | null) => {
    if (!rec || recognition.current !== rec) return;
    recognition.current = null;
    window.clearTimeout(timer.current);
    setListening(false);
    setInterim("");
    const text = (finalText.current || lastText.current).trim();
    finalText.current = "";
    lastText.current = "";
    if (text) onFinalRef.current(text);
  }, []);

  // Запись стартует сразу по нажатию: iPhone разрешает микрофон только в ответ на касание
  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setError(null);
    const rec = new Ctor();
    rec.lang = "ru-RU";
    rec.interimResults = true;
    rec.continuous = false;
    finalText.current = "";
    lastText.current = "";
    setInterim("");

    rec.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      const last = event.results[event.results.length - 1];
      if (last?.isFinal) finalText.current = text;
      lastText.current = text;
      setInterim(text);
      // Пошла речь — микрофон работает, страховка на старт больше не нужна
      window.clearTimeout(timer.current);
    };
    rec.onaudiostart = () => window.clearTimeout(timer.current);
    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") setError(DENIED);
      else if (event.error !== "no-speech" && event.error !== "aborted") setError("Не удалось распознать речь — попробуйте ещё раз");
      finish(rec);
    };
    rec.onend = () => finish(rec);

    recognition.current = rec;
    try {
      rec.start();
    } catch {
      recognition.current = null;
      setError("Микрофон занят — попробуйте ещё раз");
      return;
    }
    setListening(true);
    // Уже запрещено — окна разрешения не будет: сразу говорим, что делать
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((state) => {
        if (state.state === "denied" && recognition.current === rec) {
          rec.abort();
          finish(rec);
          setError(DENIED);
        }
      })
      .catch(() => undefined);
    timer.current = window.setTimeout(() => {
      if (recognition.current !== rec) return;
      rec.abort();
      finish(rec);
      setError("Микрофон не включился. Если браузер спрашивал разрешение — нажмите «Разрешить» и попробуйте ещё раз");
    }, START_TIMEOUT_MS);
  }, [finish]);

  const stop = useCallback(() => {
    const rec = recognition.current;
    if (!rec) return;
    rec.stop();
    // Браузер мог «потерять» запись — через полторы секунды заканчиваем сами
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      rec.abort();
      finish(rec);
    }, STOP_TIMEOUT_MS);
  }, [finish]);

  /** Нажали случайно — выключить микрофон и ничего не отправлять. */
  const cancel = useCallback(() => {
    const rec = recognition.current;
    if (!rec) return;
    finalText.current = "";
    lastText.current = "";
    rec.abort();
    finish(rec);
  }, [finish]);

  // Ушли в другое приложение или окно разрешения увело фокус — запись больше не идёт
  useEffect(() => {
    const onHide = () => {
      const rec = recognition.current;
      if (document.visibilityState === "hidden" && rec) {
        rec.abort();
        finish(rec);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [finish]);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      recognition.current?.abort();
    },
    [],
  );

  return { supported, listening, interim, error, start, stop, cancel };
}
