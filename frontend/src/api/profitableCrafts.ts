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

export type ListingDepthLevel = {
	unit_price: number
	quantity: number
	listings: number
	net_sale: number
	profit_per_item: number
}

export type ListingDepthAnalysis = {
	item_id: number
	name: string
	craft_cost: number
	break_even_sale_price: number
	last_profitable_buy_order_price: number | null
	instant_sell_limit_quantity: number
	instant_sell_depth_profit: number
	profitable_buy_order_levels: ListingDepthLevel[]
	profitable_buy_order_level_count: number
	profitable_listing_price_floor: number
	existing_competing_sell_quantity: number
	competing_sell_levels: ListingDepthLevel[]
	competing_sell_level_count: number
	estimated_market_pressure: string
}

export type SyncStatus = {
	price_last_updated: string | null
	price_count: number
	item_count: number
	recipe_count: number
}

export type SnapshotItemMode = "relevant" | "all"
export type PriceHistoryRelevanceFilter = "all" | "relevant" | "ignored" | "untracked"

export type PriceHistoryConfig = {
	auto_price_sync_enabled: boolean
	price_sync_interval_minutes: number
	raw_snapshot_retention_days: number
	hourly_rollup_retention_days: number
	daily_rollup_retention_days: number
	max_history_mb: number
	snapshot_item_mode: SnapshotItemMode
}

export type AutoPriceSyncStatus = {
	enabled: boolean
	running: boolean
	interval_minutes: number
	last_price_sync_at: string | null
	last_snapshot_at: string | null
	next_due_at: string | null
	last_started_at: string | null
	last_finished_at: string | null
	last_error: string | null
	last_result: Record<string, unknown> | null
}

export type PriceHistoryEstimate = {
	config: PriceHistoryConfig
	price_count: number
	relevant_price_item_count: number
	ignored_item_count: number
	tracked_item_count: number
	runs_per_day: number
	raw_rows_per_day: number
	estimated_raw_mb_per_day: number
	estimated_raw_retention_mb: number
	estimated_hourly_rollup_mb: number
	estimated_daily_rollup_mb: number
	estimated_total_retention_mb: number
	current_raw_snapshot_count: number
	current_hourly_rollup_count: number
	current_daily_rollup_count: number
	current_history_estimated_mb: number
	database_file_mb: number
	max_history_mb: number
	snapshot_row_estimated_bytes: number
	rollup_row_estimated_bytes: number
}

export type PriceHistoryRelevanceItem = {
	item_id: number
	name: string
	has_price: boolean
	is_relevant: boolean
	is_ignored: boolean
	is_tracked: boolean
	reasons: string[]
}

export type PriceHistoryRelevanceResponse = {
	items: PriceHistoryRelevanceItem[]
	total: number
	limit: number
	offset: number
	filter: PriceHistoryRelevanceFilter
	search: string
}

export type PriceSyncResult = {
	status: string
	prices_upserted: number
	snapshot_status?: string
	snapshot_reason?: string | null
	snapshots_recorded?: number
	snapshot_observed_at?: string | null
	history_pruned?: Record<string, number>
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

export async function fetchListingDepth(
	itemId: number,
	options?: {
		material_pricing?: MaterialPricingMode
	},
): Promise<ListingDepthAnalysis> {
	const params = new URLSearchParams()

	if (options?.material_pricing) {
		params.set("material_pricing", options.material_pricing)
	}

	const suffix = params.toString() ? `?${params.toString()}` : ""
	const response = await fetch(`${API_BASE_URL}/api/profit/${itemId}/listing-depth${suffix}`)

	if (!response.ok) {
		const detail = await response.json().catch(() => null)
		const message = typeof detail?.detail === "string" ? detail.detail : `Failed to fetch listing depth: ${response.status}`
		throw new Error(message)
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

export async function fetchAutoPriceSyncStatus(): Promise<AutoPriceSyncStatus> {
	const response = await fetch(`${API_BASE_URL}/api/sync/auto-price/status`)

	if (!response.ok) {
		throw new Error(`Failed to fetch automatic price sync status: ${response.status}`)
	}

	return response.json()
}

export async function pauseAutoPriceSync(): Promise<AutoPriceSyncStatus> {
	const response = await fetch(`${API_BASE_URL}/api/sync/auto-price/pause`, {
		method: "POST",
	})

	if (!response.ok) {
		throw new Error(`Failed to pause automatic price sync: ${response.status}`)
	}

	return response.json()
}

export async function resumeAutoPriceSync(): Promise<AutoPriceSyncStatus> {
	const response = await fetch(`${API_BASE_URL}/api/sync/auto-price/resume`, {
		method: "POST",
	})

	if (!response.ok) {
		throw new Error(`Failed to resume automatic price sync: ${response.status}`)
	}

	return response.json()
}

export async function fetchPriceHistoryConfig(): Promise<PriceHistoryConfig> {
	const response = await fetch(`${API_BASE_URL}/api/sync/price-history/config`)

	if (!response.ok) {
		throw new Error(`Failed to fetch price history config: ${response.status}`)
	}

	return response.json()
}

export async function updatePriceHistoryConfig(
	config: Partial<PriceHistoryConfig>,
): Promise<PriceHistoryConfig> {
	const response = await fetch(`${API_BASE_URL}/api/sync/price-history/config`, {
		method: "PATCH",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(config),
	})

	if (!response.ok) {
		throw new Error(`Failed to update price history config: ${response.status}`)
	}

	return response.json()
}

export async function fetchPriceHistoryEstimate(): Promise<PriceHistoryEstimate> {
	const response = await fetch(`${API_BASE_URL}/api/sync/price-history/estimate`)

	if (!response.ok) {
		throw new Error(`Failed to fetch price history estimate: ${response.status}`)
	}

	return response.json()
}

export async function fetchPriceHistoryRelevance(options: {
	search?: string
	filter?: PriceHistoryRelevanceFilter
	limit?: number
	offset?: number
} = {}): Promise<PriceHistoryRelevanceResponse> {
	const params = new URLSearchParams()

	if (options.search) params.set("search", options.search)
	if (options.filter) params.set("filter", options.filter)
	if (options.limit !== undefined) params.set("limit", String(options.limit))
	if (options.offset !== undefined) params.set("offset", String(options.offset))

	const response = await fetch(`${API_BASE_URL}/api/sync/price-history/relevance?${params.toString()}`)

	if (!response.ok) {
		throw new Error(`Failed to fetch price history relevance: ${response.status}`)
	}

	return response.json()
}

export async function ignorePriceHistoryItem(itemId: number): Promise<{ status: string; item_id: number; ignored: boolean }> {
	const response = await fetch(`${API_BASE_URL}/api/sync/price-history/ignore/${itemId}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({}),
	})

	if (!response.ok) {
		throw new Error(`Failed to ignore item for price history: ${response.status}`)
	}

	return response.json()
}

export async function restorePriceHistoryItem(itemId: number): Promise<{ status: string; item_id: number; ignored: boolean }> {
	const response = await fetch(`${API_BASE_URL}/api/sync/price-history/ignore/${itemId}`, {
		method: "DELETE",
	})

	if (!response.ok) {
		throw new Error(`Failed to restore item for price history: ${response.status}`)
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
