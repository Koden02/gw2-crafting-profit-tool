from __future__ import annotations

import asyncio
import threading
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.services.price_history_service import PriceHistoryService, normalize_datetime, utc_now
from app.services.price_sync_lock import PriceSyncBusyError, price_sync_lock
from app.services.sync_service import SyncService


class AutoPriceSyncService:
	def __init__(self) -> None:
		self._task: asyncio.Task | None = None
		self._stop_event: asyncio.Event | None = None
		self._state_lock = threading.Lock()
		self._running = False
		self._last_started_at: datetime | None = None
		self._last_finished_at: datetime | None = None
		self._last_error: str | None = None
		self._last_result: dict[str, Any] | None = None

	def start(self) -> None:
		if self._task is not None and not self._task.done():
			return

		self._stop_event = asyncio.Event()
		self._task = asyncio.create_task(self._run())

	async def stop(self) -> None:
		if self._stop_event is not None:
			self._stop_event.set()

		if self._task is not None:
			self._task.cancel()
			try:
				await self._task
			except asyncio.CancelledError:
				pass

		self._task = None
		self._stop_event = None

	def status(self, db: Session) -> dict[str, Any]:
		history_service = PriceHistoryService(db)
		config = history_service.get_config()
		last_price_sync_at = history_service.latest_price_sync_at()
		last_snapshot_at = history_service.latest_snapshot_at()
		next_due_at = self._next_due_at(
			last_price_sync_at=last_price_sync_at,
			interval_minutes=int(config["price_sync_interval_minutes"]),
			enabled=bool(config["auto_price_sync_enabled"]),
		)
		sync_lock_status = price_sync_lock.status()

		with self._state_lock:
			return {
				"enabled": bool(config["auto_price_sync_enabled"]),
				"running": bool(sync_lock_status["running"]),
				"running_source": sync_lock_status["source"],
				"running_started_at": sync_lock_status["started_at"],
				"auto_worker_running": self._running,
				"interval_minutes": int(config["price_sync_interval_minutes"]),
				"last_price_sync_at": last_price_sync_at,
				"last_snapshot_at": last_snapshot_at,
				"next_due_at": next_due_at,
				"last_started_at": self._last_started_at,
				"last_finished_at": self._last_finished_at,
				"last_error": self._last_error,
				"last_result": self._last_result,
			}

	async def run_once_if_due(self) -> None:
		await asyncio.to_thread(self._run_once_blocking, False)

	async def _run(self) -> None:
		if self._stop_event is None:
			return

		try:
			await asyncio.sleep(10)

			while not self._stop_event.is_set():
				await self.run_once_if_due()

				try:
					await asyncio.wait_for(self._stop_event.wait(), timeout=60)
				except TimeoutError:
					continue
		except asyncio.CancelledError:
			raise

	def _run_once_blocking(self, force: bool) -> None:
		with self._state_lock:
			self._running = True
			self._last_started_at = utc_now()
			self._last_error = None

		db = SessionLocal()
		try:
			history_service = PriceHistoryService(db)
			config = history_service.get_config()

			if not bool(config["auto_price_sync_enabled"]):
				return

			last_price_sync_at = history_service.latest_price_sync_at()
			if not force and not self._is_due(last_price_sync_at, int(config["price_sync_interval_minutes"])):
				return

			result = SyncService(db).sync_prices_with_history(source="auto")

			with self._state_lock:
				self._last_result = result
		except PriceSyncBusyError as exc:
			with self._state_lock:
				self._last_result = {
					"status": "skipped",
					"reason": str(exc),
				}
		except Exception as exc:
			with self._state_lock:
				self._last_error = str(exc)
		finally:
			db.close()

			with self._state_lock:
				self._running = False
				self._last_finished_at = utc_now()

	def _is_due(self, last_price_sync_at: datetime | None, interval_minutes: int) -> bool:
		last_price_sync_at = normalize_datetime(last_price_sync_at)

		if last_price_sync_at is None:
			return True

		return utc_now() - last_price_sync_at >= timedelta(minutes=interval_minutes)

	def _next_due_at(
		self,
		last_price_sync_at: datetime | None,
		interval_minutes: int,
		enabled: bool,
	) -> datetime | None:
		if not enabled:
			return None

		last_price_sync_at = normalize_datetime(last_price_sync_at)

		if last_price_sync_at is None:
			return utc_now()

		return last_price_sync_at + timedelta(minutes=interval_minutes)


auto_price_sync_service = AutoPriceSyncService()
