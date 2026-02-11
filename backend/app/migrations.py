from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable

from sqlalchemy.engine import Engine


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    apply: Callable[[Engine], None]


def _noop(_: Engine) -> None:
    return None


MIGRATIONS: Iterable[Migration] = (
    Migration(version=1, name="baseline", apply=_noop),
)

SCHEMA_VERSION = max(m.version for m in MIGRATIONS)


def iter_pending(current_version: int) -> Iterable[Migration]:
    for migration in MIGRATIONS:
        if migration.version > current_version:
            yield migration
