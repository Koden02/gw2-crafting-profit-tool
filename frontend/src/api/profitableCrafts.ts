export type ProfitableCraft = {
	item_id: number
	name: string
	disciplines: string[]
	craft_cost: number
	buy_price: number | null
	buy_quantity: number
	sell_price: number
	sell_quantity: number
	net_sale: number
	profit: number
	roi: number | null
	spread: number | null
	spread_ratio: number | null
	low_liquidity: boolean
	suspicious_spread: boolean
}

export type ProfitableCraftQuery = {
	limit?: number
	min_profit?: number
	min_buy_quantity?: number
	min_sell_quantity?: number
	exclude_low_liquidity?: boolean
	exclude_suspicious_spread?: boolean
	discipline?: string
}

const API_BASE_URL = "http://127.0.0.1:8000"

export async function fetchProfitableCrafts(
	query: ProfitableCraftQuery = {},
): Promise<ProfitableCraft[]> {
	const params = new URLSearchParams()

	if (query.limit !== undefined) params.set("limit", String(query.limit))
	if (query.min_profit !== undefined) params.set("min_profit", String(query.min_profit))
	if (query.min_buy_quantity !== undefined) params.set("min_buy_quantity", String(query.min_buy_quantity))
	if (query.min_sell_quantity !== undefined) params.set("min_sell_quantity", String(query.min_sell_quantity))
	if (query.exclude_low_liquidity !== undefined) {
		params.set("exclude_low_liquidity", String(query.exclude_low_liquidity))
	}
	if (query.exclude_suspicious_spread !== undefined) {
		params.set("exclude_suspicious_spread", String(query.exclude_suspicious_spread))
	}
	if (query.discipline) params.set("discipline", query.discipline)

	const response = await fetch(`${API_BASE_URL}/api/profitable-crafts?${params.toString()}`)

	if (!response.ok) {
		throw new Error(`Failed to fetch profitable crafts: ${response.status}`)
	}

	return response.json()
}