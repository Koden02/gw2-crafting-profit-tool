from __future__ import annotations

import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator


class PriceSyncBusyError(RuntimeError):
	pass


class PriceSyncLock:
	def __init__(self) -> None:
		self._lock = threading.Lock()
		self._state_lock = threading.Lock()
		self._running = False
		self._source: str | None = None
		self._started_at: datetime | None = None

	@contextmanager
	def acquire(self, source: str) -> Iterator[None]:
		if not self._lock.acquire(blocking=False):
			raise PriceSyncBusyError("Trading Post price sync is already running.")

		with self._state_lock:
			self._running = True
			self._source = source
			self._started_at = datetime.now(timezone.utc)

		try:
			yield
		finally:
			with self._state_lock:
				self._running = False
				self._source = None
				self._started_at = None

			self._lock.release()

	def status(self) -> dict[str, object]:
		with self._state_lock:
			return {
				"running": self._running,
				"source": self._source,
				"started_at": self._started_at,
			}


price_sync_lock = PriceSyncLock()
