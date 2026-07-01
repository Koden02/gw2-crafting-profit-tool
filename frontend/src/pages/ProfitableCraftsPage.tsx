import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
	Alert,
	Box,
	Button,
	Checkbox,
	Chip,
	CircularProgress,
	Divider,
	Drawer,
	FormControlLabel,
	MenuItem,
	Paper,
	Stack,
	Table,
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableRow,
	TableSortLabel,
	TextField,
	Typography,
} from "@mui/material"

import {
	fetchAccountHoldingsStatus,
	fetchAutoPriceSyncStatus,
	fetchListingDepth,
	fetchPriceHistoryConfig,
	fetchPriceHistoryEstimate,
	fetchPriceHistoryRelevance,
	fetchProfitDetail,
	fetchProfitScenarios,
	fetchProfitableCrafts,
	fetchSyncStatus,
	ignorePriceHistoryItem,
	pauseAutoPriceSync,
	restorePriceHistoryItem,
	resumeAutoPriceSync,
	syncAccountHoldings,
	syncCommercePrices,
	syncItems,
	syncRecipes,
	updatePriceHistoryConfig,
	type AccountHoldingsStatus,
	type AutoPriceSyncStatus,
	type ListingDepthAnalysis,
	type MaterialPricingMode,
	type OutputPricingMode,
	type PriceHistoryConfig,
	type PriceHistoryEstimate,
	type PriceHistoryRelevanceFilter,
	type PriceHistoryRelevanceItem,
	type ProfitScenario,
	type ProfitableCraft,
	type SnapshotItemMode,
	type SyncStatus,
} from "../api/profitableCrafts"
import { formatCoins, formatDateTime, formatNumber, formatPercent } from "../utils/formatting"

const disciplineOptions = [
	"",
	"Artificer",
	"Armorsmith",
	"Chef",
	"Huntsman",
	"Jeweler",
	"Leatherworker",
	"Scribe",
	"Tailor",
	"Weaponsmith",
]

const accentColor = "#a56f2c"
const warmPanel = "#fffdf8"
const tableHeaderBackground = "#f1e2cb"
const tableStripeBackground = "rgba(165, 111, 44, 0.055)"
const tableHoverBackground = "rgba(165, 111, 44, 0.14)"
const priceDataStaleAfterMs = 60 * 60 * 1000
const accountApiKeyStorageKey = "gw2-profit-api-key"
const watchlistStorageKey = "gw2-profit-watchlist"
const filterPresetsStorageKey = "gw2-profit-filter-presets"
const tableDepthLoadLimit = 25

type SavedFilterSettings = {
	limit: number
	minProfit: number
	minBuyQuantity: number
	minSellQuantity: number
	excludeLowLiquidity: boolean
	excludeSuspiciousSpread: boolean
	discipline: string
	itemNameSearch: string
	materialPricing: MaterialPricingMode
	outputPricing: OutputPricingMode
	watchlistOnly: boolean
}

type SavedFilterPreset = {
	id: string
	name: string
	settings: SavedFilterSettings
}

const tableHeaderCellSx = {
	bgcolor: tableHeaderBackground,
	color: "#352515",
	fontWeight: 800,
	borderBottom: "1px solid rgba(98, 63, 24, 0.24)",
	whiteSpace: "nowrap",
}

const stickyNameHeaderSx = {
	...tableHeaderCellSx,
	left: 0,
	minWidth: 220,
	position: "sticky",
	top: 0,
	zIndex: 5,
}

const stickyNameCellSx = {
	bgcolor: "inherit",
	fontWeight: 650,
	left: 0,
	maxWidth: 280,
	minWidth: 220,
	position: "sticky",
	zIndex: 2,
}

const zebraRowSx = {
	"&:nth-of-type(odd)": {
		bgcolor: tableStripeBackground,
	},
	"&.MuiTableRow-hover:hover": {
		bgcolor: `${tableHoverBackground} !important`,
	},
}

const compactMetricSx = {
	border: "1px solid rgba(98, 63, 24, 0.14)",
	borderRadius: 2,
	bgcolor: "rgba(255, 255, 255, 0.72)",
	p: 1.25,
}

function listingDepthCacheKey(itemId: number, materialPricing: MaterialPricingMode): string {
	return `${itemId}:${materialPricing}`
}

function formatAge(valueMs: number): string {
	const totalMinutes = Math.max(0, Math.floor(valueMs / 60000))

	if (totalMinutes < 1) {
		return "less than a minute"
	}

	if (totalMinutes < 60) {
		return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`
	}

	const hours = Math.floor(totalMinutes / 60)
	const minutes = totalMinutes % 60

	if (minutes === 0) {
		return `${hours} hour${hours === 1 ? "" : "s"}`
	}

	return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`
}

function loadSavedAccountApiKey(): string {
	if (typeof window === "undefined") {
		return ""
	}

	return window.localStorage.getItem(accountApiKeyStorageKey) ?? ""
}

function saveAccountApiKey(apiKey: string): void {
	if (typeof window === "undefined") {
		return
	}

	const trimmedKey = apiKey.trim()

	if (trimmedKey) {
		window.localStorage.setItem(accountApiKeyStorageKey, trimmedKey)
		return
	}

	window.localStorage.removeItem(accountApiKeyStorageKey)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}

function loadSavedWatchlistIds(): number[] {
	if (typeof window === "undefined") {
		return []
	}

	try {
		const parsed: unknown = JSON.parse(window.localStorage.getItem(watchlistStorageKey) ?? "[]")

		if (!Array.isArray(parsed)) {
			return []
		}

		return parsed.filter((value): value is number => Number.isInteger(value))
	} catch {
		return []
	}
}

function saveWatchlistIds(itemIds: number[]): void {
	if (typeof window === "undefined") {
		return
	}

	window.localStorage.setItem(watchlistStorageKey, JSON.stringify(itemIds))
}

function isMaterialPricingMode(value: unknown): value is MaterialPricingMode {
	return value === "buy" || value === "sell"
}

function isOutputPricingMode(value: unknown): value is OutputPricingMode {
	return value === "buy" || value === "sell"
}

function normalizeFilterSettings(value: unknown): SavedFilterSettings | null {
	if (!isRecord(value)) {
		return null
	}

	const materialPricing = isMaterialPricingMode(value.materialPricing) ? value.materialPricing : "buy"
	const outputPricing = isOutputPricingMode(value.outputPricing) ? value.outputPricing : "sell"

	return {
		limit: typeof value.limit === "number" ? value.limit : 50,
		minProfit: typeof value.minProfit === "number" ? value.minProfit : 0,
		minBuyQuantity: typeof value.minBuyQuantity === "number" ? value.minBuyQuantity : 5,
		minSellQuantity: typeof value.minSellQuantity === "number" ? value.minSellQuantity : 5,
		excludeLowLiquidity: typeof value.excludeLowLiquidity === "boolean" ? value.excludeLowLiquidity : true,
		excludeSuspiciousSpread:
			typeof value.excludeSuspiciousSpread === "boolean" ? value.excludeSuspiciousSpread : true,
		discipline: typeof value.discipline === "string" ? value.discipline : "",
		itemNameSearch: typeof value.itemNameSearch === "string" ? value.itemNameSearch : "",
		materialPricing,
		outputPricing,
		watchlistOnly: typeof value.watchlistOnly === "boolean" ? value.watchlistOnly : false,
	}
}

function loadSavedFilterPresets(): SavedFilterPreset[] {
	if (typeof window === "undefined") {
		return []
	}

	try {
		const parsed: unknown = JSON.parse(window.localStorage.getItem(filterPresetsStorageKey) ?? "[]")

		if (!Array.isArray(parsed)) {
			return []
		}

		return parsed.flatMap((value) => {
			if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
				return []
			}

			const settings = normalizeFilterSettings(value.settings)

			if (settings === null) {
				return []
			}

			return [{ id: value.id, name: value.name, settings }]
		})
	} catch {
		return []
	}
}

function saveFilterPresets(presets: SavedFilterPreset[]): void {
	if (typeof window === "undefined") {
		return
	}

	window.localStorage.setItem(filterPresetsStorageKey, JSON.stringify(presets))
}

function buildShoppingListCopyText(itemName: string, plan: Omit<ShoppingPlan, "copyText">): string {
	const missingRows = plan.rows.filter((row) => row.missingCount > 0)
	const lines = [
		`${itemName} batch plan`,
		`Requested output: ${formatNumber(plan.requestedOutputCount)}`,
		`Recipe runs: ${formatNumber(plan.recipeRuns)}`,
		`Planned output: ${formatNumber(plan.plannedOutputCount)}`,
		`Market profit: ${formatCoins(plan.marketProfit)}`,
		`Out-of-pocket cost: ${formatCoins(plan.outOfPocketCost)}`,
		`Out-of-pocket profit: ${formatCoins(plan.outOfPocketProfit)}`,
		`Owned coverage: ${formatPercent(plan.ownedCoverageRatio)}`,
	]

	if (plan.plannedExceedsInstantSellDepth && plan.instantSellDepthLimit !== null) {
		lines.push(
			`Depth warning: planned output exceeds profitable instant-sell depth of ${formatNumber(plan.instantSellDepthLimit)}.`,
		)
	}

	lines.push("", "Missing direct ingredients:")

	if (missingRows.length === 0) {
		lines.push("None")
		return lines.join("\n")
	}

	for (const row of missingRows) {
		const cost = row.missingBuyCost === null ? "price unavailable" : formatCoins(row.missingBuyCost)
		lines.push(
			`${formatNumber(row.missingCount)} ${row.name} ` +
				`(required ${formatNumber(row.requiredCount)}, owned ${formatNumber(row.ownedCount)}, ${cost})`,
		)
	}

	return lines.join("\n")
}

type SortKey =
	| "name"
	| "craft_cost"
	| "sell_price"
	| "net_sale"
	| "ingredient_sale_value"
	| "crafted_item_value"
	| "value_add"
	| "recommendation"
	| "profit"
	| "roi"
	| "buy_quantity"
	| "sell_quantity"

type SortDirection = "asc" | "desc"
type SyncDataset = "prices" | "items" | "recipes"

type ShoppingListRow = {
	itemId: number
	name: string
	requiredCount: number
	ownedCount: number
	ownedAppliedCount: number
	missingCount: number
	unitBuyPrice: number | null
	missingBuyCost: number | null
}

type ShoppingPlan = {
	requestedOutputCount: number
	recipeRuns: number
	plannedOutputCount: number
	totalCraftCost: number
	totalNetSale: number
	marketProfit: number
	outOfPocketCost: number
	outOfPocketProfit: number
	requiredIngredientCount: number
	ownedAppliedCount: number
	ownedCoverageRatio: number
	missingBuyCost: number
	hasUnavailablePrices: boolean
	instantSellDepthLimit: number | null
	plannedExceedsInstantSellDepth: boolean
	rows: ShoppingListRow[]
	copyText: string
}

export default function ProfitableCraftsPage() {
	const [rows, setRows] = useState<ProfitableCraft[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
	const [accountHoldingsStatus, setAccountHoldingsStatus] = useState<AccountHoldingsStatus | null>(null)
	const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)
	const [syncStatusCheckedAt, setSyncStatusCheckedAt] = useState<Date | null>(null)
	const [syncInProgress, setSyncInProgress] = useState<SyncDataset | null>(null)
	const [syncError, setSyncError] = useState<string | null>(null)
	const [syncMessage, setSyncMessage] = useState<string | null>(null)
	const [autoPriceSyncStatus, setAutoPriceSyncStatus] = useState<AutoPriceSyncStatus | null>(null)
	const [priceHistoryConfig, setPriceHistoryConfig] = useState<PriceHistoryConfig | null>(null)
	const [priceHistoryEstimate, setPriceHistoryEstimate] = useState<PriceHistoryEstimate | null>(null)
	const [priceHistoryItems, setPriceHistoryItems] = useState<PriceHistoryRelevanceItem[]>([])
	const [priceHistoryTotal, setPriceHistoryTotal] = useState(0)
	const [priceHistorySearch, setPriceHistorySearch] = useState("")
	const [priceHistoryFilter, setPriceHistoryFilter] = useState<PriceHistoryRelevanceFilter>("relevant")
	const [priceHistoryLoading, setPriceHistoryLoading] = useState(false)
	const [priceHistorySaving, setPriceHistorySaving] = useState(false)
	const [priceHistoryError, setPriceHistoryError] = useState<string | null>(null)
	const [priceHistoryMessage, setPriceHistoryMessage] = useState<string | null>(null)
	const [accountApiKey, setAccountApiKey] = useState(loadSavedAccountApiKey)
	const [accountKeySaved, setAccountKeySaved] = useState(() => loadSavedAccountApiKey().trim().length > 0)
	const [accountSyncing, setAccountSyncing] = useState(false)
	const [accountSyncError, setAccountSyncError] = useState<string | null>(null)
	const [accountSyncMessage, setAccountSyncMessage] = useState<string | null>(null)
	const [watchlistIds, setWatchlistIds] = useState(loadSavedWatchlistIds)
	const [watchlistOnly, setWatchlistOnly] = useState(false)
	const [filterPresets, setFilterPresets] = useState(loadSavedFilterPresets)
	const [filterPresetName, setFilterPresetName] = useState("")
	const [selectedFilterPresetId, setSelectedFilterPresetId] = useState("")
	const [filterPresetMessage, setFilterPresetMessage] = useState<string | null>(null)

	const [selectedItem, setSelectedItem] = useState<ProfitableCraft | null>(null)
	const [scenarioRows, setScenarioRows] = useState<ProfitScenario[]>([])
	const [listingDepth, setListingDepth] = useState<ListingDepthAnalysis | null>(null)
	const [listingDepthError, setListingDepthError] = useState<string | null>(null)
	const [tableDepthByKey, setTableDepthByKey] = useState<Record<string, ListingDepthAnalysis>>({})
	const [tableDepthErrorsByKey, setTableDepthErrorsByKey] = useState<Record<string, string>>({})
	const [tableDepthLoading, setTableDepthLoading] = useState(false)
	const [tableDepthLoadedCount, setTableDepthLoadedCount] = useState(0)
	const [tableDepthMessage, setTableDepthMessage] = useState<string | null>(null)
	const [detailLoading, setDetailLoading] = useState(false)
	const [detailError, setDetailError] = useState<string | null>(null)
	const [batchOutputCount, setBatchOutputCount] = useState(1)
	const [shoppingListCopyMessage, setShoppingListCopyMessage] = useState<string | null>(null)

	const [limit, setLimit] = useState(50)
	const [minProfit, setMinProfit] = useState(0)
	const [minBuyQuantity, setMinBuyQuantity] = useState(5)
	const [minSellQuantity, setMinSellQuantity] = useState(5)
	const [excludeLowLiquidity, setExcludeLowLiquidity] = useState(true)
	const [excludeSuspiciousSpread, setExcludeSuspiciousSpread] = useState(true)
	const [discipline, setDiscipline] = useState("")
	const [itemNameSearch, setItemNameSearch] = useState("")

	const [sortKey, setSortKey] = useState<SortKey>("profit")
	const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

	const [materialPricing, setMaterialPricing] = useState<MaterialPricingMode>("buy")
	const [outputPricing, setOutputPricing] = useState<OutputPricingMode>("sell")
	const hasLoadedInitialData = useRef(false)

	const watchlistIdSet = useMemo(() => new Set(watchlistIds), [watchlistIds])

	function currentFilterSettings(): SavedFilterSettings {
		return {
			limit,
			minProfit,
			minBuyQuantity,
			minSellQuantity,
			excludeLowLiquidity,
			excludeSuspiciousSpread,
			discipline,
			itemNameSearch,
			materialPricing,
			outputPricing,
			watchlistOnly,
		}
	}

	const loadPriceHistoryStatus = useCallback(async () => {
		const [autoStatus, config, estimate] = await Promise.all([
			fetchAutoPriceSyncStatus(),
			fetchPriceHistoryConfig(),
			fetchPriceHistoryEstimate(),
		])

		setAutoPriceSyncStatus(autoStatus)
		setPriceHistoryConfig(config)
		setPriceHistoryEstimate(estimate)
	}, [])

	const loadPriceHistoryRelevance = useCallback(async () => {
		try {
			setPriceHistoryLoading(true)
			setPriceHistoryError(null)

			const relevance = await fetchPriceHistoryRelevance({
				search: priceHistorySearch,
				filter: priceHistoryFilter,
				limit: 50,
			})

			setPriceHistoryItems(relevance.items)
			setPriceHistoryTotal(relevance.total)
		} catch (err) {
			if (err instanceof Error) {
				setPriceHistoryError(err.message)
			} else {
				setPriceHistoryError("Unknown error occurred while loading price history controls.")
			}
		} finally {
			setPriceHistoryLoading(false)
		}
	}, [priceHistoryFilter, priceHistorySearch])

	const refreshPriceHistoryControls = useCallback(async () => {
		await Promise.all([
			loadPriceHistoryStatus().catch((err) => {
				if (err instanceof Error) {
					setPriceHistoryError(err.message)
				}
			}),
			loadPriceHistoryRelevance(),
		])
	}, [loadPriceHistoryRelevance, loadPriceHistoryStatus])

	const loadData = useCallback(async () => {
		try {
			setLoading(true)
			setError(null)

			const [data, status, holdingsStatus] = await Promise.all([
				fetchProfitableCrafts({
					limit,
					min_profit: minProfit,
					min_buy_quantity: minBuyQuantity,
					min_sell_quantity: minSellQuantity,
					exclude_low_liquidity: excludeLowLiquidity,
					exclude_suspicious_spread: excludeSuspiciousSpread,
					discipline: discipline || undefined,
					material_pricing: materialPricing,
					output_pricing: outputPricing,
				}),
				fetchSyncStatus().catch(() => null),
				fetchAccountHoldingsStatus().catch(() => null),
			])

			setRows(data)
			setSyncStatus(status)
			setAccountHoldingsStatus(holdingsStatus)
			setSyncStatusCheckedAt(status ? new Date() : null)
			setLastLoadedAt(new Date())
		} catch (err) {
			if (err instanceof Error) {
				setError(err.message)
			} else {
				setError("Unknown error occurred.")
			}
		} finally {
			setLoading(false)
		}
	}, [
		discipline,
		excludeLowLiquidity,
		excludeSuspiciousSpread,
		limit,
		materialPricing,
		minBuyQuantity,
		minProfit,
		minSellQuantity,
		outputPricing,
	])

	async function handleSelectItem(itemId: number) {
		try {
			setDetailLoading(true)
			setDetailError(null)
			setScenarioRows([])
			setListingDepth(null)
			setListingDepthError(null)

			const [detail, scenarios, depth] = await Promise.all([
				fetchProfitDetail(itemId, {
					material_pricing: materialPricing,
					output_pricing: outputPricing,
				}),
				fetchProfitScenarios(itemId),
				fetchListingDepth(itemId, {
					material_pricing: materialPricing,
				}).catch((err) => {
					if (err instanceof Error) {
						setListingDepthError(err.message)
					} else {
						setListingDepthError("Unknown error occurred while loading Trading Post listing depth.")
					}

					return null
				}),
			])
			setSelectedItem(detail)
			setScenarioRows(scenarios)
			setListingDepth(depth)
			setBatchOutputCount(Math.max(1, detail.output_item_count ?? 1))
			setShoppingListCopyMessage(null)
		} catch (err) {
			if (err instanceof Error) {
				setDetailError(err.message)
			} else {
				setDetailError("Unknown error occurred.")
			}
		} finally {
			setDetailLoading(false)
		}
	}

	function handleSort(nextKey: SortKey) {
		if (sortKey === nextKey) {
			setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
			return
		}

		setSortKey(nextKey)
		setSortDirection("desc")
	}

	async function handleDataSync(dataset: SyncDataset) {
		try {
			setSyncInProgress(dataset)
			setSyncError(null)
			setSyncMessage(null)

			if (dataset === "prices") {
				const result = await syncCommercePrices()
				const snapshotText =
					result.snapshots_recorded === undefined
						? ""
						: ` Recorded ${formatNumber(result.snapshots_recorded)} history snapshots.`
				setSyncMessage(`Synced ${formatNumber(result.prices_upserted)} Trading Post price rows.${snapshotText}`)
			}

			if (dataset === "items") {
				const result = await syncItems()
				setSyncMessage(`Synced ${formatNumber(result.items_upserted)} item rows.`)
			}

			if (dataset === "recipes") {
				const result = await syncRecipes()
				setSyncMessage(`Synced ${formatNumber(result.recipes_upserted)} recipe rows.`)
			}

			await loadData()
			await refreshPriceHistoryControls()
		} catch (err) {
			if (err instanceof Error) {
				setSyncError(err.message)
			} else {
				setSyncError("Unknown error occurred while syncing data.")
			}
		} finally {
			setSyncInProgress(null)
		}
	}

	async function handleToggleAutoPriceSync() {
		try {
			setPriceHistorySaving(true)
			setPriceHistoryError(null)
			setPriceHistoryMessage(null)

			const nextStatus = autoPriceSyncStatus?.enabled
				? await pauseAutoPriceSync()
				: await resumeAutoPriceSync()

			setAutoPriceSyncStatus(nextStatus)
			await loadPriceHistoryStatus()
			setPriceHistoryMessage(nextStatus.enabled ? "Automatic price sync resumed." : "Automatic price sync paused.")
		} catch (err) {
			if (err instanceof Error) {
				setPriceHistoryError(err.message)
			} else {
				setPriceHistoryError("Unknown error occurred while updating automatic price sync.")
			}
		} finally {
			setPriceHistorySaving(false)
		}
	}

	async function handleSavePriceHistoryConfig() {
		if (priceHistoryConfig === null) {
			return
		}

		try {
			setPriceHistorySaving(true)
			setPriceHistoryError(null)
			setPriceHistoryMessage(null)

			const savedConfig = await updatePriceHistoryConfig(priceHistoryConfig)
			setPriceHistoryConfig(savedConfig)
			await refreshPriceHistoryControls()
			setPriceHistoryMessage("Saved price history settings.")
		} catch (err) {
			if (err instanceof Error) {
				setPriceHistoryError(err.message)
			} else {
				setPriceHistoryError("Unknown error occurred while saving price history settings.")
			}
		} finally {
			setPriceHistorySaving(false)
		}
	}

	function handlePriceHistoryNumberSetting(
		key:
			| "price_sync_interval_minutes"
			| "raw_snapshot_retention_days"
			| "hourly_rollup_retention_days"
			| "daily_rollup_retention_days"
			| "max_history_mb",
		value: number,
	) {
		setPriceHistoryConfig((current) => current === null ? current : { ...current, [key]: value })
	}

	function handlePriceHistoryModeSetting(value: SnapshotItemMode) {
		setPriceHistoryConfig((current) => current === null ? current : { ...current, snapshot_item_mode: value })
	}

	async function handleTogglePriceHistoryIgnore(item: PriceHistoryRelevanceItem) {
		try {
			setPriceHistorySaving(true)
			setPriceHistoryError(null)
			setPriceHistoryMessage(null)

			if (item.is_ignored) {
				await restorePriceHistoryItem(item.item_id)
				setPriceHistoryMessage(`Restored ${item.name} to price history tracking.`)
			} else {
				await ignorePriceHistoryItem(item.item_id)
				setPriceHistoryMessage(`Ignored ${item.name} for future price history snapshots.`)
			}

			await refreshPriceHistoryControls()
		} catch (err) {
			if (err instanceof Error) {
				setPriceHistoryError(err.message)
			} else {
				setPriceHistoryError("Unknown error occurred while updating ignored items.")
			}
		} finally {
			setPriceHistorySaving(false)
		}
	}

	function handleSaveAccountApiKey() {
		saveAccountApiKey(accountApiKey)

		if (accountApiKey.trim()) {
			setAccountKeySaved(true)
			setAccountSyncMessage("Saved GW2 API key in this browser.")
			setAccountSyncError(null)
			return
		}

		setAccountKeySaved(false)
		setAccountSyncMessage("Cleared local GW2 API key.")
		setAccountSyncError(null)
	}

	async function handleAccountHoldingsSync() {
		const apiKey = accountApiKey.trim()

		if (!apiKey) {
			setAccountSyncError("Enter a GW2 API key before syncing account holdings.")
			setAccountSyncMessage(null)
			return
		}

		try {
			setAccountSyncing(true)
			setAccountSyncError(null)
			setAccountSyncMessage(null)

			const result = await syncAccountHoldings(apiKey)
			setAccountSyncMessage(
				`Synced ${formatNumber(result.unique_items)} account item holdings across material storage and bank.`,
			)
			const selectedItemId = selectedItem?.item_id
			await loadData()

			if (selectedItemId !== undefined) {
				await handleSelectItem(selectedItemId)
			}
		} catch (err) {
			if (err instanceof Error) {
				setAccountSyncError(err.message)
			} else {
				setAccountSyncError("Unknown error occurred while syncing account holdings.")
			}
		} finally {
			setAccountSyncing(false)
		}
	}

	function handleToggleWatchlistItem(itemId: number) {
		setWatchlistIds((current) => {
			const next = current.includes(itemId)
				? current.filter((currentItemId) => currentItemId !== itemId)
				: [...current, itemId]

			saveWatchlistIds(next)
			return next
		})
	}

	function applyFilterSettings(settings: SavedFilterSettings) {
		setLimit(settings.limit)
		setMinProfit(settings.minProfit)
		setMinBuyQuantity(settings.minBuyQuantity)
		setMinSellQuantity(settings.minSellQuantity)
		setExcludeLowLiquidity(settings.excludeLowLiquidity)
		setExcludeSuspiciousSpread(settings.excludeSuspiciousSpread)
		setDiscipline(settings.discipline)
		setItemNameSearch(settings.itemNameSearch)
		setMaterialPricing(settings.materialPricing)
		setOutputPricing(settings.outputPricing)
		setWatchlistOnly(settings.watchlistOnly)
	}

	function handleSaveFilterPreset() {
		const trimmedName = filterPresetName.trim()

		if (!trimmedName) {
			setFilterPresetMessage("Enter a preset name before saving.")
			return
		}

		const existingPreset = filterPresets.find(
			(preset) => preset.name.toLowerCase() === trimmedName.toLowerCase(),
		)
		const nextPreset: SavedFilterPreset = {
			id: existingPreset?.id ?? String(Date.now()),
			name: trimmedName,
			settings: currentFilterSettings(),
		}
		const nextPresets = existingPreset
			? filterPresets.map((preset) => (preset.id === existingPreset.id ? nextPreset : preset))
			: [...filterPresets, nextPreset]

		setFilterPresets(nextPresets)
		saveFilterPresets(nextPresets)
		setSelectedFilterPresetId(nextPreset.id)
		setFilterPresetMessage(`Saved filter preset "${trimmedName}".`)
	}

	function handleApplyFilterPreset() {
		const preset = filterPresets.find((current) => current.id === selectedFilterPresetId)

		if (preset === undefined) {
			setFilterPresetMessage("Choose a saved preset to apply.")
			return
		}

		applyFilterSettings(preset.settings)
		setFilterPresetName(preset.name)
		setFilterPresetMessage(`Applied filter preset "${preset.name}".`)
	}

	function handleDeleteFilterPreset() {
		const preset = filterPresets.find((current) => current.id === selectedFilterPresetId)

		if (preset === undefined) {
			setFilterPresetMessage("Choose a saved preset to delete.")
			return
		}

		const nextPresets = filterPresets.filter((current) => current.id !== preset.id)
		setFilterPresets(nextPresets)
		saveFilterPresets(nextPresets)
		setSelectedFilterPresetId("")
		setFilterPresetName("")
		setFilterPresetMessage(`Deleted filter preset "${preset.name}".`)
	}

	async function handleCopyShoppingList() {
		if (shoppingPlan === null) {
			return
		}

		try {
			await navigator.clipboard.writeText(shoppingPlan.copyText)
			setShoppingListCopyMessage("Shopping list copied.")
		} catch {
			setShoppingListCopyMessage("Could not copy shopping list from this browser.")
		}
	}

	function valueAddColor(value: number): string {
		return signedValueColor(value)
	}

	function recommendationChipColor(recommendation: string): "success" | "error" | "default" {
		if (recommendation === "Craft") {
			return "success"
		}

		if (recommendation === "Sell Ingredients") {
			return "error"
		}

		return "default"
	}

	function marketPressureChipColor(pressure: string): "success" | "warning" | "error" | "default" {
		if (pressure === "healthy market") {
			return "success"
		}

		if (pressure === "thin market") {
			return "warning"
		}

		if (pressure === "dead market") {
			return "error"
		}

		return "default"
	}

	function tableDepthForRow(row: ProfitableCraft): ListingDepthAnalysis | undefined {
		return tableDepthByKey[listingDepthCacheKey(row.item_id, materialPricing)]
	}

	function tableDepthErrorForRow(row: ProfitableCraft): string | undefined {
		return tableDepthErrorsByKey[listingDepthCacheKey(row.item_id, materialPricing)]
	}

	function RiskChips({
		depth,
		row,
	}: {
		depth: ListingDepthAnalysis | undefined
		row: ProfitableCraft
	}) {
		const chips: Array<{
			color: "success" | "warning" | "error" | "default"
			label: string
		}> = []

		if (row.low_liquidity) {
			chips.push({ color: "warning", label: "Low Liquidity" })
		}

		if (row.suspicious_spread) {
			chips.push({ color: "error", label: "Wide Spread" })
		}

		if (depth !== undefined) {
			chips.push({
				color: marketPressureChipColor(depth.estimated_market_pressure),
				label: depth.estimated_market_pressure,
			})

			if (depth.instant_sell_limit_quantity === 0) {
				chips.push({ color: "error", label: "No Instant Depth" })
			}
		}

		if (chips.length === 0) {
			chips.push({ color: "success", label: "Clear" })
		}

		return (
			<Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
				{chips.map((chip) => (
					<Chip
						key={chip.label}
						color={chip.color}
						label={chip.label}
						size="small"
						variant={chip.label === "Clear" ? "outlined" : "filled"}
						sx={{ fontWeight: 700 }}
					/>
				))}
			</Stack>
		)
	}

	function signedValueColor(value: number): string {
		if (value > 0) {
			return "success.main"
		}

		if (value < 0) {
			return "error.main"
		}

		return "text.primary"
	}

	function roiColor(value: number | null): string {
		if (value === null) {
			return "text.secondary"
		}

		if (value < 0) {
			return "error.main"
		}

		if (value >= 0.25) {
			return "success.main"
		}

		return "text.secondary"
	}

	function roiFontWeight(value: number | null): number {
		if (value !== null && value >= 0.25) {
			return 800
		}

		if (value !== null && value < 0) {
			return 700
		}

		return 500
	}

	function recommendationBannerBackground(recommendation: string): string {
		if (recommendation === "Craft") {
			return "linear-gradient(135deg, rgba(46, 125, 50, 0.13), rgba(255, 253, 248, 0.96))"
		}

		if (recommendation === "Sell Ingredients") {
			return "linear-gradient(135deg, rgba(211, 47, 47, 0.13), rgba(255, 253, 248, 0.96))"
		}

		return "linear-gradient(135deg, rgba(165, 111, 44, 0.13), rgba(255, 253, 248, 0.96))"
	}

	function RecommendationChip({ recommendation }: { recommendation: string }) {
		return (
			<Chip
				label={recommendation}
				color={recommendationChipColor(recommendation)}
				size="small"
				variant={recommendation === "Break Even" ? "outlined" : "filled"}
				sx={{ fontWeight: 800 }}
			/>
		)
	}

	function materialPricingLabel(mode: MaterialPricingMode): string {
		return mode === "buy" ? "Buy Order" : "Instant Buy"
	}

	function outputPricingLabel(mode: OutputPricingMode): string {
		return mode === "sell" ? "List Sell" : "Instant Sell"
	}

	function syncLoadingLabel(dataset: SyncDataset): string {
		if (dataset === "prices") {
			return "Syncing Prices"
		}

		if (dataset === "items") {
			return "Syncing Items"
		}

		return "Syncing Recipes"
	}

	function formatStorageMegabytes(value: number | null | undefined): string {
		if (value === null || value === undefined) {
			return "-"
		}

		if (value >= 1024) {
			return `${(value / 1024).toFixed(2)} GB`
		}

		return `${value.toFixed(1)} MB`
	}

	function SyncButton({ dataset, label }: { dataset: SyncDataset; label: string }) {
		const isActive = syncInProgress === dataset

		return (
			<Button
				variant={dataset === "prices" ? "contained" : "outlined"}
				disabled={loading || accountSyncing || syncInProgress !== null}
				onClick={() => void handleDataSync(dataset)}
				sx={{
					bgcolor: dataset === "prices" ? accentColor : "transparent",
					borderColor: accentColor,
					color: dataset === "prices" ? "#fff" : accentColor,
					minHeight: 40,
					minWidth: 150,
					"&:hover": {
						bgcolor: dataset === "prices" ? "#8d5e25" : "rgba(165, 111, 44, 0.08)",
						borderColor: "#8d5e25",
					},
				}}
			>
				{isActive ? (
					<Stack direction="row" spacing={1} alignItems="center">
						<CircularProgress color="inherit" size={16} />
						<span>{syncLoadingLabel(dataset)}</span>
					</Stack>
				) : (
					label
				)}
			</Button>
		)
	}

	function SortableHeader({
		align = "left",
		label,
		sortKey: nextSortKey,
		sx,
	}: {
		align?: "left" | "right"
		label: string
		sortKey: SortKey
		sx?: object
	}) {
		return (
			<TableCell align={align} sx={{ ...tableHeaderCellSx, ...sx }}>
				<TableSortLabel
					active={sortKey === nextSortKey}
					direction={sortKey === nextSortKey ? sortDirection : "asc"}
					onClick={() => handleSort(nextSortKey)}
					sx={{
						color: "inherit !important",
						fontWeight: "inherit",
						"& .MuiTableSortLabel-icon": {
							color: "inherit !important",
						},
					}}
				>
					{label}
				</TableSortLabel>
			</TableCell>
		)
	}

	const filteredRows = useMemo(() => {
		const normalizedSearch = itemNameSearch.trim().toLowerCase()
		let nextRows = rows

		if (watchlistOnly) {
			nextRows = nextRows.filter((row) => watchlistIdSet.has(row.item_id))
		}

		if (normalizedSearch) {
			nextRows = nextRows.filter((row) => row.name.toLowerCase().includes(normalizedSearch))
		}

		return nextRows
	}, [itemNameSearch, rows, watchlistIdSet, watchlistOnly])

	const sortedRows = useMemo(() => {
		const copied = [...filteredRows]

		copied.sort((a, b) => {
			let comparison = 0

			switch (sortKey) {
				case "name":
					comparison = a.name.localeCompare(b.name)
					break
				case "craft_cost":
					comparison = a.craft_cost - b.craft_cost
					break
				case "sell_price":
					comparison = a.sell_price - b.sell_price
					break
				case "net_sale":
					comparison = a.net_sale - b.net_sale
					break
				case "ingredient_sale_value":
					comparison = a.ingredient_sale_value - b.ingredient_sale_value
					break
				case "crafted_item_value":
					comparison = a.crafted_item_value - b.crafted_item_value
					break
				case "value_add":
					comparison = a.value_add - b.value_add
					break
				case "recommendation":
					comparison = a.recommendation.localeCompare(b.recommendation)
					break
				case "profit":
					comparison = a.profit - b.profit
					break
				case "roi":
					comparison = (a.roi ?? -Infinity) - (b.roi ?? -Infinity)
					break
				case "buy_quantity":
					comparison = a.buy_quantity - b.buy_quantity
					break
				case "sell_quantity":
					comparison = a.sell_quantity - b.sell_quantity
					break
			}

			return sortDirection === "asc" ? comparison : -comparison
		})

		return copied
	}, [filteredRows, sortDirection, sortKey])

	const emptyResultMessage = useMemo(() => {
		if (loading || error || sortedRows.length > 0) {
			return null
		}

		if (rows.length === 0) {
			return "No profitable crafts are loaded yet. Use Data Sync to load items, recipes, and prices, then reload the table."
		}

		if (watchlistOnly && watchlistIds.length === 0) {
			return "Your watchlist is empty. Turn off Watchlist Only or add crafts with the Watch button."
		}

		if (watchlistOnly) {
			return "None of your watched crafts match the current filters."
		}

		if (itemNameSearch.trim()) {
			return "No loaded crafts match the current name search and filters."
		}

		return "No loaded crafts match the current filters."
	}, [error, itemNameSearch, loading, rows.length, sortedRows.length, watchlistIds.length, watchlistOnly])

	async function handleLoadTableDepth() {
		const rowsToLoad = sortedRows
			.filter((row) => {
				const cacheKey = listingDepthCacheKey(row.item_id, materialPricing)
				return tableDepthByKey[cacheKey] === undefined && tableDepthErrorsByKey[cacheKey] === undefined
			})
			.slice(0, tableDepthLoadLimit)

		if (rowsToLoad.length === 0) {
			setTableDepthMessage("Depth is already loaded for the current top rows.")
			return
		}

		setTableDepthLoading(true)
		setTableDepthLoadedCount(0)
		setTableDepthMessage(null)

		let processedCount = 0

		try {
			for (const row of rowsToLoad) {
				const cacheKey = listingDepthCacheKey(row.item_id, materialPricing)

				try {
					const depth = await fetchListingDepth(row.item_id, {
						material_pricing: materialPricing,
					})
					setTableDepthByKey((current) => ({
						...current,
						[cacheKey]: depth,
					}))
				} catch (err) {
					const message = err instanceof Error ? err.message : "Unable to load listing depth."
					setTableDepthErrorsByKey((current) => ({
						...current,
						[cacheKey]: message,
					}))
				} finally {
					processedCount += 1
					setTableDepthLoadedCount(processedCount)
				}
			}

			setTableDepthMessage(
				`Loaded Trading Post depth for ${formatNumber(rowsToLoad.length)} table row${rowsToLoad.length === 1 ? "" : "s"}.`,
			)
		} finally {
			setTableDepthLoading(false)
		}
	}

	const summaryHighlights = useMemo(() => {
		if (filteredRows.length === 0) {
			return []
		}

		const topProfit = filteredRows.reduce((best, row) => (row.profit > best.profit ? row : best), filteredRows[0])
		const bestValueAdd = filteredRows.reduce((best, row) => (row.value_add > best.value_add ? row : best), filteredRows[0])
		const highestRoi = filteredRows.reduce<ProfitableCraft | null>((best, row) => {
			if (row.roi === null) {
				return best
			}

			if (best === null || row.roi > (best.roi ?? -Infinity)) {
				return row
			}

			return best
		}, null)

		const highlights: Array<{
			label: string
			name: string
			value: number
			formattedValue: string
			valueKind: "currency" | "roi"
		}> = [
			{
				label: "Top Profit",
				name: topProfit.name,
				value: topProfit.profit,
				formattedValue: formatCoins(topProfit.profit),
				valueKind: "currency" as const,
			},
			{
				label: "Best Value Add",
				name: bestValueAdd.name,
				value: bestValueAdd.value_add,
				formattedValue: formatCoins(bestValueAdd.value_add),
				valueKind: "currency" as const,
			},
		]

		if (highestRoi !== null) {
			highlights.push({
				label: "Highest ROI",
				name: highestRoi.name,
				value: highestRoi.roi ?? 0,
				formattedValue: formatPercent(highestRoi.roi),
				valueKind: "roi" as const,
			})
		}

		return highlights
	}, [filteredRows])

	const priceDataWarning = useMemo(() => {
		if (syncStatus === null) {
			return null
		}

		if (syncStatus.price_count === 0 || syncStatus.price_last_updated === null) {
			return "No Trading Post price cache is available. Sync TP prices before trusting profit results."
		}

		const priceLastUpdated = new Date(syncStatus.price_last_updated)
		const priceAgeMs = Date.now() - priceLastUpdated.getTime()

		if (Number.isNaN(priceAgeMs)) {
			return "Trading Post price sync timestamp could not be read. Sync TP prices before trusting profit results."
		}

		if (priceAgeMs > priceDataStaleAfterMs) {
			return `Trading Post prices are ${formatAge(priceAgeMs)} old. Sync TP prices for current profit estimates.`
		}

		return null
	}, [syncStatus])

	const shoppingPlan = useMemo<ShoppingPlan | null>(() => {
		if (selectedItem === null) {
			return null
		}

		const outputPerRecipe = Math.max(1, selectedItem.output_item_count ?? 1)
		const requestedOutputCount = Math.max(1, Math.floor(batchOutputCount) || 1)
		const recipeRuns = Math.ceil(requestedOutputCount / outputPerRecipe)
		const plannedOutputCount = recipeRuns * outputPerRecipe
		const rows = (selectedItem.ingredients ?? []).map((ingredient) => {
			const requiredCount = ingredient.count * recipeRuns
			const ownedCount = ingredient.owned_count ?? 0
			const ownedAppliedCount = Math.min(requiredCount, ownedCount)
			const missingCount = Math.max(requiredCount - ownedCount, 0)
			const missingBuyCost = ingredient.buy_price === null ? null : ingredient.buy_price * missingCount

			return {
				itemId: ingredient.item_id,
				name: ingredient.name,
				requiredCount,
				ownedCount,
				ownedAppliedCount,
				missingCount,
				unitBuyPrice: ingredient.buy_price,
				missingBuyCost,
			}
		})
		const missingBuyCost = rows.reduce((total, row) => total + (row.missingBuyCost ?? 0), 0)
		const requiredIngredientCount = rows.reduce((total, row) => total + row.requiredCount, 0)
		const ownedAppliedCount = rows.reduce((total, row) => total + row.ownedAppliedCount, 0)
		const ownedCoverageRatio = requiredIngredientCount > 0 ? ownedAppliedCount / requiredIngredientCount : 1
		const hasUnavailablePrices = rows.some((row) => row.missingCount > 0 && row.missingBuyCost === null)
		const totalNetSale = selectedItem.net_sale * plannedOutputCount
		const instantSellDepthLimit = listingDepth?.instant_sell_limit_quantity ?? null
		const planWithoutCopy = {
			requestedOutputCount,
			recipeRuns,
			plannedOutputCount,
			totalCraftCost: selectedItem.craft_cost * plannedOutputCount,
			totalNetSale,
			marketProfit: selectedItem.profit * plannedOutputCount,
			outOfPocketCost: missingBuyCost,
			outOfPocketProfit: totalNetSale - missingBuyCost,
			requiredIngredientCount,
			ownedAppliedCount,
			ownedCoverageRatio,
			missingBuyCost,
			hasUnavailablePrices,
			instantSellDepthLimit,
			plannedExceedsInstantSellDepth:
				instantSellDepthLimit !== null && plannedOutputCount > instantSellDepthLimit,
			rows,
		}

		return {
			...planWithoutCopy,
			copyText: buildShoppingListCopyText(selectedItem.name, planWithoutCopy),
		}
	}, [batchOutputCount, listingDepth, selectedItem])

	useEffect(() => {
		if (hasLoadedInitialData.current) {
			return
		}

		hasLoadedInitialData.current = true
		void loadData()
		void refreshPriceHistoryControls()
	}, [loadData, refreshPriceHistoryControls])

	useEffect(() => {
		if (!hasLoadedInitialData.current) {
			return
		}

		void loadPriceHistoryRelevance()
	}, [loadPriceHistoryRelevance])

	return (
		<Box
			sx={{
				bgcolor: "#f6f1e8",
				minHeight: "100vh",
				p: 3,
			}}
		>
			<Stack spacing={3}>
				<Box>
					<Typography
						variant="h4"
						gutterBottom
						sx={{ color: "#2f261b", fontWeight: 800 }}
					>
						Profitable Crafts
					</Typography>
					<Typography variant="body1" color="text.secondary">
						Explore profitable Guild Wars 2 crafting opportunities using live Trading Post data.
					</Typography>
				</Box>

				<Paper
					elevation={2}
					sx={{
						bgcolor: warmPanel,
						border: "1px solid rgba(98, 63, 24, 0.12)",
						borderLeft: `4px solid ${accentColor}`,
						borderRadius: 2,
						p: 2.25,
					}}
				>
					<Stack spacing={2}>
						<Stack
							direction={{ xs: "column", md: "row" }}
							justifyContent="space-between"
							spacing={1}
						>
							<Box>
								<Typography
									variant="subtitle2"
									sx={{ color: "#5a3d1f", fontWeight: 800, textTransform: "uppercase" }}
								>
									Data Sync
								</Typography>
								<Typography variant="body2" color="text.secondary">
									Items and recipes are slower full-data syncs. Prices are the usual refresh before evaluating profit.
								</Typography>
							</Box>
						</Stack>

						<Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} flexWrap="wrap" useFlexGap>
							<SyncButton dataset="prices" label="Sync Prices" />
							<SyncButton dataset="items" label="Sync Items" />
							<SyncButton dataset="recipes" label="Sync Recipes" />
						</Stack>

						<Stack
							direction={{ xs: "column", sm: "row" }}
							spacing={1}
							sx={{ color: "text.secondary" }}
						>
							<Typography variant="caption">
								TP prices synced: {formatDateTime(syncStatus?.price_last_updated)}
							</Typography>
							<Typography variant="caption">
								Status checked: {formatDateTime(syncStatusCheckedAt)}
							</Typography>
							{syncStatus && (
								<Typography variant="caption">
									Cache: {formatNumber(syncStatus.item_count)} items, {formatNumber(syncStatus.recipe_count)} recipes,{" "}
									{formatNumber(syncStatus.price_count)} prices
								</Typography>
							)}
						</Stack>

						<Divider />

						<Stack spacing={1.5}>
							<Stack
								direction={{ xs: "column", md: "row" }}
								justifyContent="space-between"
								spacing={1.5}
							>
								<Box>
									<Typography
										variant="subtitle2"
										sx={{ color: "#5a3d1f", fontWeight: 800, textTransform: "uppercase" }}
									>
										Automatic Price History
									</Typography>
									<Typography variant="body2" color="text.secondary">
										Server-side Trading Post price refresh with local snapshots, rollups, retention, and ignored items.
									</Typography>
								</Box>

								<Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
									<Chip
										label={autoPriceSyncStatus?.enabled ? "Auto Sync On" : "Paused"}
										color={autoPriceSyncStatus?.enabled ? "success" : "default"}
										size="small"
										sx={{ fontWeight: 800 }}
									/>
									<Chip
										label={autoPriceSyncStatus?.running ? "Running" : "Idle"}
										color={autoPriceSyncStatus?.running ? "warning" : "default"}
										size="small"
										variant="outlined"
										sx={{ fontWeight: 800 }}
									/>
									<Button
										variant={autoPriceSyncStatus?.enabled ? "outlined" : "contained"}
										disabled={priceHistorySaving}
										onClick={() => void handleToggleAutoPriceSync()}
										sx={{
											bgcolor: autoPriceSyncStatus?.enabled ? "transparent" : accentColor,
											borderColor: accentColor,
											color: autoPriceSyncStatus?.enabled ? accentColor : "#fff",
											minHeight: 36,
											"&:hover": {
												borderColor: "#8d5e25",
												bgcolor: autoPriceSyncStatus?.enabled ? "rgba(165, 111, 44, 0.08)" : "#8d5e25",
											},
										}}
									>
										{autoPriceSyncStatus?.enabled ? "Pause Auto Sync" : "Resume Auto Sync"}
									</Button>
									<Button
										variant="outlined"
										disabled={priceHistorySaving || priceHistoryLoading}
										onClick={() => void refreshPriceHistoryControls()}
										sx={{
											borderColor: accentColor,
											color: accentColor,
											minHeight: 36,
											"&:hover": {
												borderColor: "#8d5e25",
												bgcolor: "rgba(165, 111, 44, 0.08)",
											},
										}}
									>
										Refresh Status
									</Button>
								</Stack>
							</Stack>

							<Stack
								direction={{ xs: "column", sm: "row" }}
								spacing={1}
								sx={{ color: "text.secondary" }}
							>
								<Typography variant="caption">
									Last auto price sync: {formatDateTime(autoPriceSyncStatus?.last_price_sync_at)}
								</Typography>
								<Typography variant="caption">
									Last snapshot: {formatDateTime(autoPriceSyncStatus?.last_snapshot_at)}
								</Typography>
								<Typography variant="caption">
									Next eligible sync: {formatDateTime(autoPriceSyncStatus?.next_due_at)}
								</Typography>
							</Stack>

							{autoPriceSyncStatus?.last_error && (
								<Alert severity="error">{autoPriceSyncStatus.last_error}</Alert>
							)}

							{priceHistoryError && <Alert severity="error">{priceHistoryError}</Alert>}

							{priceHistoryMessage && <Alert severity="success">{priceHistoryMessage}</Alert>}

							{priceHistoryEstimate && (
								<Box
									sx={{
										display: "grid",
										gap: 1.25,
										gridTemplateColumns: {
											xs: "1fr",
											sm: "repeat(2, minmax(0, 1fr))",
											lg: "repeat(6, minmax(0, 1fr))",
										},
									}}
								>
									<Box sx={compactMetricSx}>
										<Typography variant="caption" color="text.secondary">Tracked Items</Typography>
										<Typography sx={{ fontWeight: 750 }}>
											{formatNumber(priceHistoryEstimate.tracked_item_count)}
										</Typography>
									</Box>
									<Box sx={compactMetricSx}>
										<Typography variant="caption" color="text.secondary">Ignored Items</Typography>
										<Typography sx={{ fontWeight: 750 }}>
											{formatNumber(priceHistoryEstimate.ignored_item_count)}
										</Typography>
									</Box>
									<Box sx={compactMetricSx}>
										<Typography variant="caption" color="text.secondary">Raw Data / Day</Typography>
										<Typography sx={{ fontWeight: 750 }}>
											{formatStorageMegabytes(priceHistoryEstimate.estimated_raw_mb_per_day)}
										</Typography>
									</Box>
									<Box sx={compactMetricSx}>
										<Typography variant="caption" color="text.secondary">Retention Estimate</Typography>
										<Typography sx={{ fontWeight: 750 }}>
											{formatStorageMegabytes(priceHistoryEstimate.estimated_total_retention_mb)}
										</Typography>
									</Box>
									<Box sx={compactMetricSx}>
										<Typography variant="caption" color="text.secondary">Current History</Typography>
										<Typography sx={{ fontWeight: 750 }}>
											{formatStorageMegabytes(priceHistoryEstimate.current_history_estimated_mb)}
										</Typography>
									</Box>
									<Box sx={compactMetricSx}>
										<Typography variant="caption" color="text.secondary">Database File</Typography>
										<Typography sx={{ fontWeight: 750 }}>
											{formatStorageMegabytes(priceHistoryEstimate.database_file_mb)}
										</Typography>
									</Box>
								</Box>
							)}

							{priceHistoryConfig && (
								<Stack direction={{ xs: "column", lg: "row" }} spacing={1.5} flexWrap="wrap" useFlexGap>
									<TextField
										label="Sync Interval (min)"
										type="number"
										value={priceHistoryConfig.price_sync_interval_minutes}
										onChange={(e) => handlePriceHistoryNumberSetting("price_sync_interval_minutes", Number(e.target.value))}
										size="small"
										sx={{ width: 170 }}
									/>
									<TextField
										label="Raw Retention (days)"
										type="number"
										value={priceHistoryConfig.raw_snapshot_retention_days}
										onChange={(e) => handlePriceHistoryNumberSetting("raw_snapshot_retention_days", Number(e.target.value))}
										size="small"
										sx={{ width: 180 }}
									/>
									<TextField
										label="Hourly Rollups (days)"
										type="number"
										value={priceHistoryConfig.hourly_rollup_retention_days}
										onChange={(e) => handlePriceHistoryNumberSetting("hourly_rollup_retention_days", Number(e.target.value))}
										size="small"
										sx={{ width: 190 }}
									/>
									<TextField
										label="Daily Rollups (days)"
										type="number"
										value={priceHistoryConfig.daily_rollup_retention_days}
										onChange={(e) => handlePriceHistoryNumberSetting("daily_rollup_retention_days", Number(e.target.value))}
										size="small"
										sx={{ width: 185 }}
									/>
									<TextField
										label="Max History (MB)"
										type="number"
										value={priceHistoryConfig.max_history_mb}
										onChange={(e) => handlePriceHistoryNumberSetting("max_history_mb", Number(e.target.value))}
										size="small"
										sx={{ width: 170 }}
									/>
									<TextField
										select
										label="Snapshot Items"
										value={priceHistoryConfig.snapshot_item_mode}
										onChange={(e) => handlePriceHistoryModeSetting(e.target.value as SnapshotItemMode)}
										size="small"
										sx={{ minWidth: 180 }}
									>
										<MenuItem value="relevant">Relevant Only</MenuItem>
										<MenuItem value="all">All Priced Items</MenuItem>
									</TextField>
									<Button
										variant="contained"
										disabled={priceHistorySaving}
										onClick={() => void handleSavePriceHistoryConfig()}
										sx={{
											bgcolor: accentColor,
											minHeight: 40,
											"&:hover": {
												bgcolor: "#8d5e25",
											},
										}}
									>
										Save History Settings
									</Button>
								</Stack>
							)}

							<Divider />

							<Stack spacing={1.25}>
								<Stack
									direction={{ xs: "column", md: "row" }}
									justifyContent="space-between"
									spacing={1.25}
								>
									<Box>
										<Typography variant="subtitle2" sx={{ color: "#5a3d1f", fontWeight: 800 }}>
											Tracked Item Review
										</Typography>
										<Typography variant="body2" color="text.secondary">
											Showing {formatNumber(priceHistoryItems.length)} of {formatNumber(priceHistoryTotal)} matching items.
										</Typography>
									</Box>
									<Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
										<TextField
											label="Search Items"
											value={priceHistorySearch}
											onChange={(e) => setPriceHistorySearch(e.target.value)}
											size="small"
											sx={{ minWidth: 220 }}
										/>
										<TextField
											select
											label="Review Filter"
											value={priceHistoryFilter}
											onChange={(e) => setPriceHistoryFilter(e.target.value as PriceHistoryRelevanceFilter)}
											size="small"
											sx={{ minWidth: 160 }}
										>
											<MenuItem value="relevant">Relevant</MenuItem>
											<MenuItem value="ignored">Ignored</MenuItem>
											<MenuItem value="untracked">Untracked</MenuItem>
											<MenuItem value="all">All</MenuItem>
										</TextField>
									</Stack>
								</Stack>

								<TableContainer
									component={Box}
									sx={{
										border: "1px solid rgba(98, 63, 24, 0.14)",
										borderRadius: 2,
										maxHeight: 260,
										overflow: "auto",
									}}
								>
									<Table stickyHeader size="small" sx={{ minWidth: 760 }}>
										<TableHead>
											<TableRow>
												<TableCell sx={tableHeaderCellSx}>Item</TableCell>
												<TableCell sx={tableHeaderCellSx}>Why</TableCell>
												<TableCell sx={tableHeaderCellSx}>History Status</TableCell>
												<TableCell align="right" sx={tableHeaderCellSx}>Action</TableCell>
											</TableRow>
										</TableHead>
										<TableBody>
											{priceHistoryItems.map((item) => (
												<TableRow key={item.item_id} hover sx={zebraRowSx}>
													<TableCell>
														<Typography variant="body2" sx={{ fontWeight: 700 }}>
															{item.name}
														</Typography>
														<Typography variant="caption" color="text.secondary">
															{item.item_id}
														</Typography>
													</TableCell>
													<TableCell>{item.reasons.join(", ")}</TableCell>
													<TableCell>
														<Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
															<Chip
																label={item.is_ignored ? "Ignored" : item.is_tracked ? "Tracked" : "Not Tracked"}
																color={item.is_ignored ? "default" : item.is_tracked ? "success" : "warning"}
																size="small"
																sx={{ fontWeight: 800 }}
															/>
															{!item.has_price && (
																<Chip label="No TP Price" size="small" variant="outlined" />
															)}
														</Stack>
													</TableCell>
													<TableCell align="right">
														<Button
															size="small"
															variant={item.is_ignored ? "contained" : "outlined"}
															disabled={priceHistorySaving}
															onClick={() => void handleTogglePriceHistoryIgnore(item)}
															sx={{
																bgcolor: item.is_ignored ? accentColor : "transparent",
																borderColor: accentColor,
																color: item.is_ignored ? "#fff" : accentColor,
																minWidth: 88,
																"&:hover": {
																	bgcolor: item.is_ignored ? "#8d5e25" : "rgba(165, 111, 44, 0.08)",
																	borderColor: "#8d5e25",
																},
															}}
														>
															{item.is_ignored ? "Restore" : "Ignore"}
														</Button>
													</TableCell>
												</TableRow>
											))}
											{priceHistoryItems.length === 0 && (
												<TableRow>
													<TableCell colSpan={4}>
														<Typography variant="body2" color="text.secondary">
															{priceHistoryLoading ? "Loading tracked item review." : "No items match the current review filter."}
														</Typography>
													</TableCell>
												</TableRow>
											)}
										</TableBody>
									</Table>
								</TableContainer>
							</Stack>
						</Stack>

						<Divider />

						<Stack spacing={1.5}>
							<Box>
								<Typography
									variant="subtitle2"
									sx={{ color: "#5a3d1f", fontWeight: 800, textTransform: "uppercase" }}
								>
									Account Holdings
								</Typography>
								<Typography variant="body2" color="text.secondary">
									Read-only material storage and bank sync requires a GW2 API key with account and inventories permissions.
								</Typography>
							</Box>

							<Stack direction={{ xs: "column", md: "row" }} spacing={1.5} flexWrap="wrap" useFlexGap>
								<TextField
									label="GW2 API Key"
									type="password"
									value={accountApiKey}
									onChange={(e) => {
										setAccountApiKey(e.target.value)
										setAccountKeySaved(false)
									}}
									size="small"
									sx={{ minWidth: { xs: "100%", md: 360 } }}
								/>

								<Button
									variant="outlined"
									disabled={accountSyncing || syncInProgress !== null}
									onClick={handleSaveAccountApiKey}
									sx={{
										borderColor: accentColor,
										color: accentColor,
										minHeight: 40,
										"&:hover": {
											borderColor: "#8d5e25",
											bgcolor: "rgba(165, 111, 44, 0.08)",
										},
									}}
								>
									{accountKeySaved ? "Key Saved" : "Save Key"}
								</Button>

								<Button
									variant="contained"
									disabled={loading || accountSyncing || syncInProgress !== null || !accountApiKey.trim()}
									onClick={() => void handleAccountHoldingsSync()}
									sx={{
										bgcolor: accentColor,
										minHeight: 40,
										minWidth: 190,
										"&:hover": {
											bgcolor: "#8d5e25",
										},
									}}
								>
									{accountSyncing ? (
										<Stack direction="row" spacing={1} alignItems="center">
											<CircularProgress color="inherit" size={16} />
											<span>Syncing Holdings</span>
										</Stack>
									) : (
										"Sync Account Holdings"
									)}
								</Button>
							</Stack>

							<Stack
								direction={{ xs: "column", sm: "row" }}
								spacing={1}
								sx={{ color: "text.secondary" }}
							>
								<Typography variant="caption">
									Holdings synced: {formatDateTime(accountHoldingsStatus?.last_updated)}
								</Typography>
								{accountHoldingsStatus && (
									<Typography variant="caption">
										Account cache: {formatNumber(accountHoldingsStatus.holding_count)} item types,{" "}
										{formatNumber(accountHoldingsStatus.total_owned)} total owned
									</Typography>
								)}
							</Stack>
						</Stack>
					</Stack>
				</Paper>

				<Paper
					elevation={2}
					sx={{
						bgcolor: warmPanel,
						border: "1px solid rgba(98, 63, 24, 0.12)",
						borderLeft: `4px solid ${accentColor}`,
						borderRadius: 2,
						p: 2.25,
					}}
				>
					<Stack spacing={2}>
						<Typography
							variant="subtitle2"
							sx={{ color: "#5a3d1f", fontWeight: 800, textTransform: "uppercase" }}
						>
							Filters
						</Typography>
						<Stack direction={{ xs: "column", md: "row" }} spacing={2} flexWrap="wrap" useFlexGap>
						<TextField
							label="Limit"
							type="number"
							value={limit}
							onChange={(e) => setLimit(Number(e.target.value))}
							size="small"
						/>

						<TextField
							label="Min Profit"
							type="number"
							value={minProfit}
							onChange={(e) => setMinProfit(Number(e.target.value))}
							size="small"
						/>

						<TextField
							label="Min Buy Quantity"
							type="number"
							value={minBuyQuantity}
							onChange={(e) => setMinBuyQuantity(Number(e.target.value))}
							size="small"
						/>

						<TextField
							label="Min Sell Quantity"
							type="number"
							value={minSellQuantity}
							onChange={(e) => setMinSellQuantity(Number(e.target.value))}
							size="small"
						/>

						<TextField
							select
							label="Discipline"
							value={discipline}
							onChange={(e) => setDiscipline(e.target.value)}
							size="small"
							sx={{ minWidth: 180 }}
						>
							{disciplineOptions.map((option) => (
								<MenuItem key={option} value={option}>
									{option || "All"}
								</MenuItem>
							))}
						</TextField>

						<TextField
							label="Search Item Name"
							value={itemNameSearch}
							onChange={(e) => setItemNameSearch(e.target.value)}
							placeholder="Partial name"
							size="small"
							sx={{ minWidth: 240 }}
						/>

						<FormControlLabel
							control={
								<Checkbox
									checked={excludeLowLiquidity}
									onChange={(e) => setExcludeLowLiquidity(e.target.checked)}
								/>
							}
							label="Exclude Low Liquidity"
						/>

						<FormControlLabel
							control={
								<Checkbox
									checked={excludeSuspiciousSpread}
									onChange={(e) => setExcludeSuspiciousSpread(e.target.checked)}
								/>
							}
							label="Exclude Suspicious Spread"
						/>

						<FormControlLabel
							control={
								<Checkbox
									checked={watchlistOnly}
									onChange={(e) => setWatchlistOnly(e.target.checked)}
								/>
							}
							label="Watchlist Only"
						/>

						<TextField
							select
							label="Material Pricing"
							value={materialPricing}
							onChange={(e) => setMaterialPricing(e.target.value as MaterialPricingMode)}
							size="small"
							sx={{ minWidth: 180 }}
						>
							<MenuItem value="buy">Buy Order</MenuItem>
							<MenuItem value="sell">Instant Buy</MenuItem>
						</TextField>

						<TextField
							select
							label="Output Pricing"
							value={outputPricing}
							onChange={(e) => setOutputPricing(e.target.value as OutputPricingMode)}
							size="small"
							sx={{ minWidth: 180 }}
						>
							<MenuItem value="sell">List Sell</MenuItem>
							<MenuItem value="buy">Instant Sell</MenuItem>
						</TextField>

						<Button
							variant="contained"
							disabled={loading || accountSyncing || syncInProgress !== null}
							onClick={() => void loadData()}
							sx={{
								bgcolor: accentColor,
								minHeight: 40,
								"&:hover": {
									bgcolor: "#8d5e25",
								},
							}}
						>
							Refresh Results
						</Button>
						</Stack>

						<Divider />

						<Stack spacing={1.5}>
							<Box>
								<Typography
									variant="subtitle2"
									sx={{ color: "#5a3d1f", fontWeight: 800, textTransform: "uppercase" }}
								>
									Saved Filters
								</Typography>
								<Typography variant="body2" color="text.secondary">
									Save this filter setup or restore one of your local presets.
								</Typography>
							</Box>

							<Stack direction={{ xs: "column", md: "row" }} spacing={1.5} flexWrap="wrap" useFlexGap>
								<TextField
									label="Preset Name"
									value={filterPresetName}
									onChange={(e) => setFilterPresetName(e.target.value)}
									size="small"
									sx={{ minWidth: 220 }}
								/>

								<Button
									variant="contained"
									onClick={handleSaveFilterPreset}
									sx={{
										bgcolor: accentColor,
										minHeight: 40,
										"&:hover": {
											bgcolor: "#8d5e25",
										},
									}}
								>
									Save Filter
								</Button>

								<TextField
									select
									label="Saved Filter"
									value={selectedFilterPresetId}
									onChange={(e) => {
										const nextId = e.target.value
										setSelectedFilterPresetId(nextId)
										const preset = filterPresets.find((current) => current.id === nextId)
										setFilterPresetName(preset?.name ?? "")
									}}
									size="small"
									sx={{ minWidth: 220 }}
								>
									<MenuItem value="">Choose preset</MenuItem>
									{filterPresets.map((preset) => (
										<MenuItem key={preset.id} value={preset.id}>
											{preset.name}
										</MenuItem>
									))}
								</TextField>

								<Button
									variant="outlined"
									disabled={!selectedFilterPresetId}
									onClick={handleApplyFilterPreset}
									sx={{
										borderColor: accentColor,
										color: accentColor,
										minHeight: 40,
										"&:hover": {
											borderColor: "#8d5e25",
											bgcolor: "rgba(165, 111, 44, 0.08)",
										},
									}}
								>
									Apply Filter
								</Button>

								<Button
									variant="outlined"
									disabled={!selectedFilterPresetId}
									onClick={handleDeleteFilterPreset}
									sx={{
										borderColor: "error.main",
										color: "error.main",
										minHeight: 40,
										"&:hover": {
											borderColor: "error.dark",
											bgcolor: "rgba(211, 47, 47, 0.08)",
										},
									}}
								>
									Delete Filter
								</Button>
							</Stack>

							{filterPresetMessage && (
								<Typography variant="caption" color="text.secondary">
									{filterPresetMessage}
								</Typography>
							)}
						</Stack>

						<Stack
							direction={{ xs: "column", sm: "row" }}
							spacing={1}
							sx={{ color: "text.secondary" }}
						>
							<Typography variant="caption">
								Loaded: {formatDateTime(lastLoadedAt)}
							</Typography>
							<Typography variant="caption">
								Showing {formatNumber(sortedRows.length)} of {formatNumber(rows.length)} loaded crafts
							</Typography>
							<Typography variant="caption">
								Watching {formatNumber(watchlistIds.length)} crafts
							</Typography>
						</Stack>
					</Stack>
				</Paper>

				{priceDataWarning && <Alert severity="warning">{priceDataWarning}</Alert>}

				{syncError && <Alert severity="error">{syncError}</Alert>}

				{syncMessage && <Alert severity="success">{syncMessage}</Alert>}

				{accountSyncError && <Alert severity="error">{accountSyncError}</Alert>}

				{accountSyncMessage && <Alert severity="success">{accountSyncMessage}</Alert>}

				{loading && (
					<Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
						<CircularProgress />
					</Box>
				)}

				{error && <Alert severity="error">{error}</Alert>}

				{emptyResultMessage && <Alert severity="info">{emptyResultMessage}</Alert>}

				{!loading && !error && summaryHighlights.length > 0 && (
					<Box
						sx={{
							display: "grid",
							gap: 2,
							gridTemplateColumns: {
								xs: "1fr",
								md: "repeat(3, minmax(0, 1fr))",
							},
						}}
					>
						{summaryHighlights.map((highlight) => (
							<Paper
								key={highlight.label}
								elevation={1}
								sx={{
									bgcolor: warmPanel,
									border: "1px solid rgba(98, 63, 24, 0.12)",
									borderRadius: 2,
									p: 2,
								}}
							>
								<Typography variant="caption" sx={{ color: "#6b4b25", fontWeight: 800 }}>
									{highlight.label}
								</Typography>
								<Typography
									variant="h6"
									sx={{
										color:
											highlight.valueKind === "roi"
												? roiColor(highlight.value)
												: signedValueColor(highlight.value),
										fontWeight: 850,
										mt: 0.25,
									}}
								>
									{highlight.formattedValue}
								</Typography>
								<Typography
									variant="body2"
									color="text.secondary"
									noWrap
									title={highlight.name}
								>
									{highlight.name}
								</Typography>
							</Paper>
						))}
					</Box>
				)}

				{!loading && !error && (
					<Paper
						elevation={1}
						sx={{
							bgcolor: warmPanel,
							border: "1px solid rgba(98, 63, 24, 0.12)",
							borderRadius: 2,
							p: 2,
						}}
					>
						<Stack
							direction={{ xs: "column", md: "row" }}
							justifyContent="space-between"
							spacing={1.5}
						>
							<Box>
								<Typography
									variant="subtitle2"
									sx={{ color: "#5a3d1f", fontWeight: 800, textTransform: "uppercase" }}
								>
									Table Risk Signals
								</Typography>
								<Typography variant="body2" color="text.secondary">
									Low-liquidity and spread flags are immediate. Market depth columns load on demand for up to{" "}
									{formatNumber(tableDepthLoadLimit)} current rows.
								</Typography>
							</Box>

							<Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
								<Button
									variant="outlined"
									disabled={tableDepthLoading || sortedRows.length === 0}
									onClick={() => void handleLoadTableDepth()}
									sx={{
										borderColor: accentColor,
										color: accentColor,
										minHeight: 40,
										"&:hover": {
											borderColor: "#8d5e25",
											bgcolor: "rgba(165, 111, 44, 0.08)",
										},
									}}
								>
									{tableDepthLoading ? (
										<Stack direction="row" spacing={1} alignItems="center">
											<CircularProgress color="inherit" size={16} />
											<span>
												Loading {formatNumber(tableDepthLoadedCount)}/
												{formatNumber(Math.min(tableDepthLoadLimit, sortedRows.length))}
											</span>
										</Stack>
									) : (
										"Load Visible Depth"
									)}
								</Button>
							</Stack>
						</Stack>

						{tableDepthMessage && (
							<Typography variant="caption" color="text.secondary">
								{tableDepthMessage}
							</Typography>
						)}
					</Paper>
				)}

				{!loading && !error && sortedRows.length > 0 && (
					<TableContainer
						component={Paper}
						elevation={2}
						sx={{
							bgcolor: warmPanel,
							border: "1px solid rgba(98, 63, 24, 0.12)",
							borderRadius: 2,
							maxHeight: "calc(100vh - 360px)",
						}}
					>
						<Table stickyHeader size="small" sx={{ minWidth: 1900 }}>
							<TableHead>
								<TableRow>
									<SortableHeader label="Name" sortKey="name" sx={stickyNameHeaderSx} />
									<TableCell sx={tableHeaderCellSx}>Watch</TableCell>
									<TableCell sx={tableHeaderCellSx}>Risk</TableCell>
									<TableCell sx={tableHeaderCellSx}>Pressure</TableCell>
									<TableCell align="right" sx={tableHeaderCellSx}>Instant Limit</TableCell>
									<TableCell align="right" sx={tableHeaderCellSx}>Depth Profit</TableCell>
									<TableCell sx={tableHeaderCellSx}>Disciplines</TableCell>
									<SortableHeader align="right" label="Craft Cost" sortKey="craft_cost" />
									<SortableHeader align="right" label="Sell Price" sortKey="sell_price" />
									<SortableHeader align="right" label="Net Sale" sortKey="net_sale" />
									<SortableHeader
										align="right"
										label="Ingredient Value"
										sortKey="ingredient_sale_value"
									/>
									<SortableHeader
										align="right"
										label="Crafted Value"
										sortKey="crafted_item_value"
									/>
									<SortableHeader align="right" label="Value Add" sortKey="value_add" />
									<SortableHeader label="Recommendation" sortKey="recommendation" />
									<SortableHeader align="right" label="Profit" sortKey="profit" />
									<SortableHeader align="right" label="ROI" sortKey="roi" />
									<SortableHeader align="right" label="Buy Qty" sortKey="buy_quantity" />
									<SortableHeader align="right" label="Sell Qty" sortKey="sell_quantity" />
								</TableRow>
							</TableHead>
							<TableBody>
								{sortedRows.map((row) => {
									const depth = tableDepthForRow(row)
									const depthError = tableDepthErrorForRow(row)

									return (
										<TableRow
											key={row.item_id}
											hover
											onClick={() => void handleSelectItem(row.item_id)}
											sx={{ ...zebraRowSx, cursor: "pointer" }}
										>
											<TableCell sx={stickyNameCellSx}>{row.name}</TableCell>
											<TableCell>
												<Button
													variant={watchlistIdSet.has(row.item_id) ? "contained" : "outlined"}
													size="small"
													onClick={(event) => {
														event.stopPropagation()
														handleToggleWatchlistItem(row.item_id)
													}}
													sx={{
														bgcolor: watchlistIdSet.has(row.item_id) ? accentColor : "transparent",
														borderColor: accentColor,
														color: watchlistIdSet.has(row.item_id) ? "#fff" : accentColor,
														minWidth: 88,
														"&:hover": {
															bgcolor: watchlistIdSet.has(row.item_id)
																? "#8d5e25"
																: "rgba(165, 111, 44, 0.08)",
															borderColor: "#8d5e25",
														},
													}}
												>
													{watchlistIdSet.has(row.item_id) ? "Watching" : "Watch"}
												</Button>
											</TableCell>
											<TableCell>
												<RiskChips depth={depth} row={row} />
											</TableCell>
											<TableCell>
												{depth ? (
													<Chip
														label={depth.estimated_market_pressure}
														color={marketPressureChipColor(depth.estimated_market_pressure)}
														size="small"
														sx={{ fontWeight: 700 }}
													/>
												) : (
													<Typography
														variant="caption"
														color={depthError ? "error.main" : "text.secondary"}
														title={depthError}
													>
														{depthError ? "Depth error" : "Not loaded"}
													</Typography>
												)}
											</TableCell>
											<TableCell align="right">
												{depth ? formatNumber(depth.instant_sell_limit_quantity) : "-"}
											</TableCell>
											<TableCell
												align="right"
												sx={{
													color: depth ? signedValueColor(depth.instant_sell_depth_profit) : "text.secondary",
													fontWeight: depth ? 700 : 400,
												}}
											>
												{depth ? formatCoins(depth.instant_sell_depth_profit) : "-"}
											</TableCell>
											<TableCell>{row.disciplines.join(", ")}</TableCell>
											<TableCell align="right">{formatCoins(row.craft_cost)}</TableCell>
											<TableCell align="right">{formatCoins(row.sell_price)}</TableCell>
											<TableCell align="right">{formatCoins(row.net_sale)}</TableCell>
											<TableCell align="right">{formatCoins(row.ingredient_sale_value)}</TableCell>
											<TableCell align="right">{formatCoins(row.crafted_item_value)}</TableCell>
											<TableCell
												align="right"
												sx={{ color: valueAddColor(row.value_add), fontWeight: 700 }}
											>
												{formatCoins(row.value_add)}
											</TableCell>
											<TableCell>
												<RecommendationChip recommendation={row.recommendation} />
											</TableCell>
											<TableCell
												align="right"
												sx={{ color: signedValueColor(row.profit), fontWeight: 700 }}
											>
												{formatCoins(row.profit)}
											</TableCell>
											<TableCell
												align="right"
												sx={{ color: roiColor(row.roi), fontWeight: roiFontWeight(row.roi) }}
											>
												{formatPercent(row.roi)}
											</TableCell>
											<TableCell align="right">{formatNumber(row.buy_quantity)}</TableCell>
											<TableCell align="right">{formatNumber(row.sell_quantity)}</TableCell>
										</TableRow>
									)
								})}
							</TableBody>
						</Table>
					</TableContainer>
				)}
			</Stack>

			<Drawer
				anchor="right"
				open={selectedItem !== null || detailLoading || detailError !== null}
				onClose={() => {
					setSelectedItem(null)
					setScenarioRows([])
					setListingDepth(null)
					setListingDepthError(null)
					setDetailError(null)
				}}
				PaperProps={{
					sx: {
						bgcolor: "#f8f2e8",
						width: "min(980px, 92vw)",
					},
				}}
			>
				<Box sx={{ p: 3, height: "100%", overflow: "auto" }}>
					{detailLoading && (
						<Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
							<CircularProgress />
						</Box>
					)}

					{detailError && <Alert severity="error">{detailError}</Alert>}

					{selectedItem && !detailLoading && (
						<Stack spacing={2.5}>
							<Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1.5}>
								<Box>
									<Typography variant="h5" sx={{ color: "#2f261b", fontWeight: 850 }}>
										{selectedItem.name}
									</Typography>
									<Typography variant="body2" color="text.secondary">
										{selectedItem.disciplines.join(", ")}
									</Typography>
								</Box>

								<Button
									variant={watchlistIdSet.has(selectedItem.item_id) ? "contained" : "outlined"}
									onClick={() => handleToggleWatchlistItem(selectedItem.item_id)}
									sx={{
										alignSelf: { xs: "flex-start", sm: "center" },
										bgcolor: watchlistIdSet.has(selectedItem.item_id) ? accentColor : "transparent",
										borderColor: accentColor,
										color: watchlistIdSet.has(selectedItem.item_id) ? "#fff" : accentColor,
										minHeight: 40,
										"&:hover": {
											bgcolor: watchlistIdSet.has(selectedItem.item_id)
												? "#8d5e25"
												: "rgba(165, 111, 44, 0.08)",
											borderColor: "#8d5e25",
										},
									}}
								>
									{watchlistIdSet.has(selectedItem.item_id) ? "Watching" : "Add to Watchlist"}
								</Button>
							</Stack>

							<Paper
								variant="outlined"
								sx={{
									background: recommendationBannerBackground(selectedItem.recommendation),
									borderColor: "rgba(98, 63, 24, 0.16)",
									borderRadius: 2,
									p: 2,
								}}
							>
								<Stack
									direction={{ xs: "column", sm: "row" }}
									justifyContent="space-between"
									spacing={2}
								>
									<Stack spacing={0.75}>
										<Typography variant="caption" sx={{ color: "#6b4b25", fontWeight: 800 }}>
											Current Recommendation
										</Typography>
										<RecommendationChip recommendation={selectedItem.recommendation} />
									</Stack>

									<Stack direction={{ xs: "column", sm: "row" }} spacing={3}>
										<Box>
											<Typography variant="caption" color="text.secondary">
												Value Add
											</Typography>
											<Typography
												variant="h6"
												sx={{ color: valueAddColor(selectedItem.value_add), fontWeight: 850 }}
											>
												{formatCoins(selectedItem.value_add)}
											</Typography>
										</Box>
										<Box>
											<Typography variant="caption" color="text.secondary">
												Profit
											</Typography>
											<Typography
												variant="h6"
												sx={{ color: signedValueColor(selectedItem.profit), fontWeight: 850 }}
											>
												{formatCoins(selectedItem.profit)}
											</Typography>
										</Box>
										<Box>
											<Typography variant="caption" color="text.secondary">
												ROI
											</Typography>
											<Typography
												variant="h6"
												sx={{ color: roiColor(selectedItem.roi), fontWeight: roiFontWeight(selectedItem.roi) }}
											>
												{formatPercent(selectedItem.roi)}
											</Typography>
										</Box>
									</Stack>
								</Stack>
							</Paper>

							<Box
								sx={{
									display: "grid",
									gap: 1.25,
									gridTemplateColumns: {
										xs: "1fr",
										sm: "repeat(2, minmax(0, 1fr))",
										md: "repeat(4, minmax(0, 1fr))",
									},
								}}
							>
								<Box sx={compactMetricSx}>
									<Typography variant="caption" color="text.secondary">Craft Cost</Typography>
									<Typography sx={{ fontWeight: 750 }}>{formatCoins(selectedItem.craft_cost)}</Typography>
								</Box>
								<Box sx={compactMetricSx}>
									<Typography variant="caption" color="text.secondary">Sell Price</Typography>
									<Typography sx={{ fontWeight: 750 }}>{formatCoins(selectedItem.sell_price)}</Typography>
								</Box>
								<Box sx={compactMetricSx}>
									<Typography variant="caption" color="text.secondary">Net Sale</Typography>
									<Typography sx={{ fontWeight: 750 }}>{formatCoins(selectedItem.net_sale)}</Typography>
								</Box>
								<Box sx={compactMetricSx}>
									<Typography variant="caption" color="text.secondary">Ingredient Value</Typography>
									<Typography sx={{ fontWeight: 750 }}>
										{formatCoins(selectedItem.ingredient_sale_value)}
									</Typography>
								</Box>
								<Box sx={compactMetricSx}>
									<Typography variant="caption" color="text.secondary">Crafted Value</Typography>
									<Typography sx={{ fontWeight: 750 }}>
										{formatCoins(selectedItem.crafted_item_value)}
									</Typography>
								</Box>
								<Box sx={compactMetricSx}>
									<Typography variant="caption" color="text.secondary">Buy Quantity</Typography>
									<Typography sx={{ fontWeight: 750 }}>{formatNumber(selectedItem.buy_quantity)}</Typography>
								</Box>
								<Box sx={compactMetricSx}>
									<Typography variant="caption" color="text.secondary">Sell Quantity</Typography>
									<Typography sx={{ fontWeight: 750 }}>{formatNumber(selectedItem.sell_quantity)}</Typography>
								</Box>
							</Box>

							<Divider />

							{shoppingPlan && (
								<>
									<Box>
										<Stack
											direction={{ xs: "column", md: "row" }}
											justifyContent="space-between"
											spacing={2}
											sx={{ mb: 1.5 }}
										>
											<Box>
												<Typography variant="h6" sx={{ color: "#3d2d1c", fontWeight: 800 }}>
													Batch Craft Planner
												</Typography>
												<Typography variant="body2" color="text.secondary">
													Direct recipe ingredients for the selected craft.
												</Typography>
											</Box>

											<Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
												<TextField
													label="Target Output"
													type="number"
													value={batchOutputCount}
													onChange={(event) => {
														const nextValue = Number(event.target.value)
														setBatchOutputCount(Number.isFinite(nextValue) ? Math.max(1, Math.floor(nextValue)) : 1)
														setShoppingListCopyMessage(null)
													}}
													size="small"
													slotProps={{ htmlInput: { min: 1, step: 1 } }}
													sx={{ minWidth: 150 }}
												/>

												<Button
													variant="outlined"
													onClick={() => void handleCopyShoppingList()}
													sx={{
														borderColor: accentColor,
														color: accentColor,
														minHeight: 40,
														"&:hover": {
															borderColor: "#8d5e25",
															bgcolor: "rgba(165, 111, 44, 0.08)",
														},
													}}
												>
													Copy Shopping List
												</Button>
											</Stack>
										</Stack>

										<Box
											sx={{
												display: "grid",
												gap: 1.25,
												gridTemplateColumns: {
													xs: "1fr",
													sm: "repeat(2, minmax(0, 1fr))",
													md: "repeat(4, minmax(0, 1fr))",
												},
												mb: 1.5,
											}}
										>
											<Box sx={compactMetricSx}>
												<Typography variant="caption" color="text.secondary">Recipe Runs</Typography>
												<Typography sx={{ fontWeight: 750 }}>{formatNumber(shoppingPlan.recipeRuns)}</Typography>
											</Box>
											<Box sx={compactMetricSx}>
												<Typography variant="caption" color="text.secondary">Planned Output</Typography>
												<Typography sx={{ fontWeight: 750 }}>{formatNumber(shoppingPlan.plannedOutputCount)}</Typography>
											</Box>
											<Box sx={compactMetricSx}>
												<Typography variant="caption" color="text.secondary">Owned Coverage</Typography>
												<Typography sx={{ fontWeight: 750 }}>
													{formatPercent(shoppingPlan.ownedCoverageRatio)}
												</Typography>
											</Box>
											<Box sx={compactMetricSx}>
												<Typography variant="caption" color="text.secondary">Out-of-pocket Cost</Typography>
												<Typography sx={{ fontWeight: 750 }}>{formatCoins(shoppingPlan.outOfPocketCost)}</Typography>
											</Box>
											<Box sx={compactMetricSx}>
												<Typography variant="caption" color="text.secondary">Out-of-pocket Profit</Typography>
												<Typography
													sx={{ color: signedValueColor(shoppingPlan.outOfPocketProfit), fontWeight: 750 }}
												>
													{formatCoins(shoppingPlan.outOfPocketProfit)}
												</Typography>
											</Box>
											<Box sx={compactMetricSx}>
												<Typography variant="caption" color="text.secondary">Market Craft Cost</Typography>
												<Typography sx={{ fontWeight: 750 }}>{formatCoins(shoppingPlan.totalCraftCost)}</Typography>
											</Box>
											<Box sx={compactMetricSx}>
												<Typography variant="caption" color="text.secondary">Market Profit</Typography>
												<Typography
													sx={{ color: signedValueColor(shoppingPlan.marketProfit), fontWeight: 750 }}
												>
													{formatCoins(shoppingPlan.marketProfit)}
												</Typography>
											</Box>
											<Box sx={compactMetricSx}>
												<Typography variant="caption" color="text.secondary">Net Sale</Typography>
												<Typography sx={{ fontWeight: 750 }}>{formatCoins(shoppingPlan.totalNetSale)}</Typography>
											</Box>
										</Box>

										{shoppingPlan.plannedExceedsInstantSellDepth && shoppingPlan.instantSellDepthLimit !== null && (
											<Alert severity="warning" sx={{ mb: 1.5 }}>
												Planned output exceeds profitable instant-sell depth of{" "}
												{formatNumber(shoppingPlan.instantSellDepthLimit)}. Listing the output may still work, but
												instant-selling this full batch is not supported by current buy orders.
											</Alert>
										)}

										{shoppingPlan.hasUnavailablePrices && (
											<Alert severity="warning" sx={{ mb: 1.5 }}>
												Some missing ingredients do not have current buy prices, so out-of-pocket cost is incomplete.
											</Alert>
										)}

										{shoppingListCopyMessage && (
											<Alert severity="info" sx={{ mb: 1.5 }}>
												{shoppingListCopyMessage}
											</Alert>
										)}

										<TableContainer
											component={Paper}
											variant="outlined"
											sx={{ borderColor: "rgba(98, 63, 24, 0.14)", maxHeight: 320 }}
										>
											<Table stickyHeader size="small" sx={{ minWidth: 900 }}>
												<TableHead>
													<TableRow>
														<TableCell sx={tableHeaderCellSx}>Name</TableCell>
														<TableCell align="right" sx={tableHeaderCellSx}>Required</TableCell>
														<TableCell align="right" sx={tableHeaderCellSx}>Owned</TableCell>
														<TableCell align="right" sx={tableHeaderCellSx}>Missing</TableCell>
														<TableCell align="right" sx={tableHeaderCellSx}>Unit Buy</TableCell>
														<TableCell align="right" sx={tableHeaderCellSx}>Missing Cost</TableCell>
													</TableRow>
												</TableHead>
												<TableBody>
													{shoppingPlan.rows.map((row) => (
														<TableRow key={row.itemId} hover sx={zebraRowSx}>
															<TableCell>{row.name}</TableCell>
															<TableCell align="right">{formatNumber(row.requiredCount)}</TableCell>
															<TableCell align="right">{formatNumber(row.ownedCount)}</TableCell>
															<TableCell
																align="right"
																sx={{
																	color: row.missingCount > 0 ? "warning.main" : "success.main",
																	fontWeight: 700,
																}}
															>
																{formatNumber(row.missingCount)}
															</TableCell>
															<TableCell align="right">{formatCoins(row.unitBuyPrice)}</TableCell>
															<TableCell align="right">{formatCoins(row.missingBuyCost)}</TableCell>
														</TableRow>
													))}
												</TableBody>
											</Table>
										</TableContainer>
									</Box>

									<Divider />
								</>
							)}

							<Box>
								<Typography variant="h6" gutterBottom sx={{ color: "#3d2d1c", fontWeight: 800 }}>
									Trading Post Market Depth
								</Typography>

								{listingDepthError && (
									<Alert severity="warning" sx={{ mb: 1.5 }}>
										{listingDepthError}
									</Alert>
								)}

								{listingDepth && (
									<Stack spacing={1.5}>
										<Box
											sx={{
												display: "grid",
												gap: 1.25,
												gridTemplateColumns: {
													xs: "1fr",
													sm: "repeat(2, minmax(0, 1fr))",
													md: "repeat(4, minmax(0, 1fr))",
												},
											}}
										>
											<Box sx={compactMetricSx}>
												<Typography variant="caption" color="text.secondary">Market Pressure</Typography>
												<Box sx={{ mt: 0.5 }}>
													<Chip
														label={listingDepth.estimated_market_pressure}
														color={marketPressureChipColor(listingDepth.estimated_market_pressure)}
														size="small"
														sx={{ fontWeight: 800 }}
													/>
												</Box>
											</Box>
											<Box sx={compactMetricSx}>
												<Typography variant="caption" color="text.secondary">Break-even Sale</Typography>
												<Typography sx={{ fontWeight: 750 }}>
													{formatCoins(listingDepth.break_even_sale_price)}
												</Typography>
											</Box>
											<Box sx={compactMetricSx}>
												<Typography variant="caption" color="text.secondary">Instant-sell Limit</Typography>
												<Typography sx={{ fontWeight: 750 }}>
													{formatNumber(listingDepth.instant_sell_limit_quantity)}
												</Typography>
											</Box>
											<Box sx={compactMetricSx}>
												<Typography variant="caption" color="text.secondary">Depth Profit</Typography>
												<Typography sx={{ color: signedValueColor(listingDepth.instant_sell_depth_profit), fontWeight: 750 }}>
													{formatCoins(listingDepth.instant_sell_depth_profit)}
												</Typography>
											</Box>
											<Box sx={compactMetricSx}>
												<Typography variant="caption" color="text.secondary">Last Profitable Buy</Typography>
												<Typography sx={{ fontWeight: 750 }}>
													{formatCoins(listingDepth.last_profitable_buy_order_price)}
												</Typography>
											</Box>
											<Box sx={compactMetricSx}>
												<Typography variant="caption" color="text.secondary">Competing Sell Qty</Typography>
												<Typography sx={{ fontWeight: 750 }}>
													{formatNumber(listingDepth.existing_competing_sell_quantity)}
												</Typography>
											</Box>
										</Box>

										<Box
											sx={{
												display: "grid",
												gap: 1.5,
												gridTemplateColumns: {
													xs: "1fr",
													lg: "repeat(2, minmax(0, 1fr))",
												},
											}}
										>
											<TableContainer
												component={Paper}
												variant="outlined"
												sx={{ borderColor: "rgba(98, 63, 24, 0.14)", maxHeight: 300 }}
											>
												<Table stickyHeader size="small">
													<TableHead>
														<TableRow>
															<TableCell sx={tableHeaderCellSx}>Profitable Buy Orders</TableCell>
															<TableCell align="right" sx={tableHeaderCellSx}>Qty</TableCell>
															<TableCell align="right" sx={tableHeaderCellSx}>Net</TableCell>
															<TableCell align="right" sx={tableHeaderCellSx}>Profit Each</TableCell>
														</TableRow>
													</TableHead>
													<TableBody>
														{listingDepth.profitable_buy_order_levels.map((level) => (
															<TableRow key={`${level.unit_price}-${level.quantity}`} hover sx={zebraRowSx}>
																<TableCell>{formatCoins(level.unit_price)}</TableCell>
																<TableCell align="right">{formatNumber(level.quantity)}</TableCell>
																<TableCell align="right">{formatCoins(level.net_sale)}</TableCell>
																<TableCell align="right">{formatCoins(level.profit_per_item)}</TableCell>
															</TableRow>
														))}
														{listingDepth.profitable_buy_order_levels.length === 0 && (
															<TableRow>
																<TableCell colSpan={4}>
																	<Typography variant="body2" color="text.secondary">
																		No currently profitable buy-order depth.
																	</Typography>
																</TableCell>
															</TableRow>
														)}
													</TableBody>
												</Table>
											</TableContainer>

											<TableContainer
												component={Paper}
												variant="outlined"
												sx={{ borderColor: "rgba(98, 63, 24, 0.14)", maxHeight: 300 }}
											>
												<Table stickyHeader size="small">
													<TableHead>
														<TableRow>
															<TableCell sx={tableHeaderCellSx}>Profitable Sell Listings</TableCell>
															<TableCell align="right" sx={tableHeaderCellSx}>Qty</TableCell>
															<TableCell align="right" sx={tableHeaderCellSx}>Net</TableCell>
															<TableCell align="right" sx={tableHeaderCellSx}>Profit Each</TableCell>
														</TableRow>
													</TableHead>
													<TableBody>
														{listingDepth.competing_sell_levels.map((level) => (
															<TableRow key={`${level.unit_price}-${level.quantity}`} hover sx={zebraRowSx}>
																<TableCell>{formatCoins(level.unit_price)}</TableCell>
																<TableCell align="right">{formatNumber(level.quantity)}</TableCell>
																<TableCell align="right">{formatCoins(level.net_sale)}</TableCell>
																<TableCell align="right">{formatCoins(level.profit_per_item)}</TableCell>
															</TableRow>
														))}
														{listingDepth.competing_sell_levels.length === 0 && (
															<TableRow>
																<TableCell colSpan={4}>
																	<Typography variant="body2" color="text.secondary">
																		No currently profitable sell listing levels.
																	</Typography>
																</TableCell>
															</TableRow>
														)}
													</TableBody>
												</Table>
											</TableContainer>
										</Box>
									</Stack>
								)}
							</Box>

							<Divider />

							<Box>
								<Typography variant="h6" gutterBottom sx={{ color: "#3d2d1c", fontWeight: 800 }}>
									Scenario Comparison
								</Typography>

								<TableContainer
									component={Paper}
									variant="outlined"
									sx={{ borderColor: "rgba(98, 63, 24, 0.14)", maxHeight: 320 }}
								>
									<Table stickyHeader size="small" sx={{ minWidth: 1000 }}>
										<TableHead>
											<TableRow>
												<TableCell sx={tableHeaderCellSx}>Materials</TableCell>
												<TableCell sx={tableHeaderCellSx}>Output</TableCell>
												<TableCell align="right" sx={tableHeaderCellSx}>Craft Cost</TableCell>
												<TableCell align="right" sx={tableHeaderCellSx}>Net Sale</TableCell>
												<TableCell align="right" sx={tableHeaderCellSx}>Profit</TableCell>
												<TableCell align="right" sx={tableHeaderCellSx}>ROI</TableCell>
												<TableCell align="right" sx={tableHeaderCellSx}>Ingredient Value</TableCell>
												<TableCell align="right" sx={tableHeaderCellSx}>Crafted Value</TableCell>
												<TableCell align="right" sx={tableHeaderCellSx}>Value Add</TableCell>
												<TableCell sx={tableHeaderCellSx}>Recommendation</TableCell>
											</TableRow>
										</TableHead>
										<TableBody>
											{scenarioRows.map((scenario) => (
												<TableRow
													key={`${scenario.material_pricing}-${scenario.output_pricing}`}
													hover
													sx={zebraRowSx}
												>
													<TableCell>{materialPricingLabel(scenario.material_pricing)}</TableCell>
													<TableCell>{outputPricingLabel(scenario.output_pricing)}</TableCell>
													<TableCell align="right">{formatCoins(scenario.craft_cost)}</TableCell>
													<TableCell align="right">{formatCoins(scenario.net_sale)}</TableCell>
													<TableCell
														align="right"
														sx={{ color: signedValueColor(scenario.profit), fontWeight: 700 }}
													>
														{formatCoins(scenario.profit)}
													</TableCell>
													<TableCell
														align="right"
														sx={{ color: roiColor(scenario.roi), fontWeight: roiFontWeight(scenario.roi) }}
													>
														{formatPercent(scenario.roi)}
													</TableCell>
													<TableCell align="right">{formatCoins(scenario.ingredient_sale_value)}</TableCell>
													<TableCell align="right">{formatCoins(scenario.crafted_item_value)}</TableCell>
													<TableCell
														align="right"
														sx={{ color: valueAddColor(scenario.value_add), fontWeight: 700 }}
													>
														{formatCoins(scenario.value_add)}
													</TableCell>
													<TableCell>
														<RecommendationChip recommendation={scenario.recommendation} />
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</TableContainer>
							</Box>

							<Divider />

							<Box>
								<Typography variant="h6" gutterBottom sx={{ color: "#3d2d1c", fontWeight: 800 }}>
									Ingredients
								</Typography>

								<TableContainer
									component={Paper}
									variant="outlined"
									sx={{ borderColor: "rgba(98, 63, 24, 0.14)", maxHeight: 360 }}
								>
									<Table stickyHeader size="small">
										<TableHead>
											<TableRow>
												<TableCell sx={tableHeaderCellSx}>Name</TableCell>
												<TableCell align="right" sx={tableHeaderCellSx}>Count</TableCell>
												<TableCell align="right" sx={tableHeaderCellSx}>Owned</TableCell>
												<TableCell align="right" sx={tableHeaderCellSx}>Missing</TableCell>
												<TableCell align="right" sx={tableHeaderCellSx}>Buy Price</TableCell>
												<TableCell align="right" sx={tableHeaderCellSx}>Craft Price</TableCell>
												<TableCell sx={tableHeaderCellSx}>Source</TableCell>
												<TableCell align="right" sx={tableHeaderCellSx}>Chosen Unit</TableCell>
												<TableCell align="right" sx={tableHeaderCellSx}>Total</TableCell>
											</TableRow>
										</TableHead>
										<TableBody>
											{selectedItem.ingredients?.map((ingredient) => (
												<TableRow key={ingredient.item_id} hover sx={zebraRowSx}>
													<TableCell>{ingredient.name}</TableCell>
													<TableCell align="right">{formatNumber(ingredient.count)}</TableCell>
													<TableCell align="right">{formatNumber(ingredient.owned_count)}</TableCell>
													<TableCell
														align="right"
														sx={{
															color: ingredient.missing_count > 0 ? "warning.main" : "success.main",
															fontWeight: 700,
														}}
													>
														{formatNumber(ingredient.missing_count)}
													</TableCell>
													<TableCell align="right">{formatCoins(ingredient.buy_price)}</TableCell>
													<TableCell align="right">{formatCoins(ingredient.craft_price)}</TableCell>
													<TableCell>{ingredient.chosen_source}</TableCell>
													<TableCell align="right">{formatCoins(ingredient.chosen_unit_cost)}</TableCell>
													<TableCell align="right">{formatCoins(ingredient.total_cost)}</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</TableContainer>
							</Box>
						</Stack>
					)}
				</Box>
			</Drawer>
		</Box>
	)
}
