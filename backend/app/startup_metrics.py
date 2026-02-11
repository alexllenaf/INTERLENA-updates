from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Dict, Optional

from .storage import get_storage_manager


@dataclass
class StartupTimer:
    label: str
    start: float = field(default_factory=time.perf_counter)

    def elapsed_ms(self) -> float:
        return (time.perf_counter() - self.start) * 1000.0


def log_startup_metrics(phases: Dict[str, float], total_ms: Optional[float] = None) -> None:
    manager = get_storage_manager()
    payload = {
        "phases_ms": phases,
        "total_ms": total_ms,
        "recorded_at": time.time(),
    }
    manager.paths.metrics_path.parent.mkdir(parents=True, exist_ok=True)
    manager.paths.metrics_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
