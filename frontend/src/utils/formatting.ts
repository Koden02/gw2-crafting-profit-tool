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

export function formatInventoryLocation(source: string, position: string): string {
    if (source.startsWith("character:")) {
        const [bag, slot] = position.split(":").map(Number)
        return `${source.slice(10)}, bag ${bag + 1}, slot ${slot + 1}`
    }
    if (source === "materials") return "material storage"
    return `${source === "shared" ? "shared inventory" : "bank"}, slot ${Number(position) + 1}`
}
