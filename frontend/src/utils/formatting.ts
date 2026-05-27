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

	const roundedCopper = Math.round(value)
	const sign = roundedCopper < 0 ? "-" : ""
	const copper = Math.abs(roundedCopper)
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

	return `${sign}${parts.join(" ")}`
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
	if (value === null || value === undefined) {
		return "-"
	}

	const date = new Date(value)

	if (Number.isNaN(date.getTime())) {
		return String(value)
	}

	return date.toLocaleString()
}
