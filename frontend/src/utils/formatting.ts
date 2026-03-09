export function formatNumber(value: number | null | undefined): string {
	if (value === null || value === undefined) {
		return "-"
	}

	return value.toLocaleString()
}

export function formatPercent(value: number | null | undefined): string {
	if (value === null || value === undefined) {
		return "-"
	}

	return `${(value * 100).toFixed(2)}%`
}

export function formatCoins(value: number | null | undefined): string {
	if (value === null || value === undefined) {
		return "-"
	}

	const copper = Math.round(value)
	const gold = Math.floor(copper / 10000)
	const silver = Math.floor((copper % 10000) / 100)
	const remainderCopper = copper % 100

	const parts: string[] = []

	if (gold > 0) {
		parts.push(`${gold}g`)
	}

	if (gold > 0 || silver > 0) {
		parts.push(`${silver}s`)
	}

	parts.push(`${remainderCopper}c`)

	return parts.join(" ")
}