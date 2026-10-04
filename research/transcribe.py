"""Расшифровка интервью: аудио/видео из папки → текст с таймкодами.

Работает локально (faster-whisper), записи никуда не отправляются.
Записи ищутся и в подпапках (например, по интервьюерам). Уже расшифрованные
файлы пропускаются, поэтому скрипт можно запускать после каждого нового интервью.

    .venv/Scripts/python transcribe.py "D:/Projects/Sber500/Интервью"
"""

import sys
import time
from pathlib import Path

import av
import numpy as np
from faster_whisper import WhisperModel

SAMPLE_RATE = 16_000
MEDIA = {".mp3", ".m4a", ".wav", ".ogg", ".opus", ".aac", ".mp4", ".mov", ".webm", ".mkv"}
MODEL = "large-v3-turbo"


def stamp(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m:02d}:{s:02d}"


def load_audio(src: Path) -> np.ndarray:
    """Моно 16 кГц float32. Декодируем сами: faster-whisper 1.2 несовместим с PyAV 19."""
    resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
    chunks = []
    with av.open(str(src)) as container:
        for frame in container.decode(audio=0):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):
            chunks.append(out.to_ndarray().reshape(-1))
    return np.concatenate(chunks).astype(np.float32) / 32768.0


def transcribe(model: WhisperModel, src: Path, dst: Path, source: str) -> None:
    started = time.time()
    segments, info = model.transcribe(
        load_audio(src),
        language="ru",
        vad_filter=True,
        beam_size=5,
        initial_prompt="Интервью о семье, детях, домашних делах и бытовых заботах.",
    )
    lines = [f"[{stamp(seg.start)}] {seg.text.strip()}" for seg in segments]
    dst.write_text(
        f"# {source}\n\nДлительность: {stamp(info.duration)} · модель {MODEL}\n\n"
        + "\n".join(lines)
        + "\n",
        encoding="utf-8",
    )
    print(f"  готово за {time.time() - started:.0f} с → {dst.name}", flush=True)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # консоль Windows в cp1251 не печатает «→»
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out = folder / "Транскрипты"
    out.mkdir(exist_ok=True)

    # Записи могут лежать в подпапках по интервьюерам; расшифровки — в общей папке.
    # Что уже расшифровано, видно по первой строке расшифровки: «# <путь записи>».
    done = {
        md.read_text(encoding="utf-8").split("\n", 1)[0].removeprefix("# ")
        for md in out.glob("*.md")
    }
    todo = [
        f
        for f in sorted(folder.rglob("*"))
        if f.suffix.lower() in MEDIA
        and out not in f.parents
        and f.relative_to(folder).as_posix() not in done
    ]
    if not todo:
        print("Новых записей нет")
        return

    model = WhisperModel(MODEL, device="cpu", compute_type="int8")
    for f in todo:
        source = f.relative_to(folder).as_posix()
        dst = out / f"{f.stem}.md"
        if dst.exists():  # одинаковые имена файлов у разных интервьюеров
            dst = out / f"{f.stem} ({f.parent.name}).md"
        print(f"Расшифровываю {source}…", flush=True)
        transcribe(model, f, dst, source)


if __name__ == "__main__":
    main()
