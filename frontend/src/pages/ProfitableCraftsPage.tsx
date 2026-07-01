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
	fetchProfitDetail,
	fetchProfitScenarios,
	fetchProfitableCrafts,
	fetchSyncStatus,
	syncCommercePrices,
	syncItems,
	syncRecipes,
	type MaterialPricingMode,
	type OutputPricingMode,
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

export default function ProfitableCraftsPage() {
	const [rows, setRows] = useState<ProfitableCraft[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
	const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)
	const [syncStatusCheckedAt, setSyncStatusCheckedAt] = useState<Date | null>(null)
	const [syncInProgress, setSyncInProgress] = useState<SyncDataset | null>(null)
	const [syncError, setSyncError] = useState<string | null>(null)
	const [syncMessage, setSyncMessage] = useState<string | null>(null)

	const [selectedItem, setSelectedItem] = useState<ProfitableCraft | null>(null)
	const [scenarioRows, setScenarioRows] = useState<ProfitScenario[]>([])
	const [detailLoading, setDetailLoading] = useState(false)
	const [detailError, setDetailError] = useState<string | null>(null)

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

	const loadData = useCallback(async () => {
		try {
			setLoading(true)
			setError(null)

			const [data, status] = await Promise.all([
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
			])

			setRows(data)
			setSyncStatus(status)
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

			const [detail, scenarios] = await Promise.all([
				fetchProfitDetail(itemId, {
					material_pricing: materialPricing,
					output_pricing: outputPricing,
				}),
				fetchProfitScenarios(itemId),
			])
			setSelectedItem(detail)
			setScenarioRows(scenarios)
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
				setSyncMessage(`Synced ${formatNumber(result.prices_upserted)} Trading Post price rows.`)
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

	function SyncButton({ dataset, label }: { dataset: SyncDataset; label: string }) {
		const isActive = syncInProgress === dataset

		return (
			<Button
				variant={dataset === "prices" ? "contained" : "outlined"}
				disabled={loading || syncInProgress !== null}
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

		if (!normalizedSearch) {
			return rows
		}

		return rows.filter((row) => row.name.toLowerCase().includes(normalizedSearch))
	}, [itemNameSearch, rows])

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
							disabled={loading || syncInProgress !== null}
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
						</Stack>
					</Stack>
				</Paper>

				{priceDataWarning && <Alert severity="warning">{priceDataWarning}</Alert>}

				{syncError && <Alert severity="error">{syncError}</Alert>}

				{syncMessage && <Alert severity="success">{syncMessage}</Alert>}

				{loading && (
					<Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
						<CircularProgress />
					</Box>
				)}

				{error && <Alert severity="error">{error}</Alert>}

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
						<Table stickyHeader size="small" sx={{ minWidth: 1400 }}>
							<TableHead>
								<TableRow>
									<SortableHeader label="Name" sortKey="name" sx={stickyNameHeaderSx} />
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
								{sortedRows.map((row) => (
									<TableRow
										key={row.item_id}
										hover
										onClick={() => void handleSelectItem(row.item_id)}
										sx={{ ...zebraRowSx, cursor: "pointer" }}
									>
										<TableCell sx={stickyNameCellSx}>{row.name}</TableCell>
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
								))}
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
							<Box>
								<Typography variant="h5" sx={{ color: "#2f261b", fontWeight: 850 }}>
									{selectedItem.name}
								</Typography>
								<Typography variant="body2" color="text.secondary">
									{selectedItem.disciplines.join(", ")}
								</Typography>
							</Box>

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
