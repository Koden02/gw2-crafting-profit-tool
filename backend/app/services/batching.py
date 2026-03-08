from __future__ import annotations


def chunk_list(items: list[int], chunk_size: int) -> list[list[int]]:
	return [
		items[i:i + chunk_size]
		for i in range(0, len(items), chunk_size)
	]