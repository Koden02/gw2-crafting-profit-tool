export type IngredientBreakdown = {
	item_id: number
	name: string
	count: number
	owned_count: number
	missing_count: number
	buy_price: number | null
	craft_price: number | null
	chosen_source: string
	purchase_price: number | null
	chosen_unit_cost: number | null
	total_cost: number | null
}

export type EligibleCharacter = { name: string; discipline: string; rating: number; unlock_source: string }

export type ProfitableCraft = {
    eligibility: string
    quote_basis: "account" | "market"
    reservation_revision: number | null
    eligible_characters: EligibleCharacter[]
	recipe_id: number
	account_id: string | null
	snapshot_id: string | null
	material_pricing: MaterialPricingMode
	output_pricing: OutputPricingMode
	quote_issues: string[]
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
	has_price_history: boolean
	market_flow_status: "unknown" | "stalled" | "slow" | "moving"
	market_flow_score: number | null
	market_flow_observations: number
	market_flow_window_hours: number
	market_flow_quantity_change_count: number
	market_flow_price_change_count: number
	market_flow_summary: string
	ingredient_sale_value: number | null
	crafted_item_value: number
	value_add: number | null
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
	running_source: string | null
	running_started_at: string | null
	auto_worker_running: boolean
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

export type PriceHistoryResolution = "auto" | "raw" | "hour" | "day"

export type PriceHistoryPoint = {
	observed_at: string
	buy_price: number | null
	buy_price_min: number | null
	buy_price_max: number | null
	buy_quantity: number | null
	sell_price: number | null
	sell_price_min: number | null
	sell_price_max: number | null
	sell_quantity: number | null
	sample_count: number
}

export type PriceHistoryResponse = {
	item_id: number
	name: string
	resolution: Exclude<PriceHistoryResolution, "auto">
	range_days: number
	start_at: string
	end_at: string
	point_count: number
	points: PriceHistoryPoint[]
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
	account_id: string
	snapshot_id: string
	status: string
	material_items: number
	bank_items: number
	shared_items: number
	character_items: number
	unique_items: number
	total_owned: number
	last_updated: string
}

export type AccountHoldingsStatus = {
	account_id: string
	snapshot_id: string | null
	holding_count: number
	total_owned: number
	last_updated: string | null
}

export type ProfitableCraftQuery = {
	eligible_only?: boolean
	account_id?: string
	limit?: number
	min_profit?: number
	min_buy_quantity?: number
	min_sell_quantity?: number
	exclude_low_liquidity?: boolean
	exclude_suspicious_spread?: boolean
	exclude_stalled_markets?: boolean
	discipline?: string
	material_pricing?: MaterialPricingMode
	output_pricing?: OutputPricingMode
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000"

export async function fetchProfitableCrafts(
	query: ProfitableCraftQuery = {},
): Promise<ProfitableCraft[]> {
	const params = new URLSearchParams()

	if (query.account_id) params.set("account_id", query.account_id)
	if (query.eligible_only !== undefined) params.set("eligible_only", String(query.eligible_only))
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
	if (query.exclude_stalled_markets !== undefined) {
		params.set("exclude_stalled_markets", String(query.exclude_stalled_markets))
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
		eligible_only?: boolean
		recipe_id?: number
		account_id?: string
		material_pricing?: MaterialPricingMode
		output_pricing?: OutputPricingMode
	},
): Promise<ProfitableCraft> {
	const params = new URLSearchParams()
	if (options?.eligible_only !== undefined) params.set("eligible_only", String(options.eligible_only))
	if (options?.recipe_id !== undefined) params.set("recipe_id", String(options.recipe_id))
	if (options?.account_id) params.set("account_id", options.account_id)

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

export async function fetchProfitScenarios(itemId: number, accountId?: string, recipeId?: number, eligibleOnly = false): Promise<ProfitScenario[]> {
	const params = new URLSearchParams()
	if (accountId) params.set("account_id", accountId)
	params.set("eligible_only", String(eligibleOnly))
	if (recipeId !== undefined) params.set("recipe_id", String(recipeId))
	const response = await fetch(`${API_BASE_URL}/api/profit/${itemId}/scenarios?${params}`)

	if (!response.ok) {
		throw new Error(`Failed to fetch profit scenarios: ${response.status}`)
	}

	return response.json()
}

export async function fetchListingDepth(
	itemId: number,
	options?: {
		account_id?: string
		eligible_only?: boolean
		recipe_id?: number
		material_pricing?: MaterialPricingMode
		output_pricing?: OutputPricingMode
	},
): Promise<ListingDepthAnalysis> {
	const params = new URLSearchParams()
	if (options?.output_pricing) params.set("output_pricing", options.output_pricing)
	if (options?.account_id) params.set("account_id", options.account_id)
	if (options?.eligible_only !== undefined) params.set("eligible_only", String(options.eligible_only))
	if (options?.recipe_id !== undefined) params.set("recipe_id", String(options.recipe_id))

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

export async function fetchPriceHistory(
	itemId: number,
	options: {
		range_days?: number
		resolution?: PriceHistoryResolution
	} = {},
): Promise<PriceHistoryResponse> {
	const params = new URLSearchParams()

	if (options.range_days !== undefined) {
		params.set("range_days", String(options.range_days))
	}

	if (options.resolution !== undefined) {
		params.set("resolution", options.resolution)
	}

	const suffix = params.toString() ? `?${params.toString()}` : ""
	const response = await fetch(`${API_BASE_URL}/api/price-history/${itemId}${suffix}`)

	if (!response.ok) {
		const detail = await response.json().catch(() => null)
		const message = typeof detail?.detail === "string" ? detail.detail : `Failed to fetch price history: ${response.status}`
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
		const detail = await response.json().catch(() => null)
		const message = typeof detail?.detail === "string" ? detail.detail : `Failed to sync Trading Post prices: ${response.status}`
		throw new Error(message)
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

export async function syncAccountHoldings(apiKey: string, accountId?: string): Promise<AccountHoldingsSyncResult> {
	const response = await fetch(`${API_BASE_URL}/api/account/sync/holdings`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ api_key: apiKey, account_id: accountId, include_crafting: true }),
	})

	if (!response.ok) {
		const detail = await response.json().catch(() => null)
		const message = typeof detail?.detail === "string" ? detail.detail : `Failed to sync account holdings: ${response.status}`
		throw new Error(message)
	}

	return response.json()
}

export async function fetchAccountHoldingsStatus(accountId: string): Promise<AccountHoldingsStatus> {
	const response = await fetch(`${API_BASE_URL}/api/account/holdings/status?account_id=${encodeURIComponent(accountId)}`)

	if (!response.ok) {
		throw new Error(`Failed to fetch account holdings status: ${response.status}`)
	}

	return response.json()
}


export type AccountProfile = {
    id: string
    display_name: string
    verified: boolean
    last_updated: string | null
    snapshot_id: string | null
}

export type CraftPlan = {
    eligibility: string
    reservation_revision: number | null
    reserved: { item_id: number; name: string; quantity: number }[]
    item_id: number
    name: string
    account_id: string | null
    snapshot_id: string | null
    status: "quoted" | "incomplete" | "unavailable"
    recipe_id: number | null
    requested_quantity: number
    planned_quantity: number
    purchase_cost: number | null
    net_revenue: number | null
    economic_gain: number | null
    cash_surplus: number | null
    additional_gold_needed: number | null
    owned_sale_value: number | null
    within_budget?: boolean | null
    observed_at: string
    issues: string[]
    fee_model: string
    allocation_policy: string
    purchases: { item_id: number; name: string; quantity: number; cost: number }[]
    consumed: { item_id: number; name: string; quantity: number; locations?: { source: string; position: string; quantity: number }[] }[]
    steps: { recipe_id: number; item_id: number; name: string; runs: number; produced: number; eligibility: string; recipe_state: string; crafter: string | null; eligible_characters: EligibleCharacter[] }[]
    leftovers: { item_id: number; name: string; quantity: number }[]
}

export async function fetchAccountProfiles(): Promise<AccountProfile[]> {
    const response = await fetch(`${API_BASE_URL}/api/account/profiles`)
    if (!response.ok) throw new Error("Could not load accounts.")
    return response.json()
}

export async function fetchCraftPlan(itemId: number, options: {
    quantity: number; account_id?: string; material_pricing: MaterialPricingMode
    output_pricing: OutputPricingMode; liquidation_pricing?: OutputPricingMode
    budget?: number; check_depth: boolean; recipe_id?: number; eligible_only?: boolean
}, signal?: AbortSignal): Promise<CraftPlan> {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(options)) {
        if (value !== undefined) params.set(key, String(value))
    }
    const response = await fetch(`${API_BASE_URL}/api/profit/${itemId}/plan?${params}`, { signal })
    if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(typeof body?.detail === "string" ? body.detail : "Could not calculate the plan.")
    }
    return response.json()
}


export type SourceStatus = { status: string; fresh: boolean; fetched_at: string | null; error?: string; count: number }
export type CraftingStatus = {
    account_id: string; snapshot_id: string | null
    inventory_coverage: InventoryCoverage
    characters_source: SourceStatus; account_recipes_source: SourceStatus
    characters: { name: string; crafting: SourceStatus; recipes: SourceStatus; disciplines: { discipline: string; rating: number; active: boolean }[] }[]
}

export type InventoryCoverage = { complete: boolean; missing_or_stale: string[]; sources: { source: string; fresh: boolean; fetched_at: string | null; status: string }[] }
export type BatchSearch = {
    account_id: string; snapshot_id: string; reservation_revision: number
    budget: number; minimum_gain: number; max_output: number; observed_at: string
    inventory_coverage: InventoryCoverage
    suggestions: { plan: CraftPlan; quantity_limit_reason: string }[]
    issues: string[]; candidate_count: number; candidates_checked: number; quantities_checked: number
    search_limited: boolean; shortlist_truncated: boolean; scope: string
    market_observed_from?: string | null; market_observed_to?: string | null
}

export async function fetchBatchRecommendations(options: { account_id: string; budget: number; minimum_gain: number; max_output: number }, signal: AbortSignal): Promise<BatchSearch> {
    const response = await fetch(`${API_BASE_URL}/api/craft-recommendations`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options), signal,
    })
    if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(typeof body?.detail === "string" ? body.detail : "Could not find batches. Refresh account data and prices, then retry.")
    }
    return response.json()
}
export type ReservedMaterial = { item_id: number; name: string; owned: number; usable: number; reserved: number; available: number; purpose: string }
export type AccountMaterials = { account_id: string; snapshot_id: string | null; reservation_revision: number; total: number; rows: ReservedMaterial[] }

async function accountRead<T>(path: string, accountId: string, search: string, signal?: AbortSignal): Promise<T> {
    const params = new URLSearchParams({ account_id: accountId, search })
    const response = await fetch(`${API_BASE_URL}/api/account/${path}?${params}`, { signal })
    if (!response.ok) throw new Error("Could not load account data. Refresh to retry.")
    return response.json()
}
export function fetchCraftingStatus(accountId: string, signal?: AbortSignal) {
    return accountRead<CraftingStatus>("crafting", accountId, "", signal)
}
export function fetchAccountMaterials(accountId: string, search: string, signal?: AbortSignal) {
    return accountRead<AccountMaterials>("materials", accountId, search, signal)
}
export async function saveMaterialReservation(accountId: string, itemId: number, quantity: number, purpose: string, revision: number) {
    const response = await fetch(`${API_BASE_URL}/api/account/reservations/${itemId}?account_id=${encodeURIComponent(accountId)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity, purpose, expected_revision: revision }),
    })
    if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(typeof body?.detail === "string" ? body.detail : "Could not save the reservation.")
    }
    return response.json()
}
