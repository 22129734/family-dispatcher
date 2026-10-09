import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TaskFile } from "../api";

/**
 * Посылки с маркетплейсов: к таким делам предлагаем прикрепить код получения.
 * \b в JS не видит границ кириллических слов, поэтому «вб» отделяем явно.
 */
export const PICKUP_RE =
  /озон|ozon|(?:^|[^а-яёa-z])(?:вб|wb)(?:[^а-яёa-z]|$)|wildberries|вайлдберри|авито|avito|маркет|ламод|lamoda|пвз|пункт выдачи|постамат|посылк|заказ|сдэк|cdek|boxberry|боксберри|почт[аеуы]/i;

const MAX_SIDE = 1600;

/**
 * Фото с телефона весит 3–8 МБ — уменьшаем до 1600 px по длинной стороне (JPEG), этого
 * хватает, чтобы QR- и штрихкод читались сканером на пункте выдачи. PDF не трогаем.
 */
export async function prepareFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000 && file.type !== "image/heic") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Миниатюры файлов задачи; фото открывается на весь экран — показать код на пункте выдачи. */
export function FileStrip({
  files,
  canRemove,
  onRemove,
}: {
  files: TaskFile[];
  canRemove?: (file: TaskFile) => boolean;
  onRemove?: (file: TaskFile) => void;
}) {
  const [viewing, setViewing] = useState<TaskFile | null>(null);
  if (files.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {files.map((file) =>
          file.content_type.startsWith("image/") ? (
            <button
              key={file.id}
              onClick={() => setViewing(file)}
              className="h-16 w-16 overflow-hidden rounded-xl border border-line bg-surface-2"
              aria-label={`Открыть ${file.name}`}
            >
              <img src={file.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ) : (
            <a
              key={file.id}
              href={file.url}
              target="_blank"
              rel="noreferrer"
              className="flex h-16 max-w-40 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 text-sm"
            >
              <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold text-warn">PDF</span>
              <span className="truncate">{file.name}</span>
            </a>
          ),
        )}
      </div>

      {/* Поверх всего экрана: внутри «стеклянной» карточки fixed ограничен её рамками */}
      {viewing &&
        createPortal(
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95" onClick={() => setViewing(null)}>
          <div className="pt-safe flex items-center justify-between px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
            <span className="min-w-0 truncate text-sm">{viewing.name}</span>
            <div className="flex shrink-0 gap-2">
              {canRemove?.(viewing) && onRemove && (
                <button
                  onClick={() => {
                    onRemove(viewing);
                    setViewing(null);
                  }}
                  className="h-9 rounded-xl bg-white/10 px-3 text-sm"
                >
                  Удалить
                </button>
              )}
              <button onClick={() => setViewing(null)} className="h-9 rounded-xl bg-white px-4 text-sm font-semibold text-black">
                Закрыть
              </button>
            </div>
          </div>
          {/* Белая подложка — чтобы QR-код читался сканером даже в тёмной теме */}
          <div className="flex flex-1 items-center justify-center p-3">
            <img src={viewing.url} alt={viewing.name} className="max-h-full max-w-full rounded-lg bg-white object-contain" />
          </div>
        </div>,
          document.body,
        )}
    </>
  );
}

/** Кнопка «Прикрепить»: фото, скриншот, PDF. */
export function AttachButton({
  onFile,
  label = "Прикрепить файл",
  compact = false,
}: {
  onFile: (file: File) => Promise<void>;
  label?: string;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await onFile(await prepareFile(file));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        aria-label={label}
        className={
          compact
            ? "flex h-8 w-8 items-center justify-center rounded-full text-ink-3 active:bg-surface-2 disabled:opacity-40"
            : "flex h-9 items-center gap-1.5 rounded-xl bg-surface-2 px-3 text-sm font-medium active:opacity-70 disabled:opacity-40"
        }
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
        {!compact && (busy ? "Загружаем…" : label)}
      </button>
    </>
  );
}
