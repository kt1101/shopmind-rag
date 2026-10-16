from __future__ import annotations

import argparse
import json
import shutil
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Iterator


def _prepare_destination(path: Path, force: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not force:
        raise FileExistsError(f"refusing to overwrite existing raw file without --force: {path}")


def copy_source_dir(source_dir: Path, output_dir: Path, force: bool = False) -> int:
    copied = 0
    for source in sorted(path for path in source_dir.rglob("*") if path.is_file()):
        destination = output_dir / source.relative_to(source_dir)
        _prepare_destination(destination, force)
        shutil.copy2(source, destination)
        copied += 1
    return copied


def _manifest_entries(path: Path) -> Iterator[tuple[str, str | None]]:
    text = path.read_text(encoding="utf-8")
    stripped = text.lstrip()
    if stripped.startswith("["):
        values = json.loads(text)
        for value in values:
            if isinstance(value, str):
                yield value, None
            else:
                yield str(value["url"]), value.get("path")
        return
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("{"):
            value = json.loads(line)
            yield str(value["url"]), value.get("path")
        else:
            yield line, None


def download_manifest(manifest: Path, output_dir: Path, force: bool = False) -> int:
    downloaded = 0
    for url, relative_path in _manifest_entries(manifest):
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError(f"manifest URL must be HTTP(S): {url}")
        if relative_path:
            relative = Path(relative_path)
        else:
            filename = Path(parsed.path).name
            if not filename:
                raise ValueError(f"cannot derive filename from URL: {url}")
            relative = Path(filename)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"unsafe manifest destination path: {relative}")
        destination = output_dir / relative
        _prepare_destination(destination, force)
        with urllib.request.urlopen(url) as response, destination.open("wb") as output:
            shutil.copyfileobj(response, output)
        downloaded += 1
    return downloaded


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Acquire immutable ABO raw files from a local directory or URL manifest.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--source-dir", type=Path)
    source.add_argument("--manifest", type=Path)
    parser.add_argument("--output-dir", "--output", dest="output_dir", type=Path, default=Path("data/raw"))
    parser.add_argument("--force", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.source_dir:
        count = copy_source_dir(args.source_dir, args.output_dir, force=args.force)
    else:
        count = download_manifest(args.manifest, args.output_dir, force=args.force)
    print(f"acquired {count} files into {args.output_dir}")


if __name__ == "__main__":
    main()
