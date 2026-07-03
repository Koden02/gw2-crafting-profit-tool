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
	fetchListingDepth,
	fetchPriceHistory,
	fetchProfitDetail,
	fetchProfitScenarios,
	fetchProfitableCrafts,
	fetchSyncStatus,
	syncAccountHoldings,
	syncCommercePrices,
	syncItems,
	syncRecipes,
	type AccountHoldingsStatus,
	type ListingDepthAnalysis,
	type MaterialPricingMode,
	type OutputPricingMode,
	type PriceHistoryResponse,
	type ProfitScenario,
	type ProfitableCraft,
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
const priceHistoryRangeOptions = [1, 7, 30, 90, 365]

type SavedFilterSettings = {
	limit: number
	minProfit: number
	minBuyQuantity: number
	minSellQuantity: number
	excludeLowLiquidity: boolean
	excludeSuspiciousSpread: boolean
	excludeStalledMarkets: boolean
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
		excludeStalledMarkets: typeof value.excludeStalledMarkets === "boolean" ? value.excludeStalledMarkets : true,
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
	| "market_flow_score"
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

type PriceHistoryChartPoint = {
	observedAt: string
	time: number
	buyPrice: number | null
	buyMin: number | null
	buyMax: number | null
	sellPrice: number | null
	sellMin: number | null
	sellMax: number | null
}

function isFiniteNumber(value: number | null | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value)
}

function priceHistoryResolutionLabel(resolution: PriceHistoryResponse["resolution"]): string {
	if (resolution === "raw") {
		return "Raw snapshots"
	}

	if (resolution === "hour") {
		return "Hourly rollup"
	}

	return "Daily rollup"
}

function formatChartTimestamp(value: number): string {
	const date = new Date(value)

	if (Number.isNaN(date.getTime())) {
		return "-"
	}

	return date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
	})
}

function PriceHistoryChart({
	history,
	onSyncPrices,
	syncingPrices,
	syncDisabled,
}: {
	history: PriceHistoryResponse
	onSyncPrices: () => void
	syncingPrices: boolean
	syncDisabled: boolean
}) {
	const chartPoints: PriceHistoryChartPoint[] = history.points
		.map((point) => ({
			observedAt: point.observed_at,
			time: new Date(point.observed_at).getTime(),
			buyPrice: point.buy_price,
			buyMin: point.buy_price_min,
			buyMax: point.buy_price_max,
			sellPrice: point.sell_price,
			sellMin: point.sell_price_min,
			sellMax: point.sell_price_max,
		}))
		.filter((point) => Number.isFinite(point.time) && (isFiniteNumber(point.buyPrice) || isFiniteNumber(point.sellPrice)))

	if (chartPoints.length === 0) {
		return (
			<Alert
				severity="info"
				action={
					<Button
						color="inherit"
						disabled={syncDisabled}
						onClick={onSyncPrices}
						size="small"
					>
						{syncingPrices ? (
							<Stack direction="row" spacing={0.75} alignItems="center">
								<CircularProgress color="inherit" size={14} />
								<span>Syncing</span>
							</Stack>
						) : (
							"Sync Prices"
						)}
					</Button>
				}
			>
				No local price history has been recorded for this item in the selected range.
			</Alert>
		)
	}

	const priceValues = chartPoints
		.flatMap((point) => [
			point.buyPrice,
			point.buyMin,
			point.buyMax,
			point.sellPrice,
			point.sellMin,
			point.sellMax,
		])
		.filter(isFiniteNumber)
	const minPrice = Math.min(...priceValues)
	const maxPrice = Math.max(...priceValues)
	const priceSpan = Math.max(1, maxPrice - minPrice)
	const yMin = Math.max(0, minPrice - priceSpan * 0.08)
	const yMax = maxPrice + priceSpan * 0.08
	const xMin = Math.min(...chartPoints.map((point) => point.time))
	const xMax = Math.max(...chartPoints.map((point) => point.time))
	const xSpan = Math.max(1, xMax - xMin)
	const lastPoint = [...chartPoints].reverse().find(
		(point) => isFiniteNumber(point.buyPrice) || isFiniteNumber(point.sellPrice),
	)
	const width = 640
	const height = 240
	const padding = {
		bottom: 42,
		left: 76,
		right: 24,
		top: 24,
	}
	const chartWidth = width - padding.left - padding.right
	const chartHeight = height - padding.top - padding.bottom
	const gridLines = [0, 0.5, 1].map((ratio) => {
		const value = yMin + (yMax - yMin) * (1 - ratio)
		return {
			ratio,
			value,
			y: padding.top + chartHeight * ratio,
		}
	})

	function mapX(time: number): number {
		return padding.left + ((time - xMin) / xSpan) * chartWidth
	}

	function mapY(price: number): number {
		return padding.top + ((yMax - price) / Math.max(1, yMax - yMin)) * chartHeight
	}

	function buildPolyline(key: "buyPrice" | "sellPrice"): string {
		return chartPoints
			.flatMap((point) => {
				const price = point[key]

				if (!isFiniteNumber(price)) {
					return []
				}

				return [`${mapX(point.time).toFixed(2)},${mapY(price).toFixed(2)}`]
			})
			.join(" ")
	}

	function renderRangeMarkers({
		maxKey,
		minKey,
		stroke,
	}: {
		maxKey: "buyMax" | "sellMax"
		minKey: "buyMin" | "sellMin"
		stroke: string
	}) {
		return chartPoints.map((point) => {
			const minPrice = point[minKey]
			const maxPrice = point[maxKey]

			if (!isFiniteNumber(minPrice) || !isFiniteNumber(maxPrice) || minPrice === maxPrice) {
				return null
			}

			return (
				<line
					key={`${point.time}-${minKey}-${maxKey}`}
					x1={mapX(point.time)}
					x2={mapX(point.time)}
					y1={mapY(maxPrice)}
					y2={mapY(minPrice)}
					stroke={stroke}
					strokeLinecap="round"
					strokeWidth="5"
				/>
			)
		})
	}

	const buyPolyline = buildPolyline("buyPrice")
	const sellPolyline = buildPolyline("sellPrice")

	return (
		<Stack spacing={1.25}>
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
					<Typography variant="caption" color="text.secondary">Resolution</Typography>
					<Typography sx={{ fontWeight: 750 }}>{priceHistoryResolutionLabel(history.resolution)}</Typography>
				</Box>
				<Box sx={compactMetricSx}>
					<Typography variant="caption" color="text.secondary">Samples</Typography>
					<Typography sx={{ fontWeight: 750 }}>{formatNumber(history.point_count)}</Typography>
				</Box>
				<Box sx={compactMetricSx}>
					<Typography variant="caption" color="text.secondary">Latest Buy</Typography>
					<Typography sx={{ color: "#1565c0", fontWeight: 750 }}>
						{formatCoins(lastPoint?.buyPrice)}
					</Typography>
				</Box>
				<Box sx={compactMetricSx}>
					<Typography variant="caption" color="text.secondary">Latest Sell</Typography>
					<Typography sx={{ color: "#2e7d32", fontWeight: 750 }}>
						{formatCoins(lastPoint?.sellPrice)}
					</Typography>
				</Box>
			</Box>

			<Paper
				variant="outlined"
				sx={{
					bgcolor: "rgba(255, 255, 255, 0.78)",
					borderColor: "rgba(98, 63, 24, 0.14)",
					p: 1.5,
				}}
			>
				<Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
					<Stack direction="row" spacing={0.75} alignItems="center">
						<Box sx={{ bgcolor: "#1565c0", borderRadius: "999px", height: 8, width: 22 }} />
						<Typography variant="caption" color="text.secondary">Buy orders</Typography>
					</Stack>
					<Stack direction="row" spacing={0.75} alignItems="center">
						<Box sx={{ bgcolor: "#2e7d32", borderRadius: "999px", height: 8, width: 22 }} />
						<Typography variant="caption" color="text.secondary">Sell listings</Typography>
					</Stack>
					<Typography variant="caption" color="text.secondary">
						Rollup ranges show min/max when available.
					</Typography>
					<Typography variant="caption" color="text.secondary" sx={{ ml: { sm: "auto" } }}>
						Latest: {formatDateTime(lastPoint?.observedAt)}
					</Typography>
				</Stack>

				<Box sx={{ overflow: "hidden", width: "100%" }}>
					<svg
						aria-label={`${history.name} price history`}
						role="img"
						viewBox={`0 0 ${width} ${height}`}
						style={{ display: "block", height: "auto", width: "100%" }}
					>
						<rect x="0" y="0" width={width} height={height} fill="#fffdf8" rx="6" />
						{gridLines.map((line) => (
							<g key={line.ratio}>
								<line
									x1={padding.left}
									x2={width - padding.right}
									y1={line.y}
									y2={line.y}
									stroke="rgba(98, 63, 24, 0.14)"
									strokeWidth="1"
								/>
								<text
									x={padding.left - 8}
									y={line.y + 4}
									fill="#6a5a47"
									fontSize="12"
									textAnchor="end"
								>
									{formatCoins(line.value)}
								</text>
							</g>
						))}
						<line
							x1={padding.left}
							x2={padding.left}
							y1={padding.top}
							y2={height - padding.bottom}
							stroke="rgba(98, 63, 24, 0.2)"
							strokeWidth="1.5"
						/>
						<line
							x1={padding.left}
							x2={width - padding.right}
							y1={height - padding.bottom}
							y2={height - padding.bottom}
							stroke="rgba(98, 63, 24, 0.2)"
							strokeWidth="1.5"
						/>
						<text
							x={padding.left}
							y={height - 14}
							fill="#6a5a47"
							fontSize="12"
							textAnchor="start"
						>
							{formatChartTimestamp(xMin)}
						</text>
						<text
							x={width - padding.right}
							y={height - 14}
							fill="#6a5a47"
							fontSize="12"
							textAnchor="end"
						>
							{formatChartTimestamp(xMax)}
						</text>
						{renderRangeMarkers({ minKey: "buyMin", maxKey: "buyMax", stroke: "rgba(21, 101, 192, 0.18)" })}
						{renderRangeMarkers({ minKey: "sellMin", maxKey: "sellMax", stroke: "rgba(46, 125, 50, 0.18)" })}
						{buyPolyline && (
							<polyline points={buyPolyline} fill="none" stroke="#1565c0" strokeWidth="3" strokeLinejoin="round" />
						)}
						{sellPolyline && (
							<polyline points={sellPolyline} fill="none" stroke="#2e7d32" strokeWidth="3" strokeLinejoin="round" />
						)}
						{chartPoints.length <= 80 &&
							chartPoints.map((point) => (
								<g key={`${point.time}-${point.buyPrice ?? "x"}-${point.sellPrice ?? "x"}`}>
									{isFiniteNumber(point.buyPrice) && (
										<circle cx={mapX(point.time)} cy={mapY(point.buyPrice)} r="3.5" fill="#1565c0">
											<title>
												{`${formatDateTime(point.observedAt)} buy ${formatCoins(point.buyPrice)}`}
											</title>
										</circle>
									)}
									{isFiniteNumber(point.sellPrice) && (
										<circle cx={mapX(point.time)} cy={mapY(point.sellPrice)} r="3.5" fill="#2e7d32">
											<title>
												{`${formatDateTime(point.observedAt)} sell ${formatCoins(point.sellPrice)}`}
											</title>
										</circle>
									)}
								</g>
							))}
					</svg>
				</Box>
			</Paper>
		</Stack>
	)
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
	const [priceHistory, setPriceHistory] = useState<PriceHistoryResponse | null>(null)
	const [priceHistoryError, setPriceHistoryError] = useState<string | null>(null)
	const [priceHistoryLoading, setPriceHistoryLoading] = useState(false)
	const [priceHistoryRangeDays, setPriceHistoryRangeDays] = useState(7)
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
	const [excludeStalledMarkets, setExcludeStalledMarkets] = useState(true)
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
			excludeStalledMarkets,
			discipline,
			itemNameSearch,
			materialPricing,
			outputPricing,
			watchlistOnly,
		}
	}

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
					exclude_stalled_markets: excludeStalledMarkets,
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
		excludeStalledMarkets,
		excludeSuspiciousSpread,
		limit,
		materialPricing,
		minBuyQuantity,
		minProfit,
		minSellQuantity,
		outputPricing,
	])

	async function loadPriceHistoryForItem(
		itemId: number,
		rangeDays: number,
	): Promise<PriceHistoryResponse | null> {
		try {
			return await fetchPriceHistory(itemId, {
				range_days: rangeDays,
				resolution: "auto",
			})
		} catch (err) {
			if (err instanceof Error) {
				setPriceHistoryError(err.message)
			} else {
				setPriceHistoryError("Unknown error occurred while loading local price history.")
			}

			return null
		}
	}

	async function handleSelectItem(itemId: number) {
		try {
			setDetailLoading(true)
			setDetailError(null)
			setScenarioRows([])
			setListingDepth(null)
			setListingDepthError(null)
			setPriceHistory(null)
			setPriceHistoryError(null)
			setPriceHistoryLoading(true)

			const [detail, scenarios, depth, history] = await Promise.all([
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
				loadPriceHistoryForItem(itemId, priceHistoryRangeDays),
			])
			setSelectedItem(detail)
			setScenarioRows(scenarios)
			setListingDepth(depth)
			setPriceHistory(history)
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
			setPriceHistoryLoading(false)
		}
	}

	async function handlePriceHistoryRangeChange(nextRangeDays: number) {
		setPriceHistoryRangeDays(nextRangeDays)

		if (selectedItem === null) {
			return
		}

		setPriceHistory(null)
		setPriceHistoryError(null)
		setPriceHistoryLoading(true)

		const history = await loadPriceHistoryForItem(selectedItem.item_id, nextRangeDays)
		setPriceHistory(history)
		setPriceHistoryLoading(false)
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
		const selectedItemId = selectedItem?.item_id

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

			if (dataset === "prices" && selectedItemId !== undefined) {
				try {
					setPriceHistory(null)
					setPriceHistoryError(null)
					setPriceHistoryLoading(true)

					const history = await loadPriceHistoryForItem(selectedItemId, priceHistoryRangeDays)
					setPriceHistory(history)
				} finally {
					setPriceHistoryLoading(false)
				}
			}
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
		setExcludeStalledMarkets(settings.excludeStalledMarkets)
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

	function HistoryAvailabilityChip({ hasHistory }: { hasHistory: boolean }) {
		return (
			<Chip
				label={hasHistory ? "Recorded" : "No data"}
				color={hasHistory ? "success" : "default"}
				size="small"
				title={
					hasHistory
						? "This item has local price history snapshots or rollups."
						: "No local price history is stored for this item yet."
				}
				variant={hasHistory ? "filled" : "outlined"}
				sx={{ fontWeight: 700 }}
			/>
		)
	}

	function marketFlowChipColor(
		status: ProfitableCraft["market_flow_status"],
	): "success" | "warning" | "error" | "default" {
		if (status === "moving") {
			return "success"
		}

		if (status === "slow") {
			return "warning"
		}

		if (status === "stalled") {
			return "error"
		}

		return "default"
	}

	function marketFlowLabel(status: ProfitableCraft["market_flow_status"]): string {
		if (status === "moving") {
			return "Moving"
		}

		if (status === "slow") {
			return "Slow"
		}

		if (status === "stalled") {
			return "Stalled"
		}

		return "Unknown"
	}

	function formatMarketFlowScore(value: number | null | undefined): string {
		if (value === null || value === undefined) {
			return "-"
		}

		return `${formatNumber(value)}/100`
	}

	function MarketFlowChip({ row }: { row: ProfitableCraft }) {
		const status = row.market_flow_status ?? "unknown"

		return (
			<Chip
				label={marketFlowLabel(status)}
				color={marketFlowChipColor(status)}
				size="small"
				title={row.market_flow_summary || "No market flow signal available."}
				variant={status === "unknown" ? "outlined" : "filled"}
				sx={{ fontWeight: 750 }}
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
				case "market_flow_score":
					comparison = (a.market_flow_score ?? -Infinity) - (b.market_flow_score ?? -Infinity)
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
		const actionableRows = filteredRows.filter(
			(row) => row.market_flow_status === "moving" || row.market_flow_status === "slow",
		)
		const roiRows = actionableRows.length > 0 ? actionableRows : filteredRows
		const highestActionableRoi = roiRows.reduce<ProfitableCraft | null>((best, row) => {
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

		if (highestActionableRoi !== null) {
			highlights.push({
				label: actionableRows.length > 0 ? "Actionable ROI" : "Highest ROI",
				name: highestActionableRoi.name,
				value: highestActionableRoi.roi ?? 0,
				formattedValue: formatPercent(highestActionableRoi.roi),
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
	}, [loadData])

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
									checked={excludeStalledMarkets}
									onChange={(e) => setExcludeStalledMarkets(e.target.checked)}
								/>
							}
							label="Exclude Stalled Markets"
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
						<Table stickyHeader size="small" sx={{ minWidth: 2100 }}>
							<TableHead>
								<TableRow>
									<SortableHeader label="Name" sortKey="name" sx={stickyNameHeaderSx} />
									<TableCell sx={tableHeaderCellSx}>Watch</TableCell>
									<TableCell sx={tableHeaderCellSx}>History</TableCell>
									<SortableHeader label="Flow" sortKey="market_flow_score" />
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
												<HistoryAvailabilityChip hasHistory={row.has_price_history} />
											</TableCell>
											<TableCell>
												<Stack spacing={0.5}>
													<MarketFlowChip row={row} />
													<Typography variant="caption" color="text.secondary">
														{formatMarketFlowScore(row.market_flow_score)}
													</Typography>
												</Stack>
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
					setPriceHistory(null)
					setPriceHistoryError(null)
					setPriceHistoryLoading(false)
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
								<Box sx={compactMetricSx}>
									<Typography variant="caption" color="text.secondary">Market Flow</Typography>
									<Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
										<MarketFlowChip row={selectedItem} />
										<Typography variant="body2" sx={{ fontWeight: 750 }}>
											{formatMarketFlowScore(selectedItem.market_flow_score)}
										</Typography>
									</Stack>
								</Box>
							</Box>

							<Divider />

							<Box>
								<Stack
									direction={{ xs: "column", sm: "row" }}
									justifyContent="space-between"
									spacing={1.5}
									sx={{ mb: 1.5 }}
								>
									<Box>
										<Typography variant="h6" sx={{ color: "#3d2d1c", fontWeight: 800 }}>
											Price History
										</Typography>
										<Typography variant="body2" color="text.secondary">
											Local snapshots recorded by manual and automatic price sync.
										</Typography>
									</Box>

									<TextField
										label="Range"
										select
										size="small"
										value={priceHistoryRangeDays}
										onChange={(event) => void handlePriceHistoryRangeChange(Number(event.target.value))}
										disabled={priceHistoryLoading}
										sx={{ minWidth: 150 }}
									>
										{priceHistoryRangeOptions.map((rangeDays) => (
											<MenuItem key={rangeDays} value={rangeDays}>
												{rangeDays === 1 ? "1 day" : `${rangeDays} days`}
											</MenuItem>
										))}
									</TextField>
								</Stack>

								{priceHistoryError && (
									<Alert severity="warning" sx={{ mb: 1.5 }}>
										{priceHistoryError}
									</Alert>
								)}

								{priceHistoryLoading && (
									<Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
										<CircularProgress size={24} />
									</Box>
								)}

								{!priceHistoryLoading && priceHistory && (
									<PriceHistoryChart
										history={priceHistory}
										onSyncPrices={() => void handleDataSync("prices")}
										syncDisabled={loading || accountSyncing || syncInProgress !== null}
										syncingPrices={syncInProgress === "prices"}
									/>
								)}
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
