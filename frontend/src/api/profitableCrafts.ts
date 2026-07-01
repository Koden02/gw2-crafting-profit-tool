export type IngredientBreakdown = {
	item_id: number
	name: string
	count: number
	owned_count: number
	missing_count: number
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
	ingredient_sale_value: number
	crafted_item_value: number
	value_add: number
	recommendation: string
	ingredients?: IngredientBreakdown[]
}

export type MaterialPricingMode = "buy" | "sell"
export type OutputPricingMode = "buy" | "sell"

export type ProfitScenario = ProfitableCraft & {
	material_pricing: MaterialPricingMode
	output_pricing: OutputPricingMode
}

export type SyncStatus = {
	price_last_updated: string | null
	price_count: number
	item_count: number
	recipe_count: number
}

export type PriceSyncResult = {
	status: string
	prices_upserted: number
}

export type ItemSyncResult = {
	status: string
	items_upserted: number
}

export type RecipeSyncResult = {
	status: string
	recipes_upserted: number
}

export type AccountHoldingsSyncResult = {
	status: string
	material_items: number
	bank_items: number
	unique_items: number
	total_owned: number
	last_updated: string
}

export type AccountHoldingsStatus = {
	holding_count: number
	total_owned: number
	last_updated: string | null
}

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

export async function fetchProfitScenarios(itemId: number): Promise<ProfitScenario[]> {
	const response = await fetch(`${API_BASE_URL}/api/profit/${itemId}/scenarios`)

	if (!response.ok) {
		throw new Error(`Failed to fetch profit scenarios: ${response.status}`)
	}

	return response.json()
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
	const response = await fetch(`${API_BASE_URL}/api/sync/status`)

	if (!response.ok) {
		throw new Error(`Failed to fetch sync status: ${response.status}`)
	}

	return response.json()
}

export async function syncCommercePrices(): Promise<PriceSyncResult> {
	const response = await fetch(`${API_BASE_URL}/api/sync/prices`, {
		method: "POST",
	})

	if (!response.ok) {
		throw new Error(`Failed to sync Trading Post prices: ${response.status}`)
	}

	return response.json()
}

export async function syncItems(): Promise<ItemSyncResult> {
	const response = await fetch(`${API_BASE_URL}/api/sync/items`, {
		method: "POST",
	})

	if (!response.ok) {
		throw new Error(`Failed to sync items: ${response.status}`)
	}

	return response.json()
}

export async function syncRecipes(): Promise<RecipeSyncResult> {
	const response = await fetch(`${API_BASE_URL}/api/sync/recipes`, {
		method: "POST",
	})

	if (!response.ok) {
		throw new Error(`Failed to sync recipes: ${response.status}`)
	}

	return response.json()
}

export async function syncAccountHoldings(apiKey: string): Promise<AccountHoldingsSyncResult> {
	const response = await fetch(`${API_BASE_URL}/api/account/sync/holdings`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ api_key: apiKey }),
	})

	if (!response.ok) {
		const detail = await response.json().catch(() => null)
		const message = typeof detail?.detail === "string" ? detail.detail : `Failed to sync account holdings: ${response.status}`
		throw new Error(message)
	}

	return response.json()
}

export async function fetchAccountHoldingsStatus(): Promise<AccountHoldingsStatus> {
	const response = await fetch(`${API_BASE_URL}/api/account/holdings/status`)

	if (!response.ok) {
		throw new Error(`Failed to fetch account holdings status: ${response.status}`)
	}

	return response.json()
}
