import type { Scope, Task } from "../api";
import { useBackClose } from "../backButton";
import { describeRepeat } from "../format";

/**
 * Повторяющееся дело меняют или удаляют — только этот раз или этот и все следующие.
 * Как в календаре телефона: серия не пропадает из-за одного пропущенного раза.
 */
export function ScopeSheet({
  task,
  action,
  onPick,
}: {
  task: Task;
  action: "edit" | "remove";
  onPick: (scope: Scope | null) => void;
}) {
  useBackClose(true, () => onPick(null));
  const remove = action === "remove";
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/35" onClick={() => onPick(null)}>
      <div
        className="glass appear pb-safe rounded-t-[28px] px-4 pt-3 pb-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={remove ? "Удалить повторяющееся дело" : "Изменить повторяющееся дело"}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-3/40" />
        <p className="text-lg font-semibold">{remove ? "Удалить повторяющееся дело?" : "Изменить повторяющееся дело?"}</p>
        <p className="mt-1 text-sm text-ink-2">
          «{task.title}» · ↻ {describeRepeat(task.recurrence, task.repeat_days ?? [], task.repeat_until ?? null)}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={() => onPick("this")}
            className="min-h-12 rounded-2xl bg-surface-2 px-4 py-2 text-left font-medium active:opacity-70"
          >
            {remove ? "Только это" : "Только в этот раз"}
            <span className="block text-xs font-normal text-ink-2">
              {remove ? "Следующий повтор останется по расписанию" : "Следующие повторы будут как раньше"}
            </span>
          </button>
          <button
            onClick={() => onPick("all")}
            className={`min-h-12 rounded-2xl px-4 py-2 text-left font-medium active:opacity-70 ${
              remove ? "bg-warn-soft text-warn" : "bg-surface-2"
            }`}
          >
            {remove ? "Это и все следующие" : "Этот и все следующие"}
            <span className={`block text-xs font-normal ${remove ? "text-warn/80" : "text-ink-2"}`}>
              {remove ? "Повтор удалится целиком" : "Изменение сохранится для всей серии"}
            </span>
          </button>
          <button onClick={() => onPick(null)} className="h-11 rounded-2xl text-sm font-medium text-ink-2 active:opacity-60">
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
