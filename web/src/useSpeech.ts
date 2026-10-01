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
  onerror: ((e: { error: string }) => void) | null;
};

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeech(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const finalText = useRef("");
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const supported = recognitionCtor() !== null;

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "ru-RU";
    rec.interimResults = true;
    rec.continuous = false;
    finalText.current = "";
    setInterim("");
    setError(null);

    rec.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      const last = event.results[event.results.length - 1];
      if (last?.isFinal) finalText.current = text;
      setInterim(text);
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed") setError("Разрешите доступ к микрофону в настройках браузера");
      else if (event.error !== "no-speech" && event.error !== "aborted") setError("Не удалось распознать речь");
    };
    rec.onend = () => {
      setListening(false);
      const text = finalText.current.trim();
      setInterim("");
      if (text) onFinalRef.current(text);
    };

    recognition.current = rec;
    rec.start();
    setListening(true);
  }, []);

  const stop = useCallback(() => recognition.current?.stop(), []);

  useEffect(() => () => recognition.current?.abort(), []);

  return { supported, listening, interim, error, start, stop };
}
