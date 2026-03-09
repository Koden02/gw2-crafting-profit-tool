export type IngredientBreakdown = {
	item_id: number
	name: string
	count: number
	buy_price: number | null
	craft_price: number | null
	chosen_source: string
	chosen_unit_cost: number | null
	total_cost: number | null
}

export type ProfitableCraft = {
	item_id: number
	name: string
	disciplines: string[]
	output_item_count?: number
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
	ingredients?: IngredientBreakdown[]
}

export type MaterialPricingMode = "buy" | "sell"
export type OutputPricingMode = "buy" | "sell"

export type ProfitableCraftQuery = {
	limit?: number
	min_profit?: number
	min_buy_quantity?: number
	min_sell_quantity?: number
	exclude_low_liquidity?: boolean
	exclude_suspicious_spread?: boolean
	discipline?: string
	material_pricing?: MaterialPricingMode
	output_pricing?: OutputPricingMode
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
	if (query.material_pricing) params.set("material_pricing", query.material_pricing)
	if (query.output_pricing) params.set("output_pricing", query.output_pricing)

	const response = await fetch(`${API_BASE_URL}/api/profitable-crafts?${params.toString()}`)

	if (!response.ok) {
		throw new Error(`Failed to fetch profitable crafts: ${response.status}`)
	}

	return response.json()
}

export async function fetchProfitDetail(
	itemId: number,
	options?: {
		material_pricing?: MaterialPricingMode
		output_pricing?: OutputPricingMode
	},
): Promise<ProfitableCraft> {
	const params = new URLSearchParams()

	if (options?.material_pricing) {
		params.set("material_pricing", options.material_pricing)
	}

	if (options?.output_pricing) {
		params.set("output_pricing", options.output_pricing)
	}

	const suffix = params.toString() ? `?${params.toString()}` : ""
	const response = await fetch(`${API_BASE_URL}/api/profit/${itemId}${suffix}`)

	if (!response.ok) {
		throw new Error(`Failed to fetch profit detail: ${response.status}`)
	}

	return response.json()
}