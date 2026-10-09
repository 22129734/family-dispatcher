import { useEffect, useRef, useState } from "react";
import { api } from "../api";

const MAX_SECONDS = 180;

type Stage = "idle" | "recording" | "recorded" | "sending" | "sent";

/** Формат, который умеет браузер: Chrome/Android — webm (opus), iPhone — mp4 (aac). */
function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

/**
 * Голосовой отзыв в поддержку: записал — послушал — отправил. Письмо с записью и
 * расшифровкой уходит на ящик команды; можно добавить текст или написать только текстом.
 */
export function VoiceFeedback({ deviceInfo }: { deviceInfo: () => string }) {
  const [stage, setStage] = useState<Stage>("idle");
  const [seconds, setSeconds] = useState(0);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const canRecord = typeof navigator.mediaDevices?.getUserMedia === "function" && pickMime() !== undefined;

  useEffect(
    () => () => {
      window.clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => () => void (audioUrl && URL.revokeObjectURL(audioUrl)), [audioUrl]);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        window.clearInterval(timer.current);
        const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
        setAudio(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setStage("recorded");
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setStage("recording");
      timer.current = window.setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) rec.state === "recording" && rec.stop();
          return s + 1;
        });
      }, 1000);
      api.track("screen_view", { screen: "feedback_record" });
    } catch {
      setError("Нет доступа к микрофону — разрешите его в настройках браузера или напишите текстом");
    }
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  function reset() {
    setAudio(null);
    setAudioUrl(null);
    setStage("idle");
  }

  async function send() {
    setError(null);
    setStage("sending");
    try {
      await api.feedback(audio, text.trim() || null, deviceInfo());
      setStage("sent");
      setAudio(null);
      setAudioUrl(null);
      setText("");
    } catch (err) {
      setError((err as Error).message);
      setStage(audio ? "recorded" : "idle");
    }
  }

  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  if (stage === "sent") {
    return (
      <section className="bg-hero rounded-2xl p-4">
        <p className="font-semibold">Спасибо! Сообщение уже у команды</p>
        <p className="mt-1 text-sm opacity-90">Прочитаем и ответим, если нужно — по номеру телефона.</p>
        <button onClick={() => setStage("idle")} className="mt-3 h-9 rounded-xl bg-white/25 px-3 text-sm font-semibold">
          Написать ещё
        </button>
      </section>
    );
  }

  return (
    <section className="bg-surface space-y-3 rounded-2xl border p-4">
      <div>
        <p className="font-semibold">Что-то не нравится? Скажите голосом</p>
        <p className="mt-0.5 text-sm text-ink-2">Запись сразу уйдёт команде — с расшифровкой, чтобы мы быстрее поняли.</p>
      </div>

      {canRecord && stage === "idle" && (
        <button
          onClick={() => void start()}
          className="bg-fab flex h-14 w-full items-center justify-center gap-2 rounded-2xl font-semibold shadow-md active:scale-[0.99]"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />
          </svg>
          Записать голосовое
        </button>
      )}

      {stage === "recording" && (
        <button
          onClick={stop}
          className="listening flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-warn font-semibold text-white"
        >
          <span className="h-3 w-3 animate-pulse rounded-full bg-white" />
          Идёт запись {time} — нажмите, чтобы закончить
        </button>
      )}

      {(stage === "recorded" || stage === "sending") && audioUrl && (
        <div className="space-y-2">
          <audio src={audioUrl} controls className="w-full" />
          <button onClick={reset} disabled={stage === "sending"} className="text-sm font-medium text-ink-2">
            Записать заново
          </button>
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
        rows={2}
        placeholder={canRecord ? "Можно добавить текст или написать только текстом" : "Напишите, что не так или чего не хватает"}
        className="w-full resize-none rounded-xl border border-line bg-bg px-3 py-2 text-base outline-none focus:border-accent"
      />

      {error && <p className="text-sm text-warn">{error}</p>}

      <button
        onClick={() => void send()}
        disabled={stage === "sending" || stage === "recording" || (!audio && !text.trim())}
        className="h-11 w-full rounded-xl bg-accent font-semibold text-accent-ink transition disabled:opacity-40"
      >
        {stage === "sending" ? "Отправляем…" : "Отправить команде"}
      </button>
    </section>
  );
}
