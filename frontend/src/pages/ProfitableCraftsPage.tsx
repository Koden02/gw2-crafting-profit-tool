import { useEffect, useMemo, useState } from "react"
import {
	Alert,
	Box,
	Button,
	Checkbox,
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
	TextField,
	Typography,
} from "@mui/material"

import {
	fetchProfitDetail,
	fetchProfitableCrafts,
	type MaterialPricingMode,
	type OutputPricingMode,
	type ProfitableCraft,
} from "../api/profitableCrafts"
import { formatCoins, formatNumber, formatPercent } from "../utils/formatting"

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

type SortKey =
	| "name"
	| "craft_cost"
	| "sell_price"
	| "net_sale"
	| "profit"
	| "roi"
	| "buy_quantity"
	| "sell_quantity"

type SortDirection = "asc" | "desc"

export default function ProfitableCraftsPage() {
	const [rows, setRows] = useState<ProfitableCraft[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const [selectedItem, setSelectedItem] = useState<ProfitableCraft | null>(null)
	const [detailLoading, setDetailLoading] = useState(false)
	const [detailError, setDetailError] = useState<string | null>(null)

	const [limit, setLimit] = useState(50)
	const [minProfit, setMinProfit] = useState(0)
	const [minBuyQuantity, setMinBuyQuantity] = useState(5)
	const [minSellQuantity, setMinSellQuantity] = useState(5)
	const [excludeLowLiquidity, setExcludeLowLiquidity] = useState(true)
	const [excludeSuspiciousSpread, setExcludeSuspiciousSpread] = useState(true)
	const [discipline, setDiscipline] = useState("")

	const [sortKey, setSortKey] = useState<SortKey>("profit")
	const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

    const [materialPricing, setMaterialPricing] = useState<MaterialPricingMode>("buy")
    const [outputPricing, setOutputPricing] = useState<OutputPricingMode>("sell")

	async function loadData() {
		try {
			setLoading(true)
			setError(null)

			const data = await fetchProfitableCrafts({
				limit,
				min_profit: minProfit,
				min_buy_quantity: minBuyQuantity,
				min_sell_quantity: minSellQuantity,
				exclude_low_liquidity: excludeLowLiquidity,
				exclude_suspicious_spread: excludeSuspiciousSpread,
				discipline: discipline || undefined,
                material_pricing: materialPricing,
                output_pricing: outputPricing,
			})

			setRows(data)
		} catch (err) {
			if (err instanceof Error) {
				setError(err.message)
			} else {
				setError("Unknown error occurred.")
			}
		} finally {
			setLoading(false)
		}
	}

	async function handleSelectItem(itemId: number) {
		try {
			setDetailLoading(true)
			setDetailError(null)

			const detail = await fetchProfitDetail(itemId, {
                material_pricing: materialPricing,
                output_pricing: outputPricing,
            })
			setSelectedItem(detail)
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

	const sortedRows = useMemo(() => {
		const copied = [...rows]

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
	}, [rows, sortDirection, sortKey])

	function sortLabel(label: string, key: SortKey): string {
		if (sortKey !== key) {
			return label
		}

		return `${label} ${sortDirection === "asc" ? "▲" : "▼"}`
	}

	useEffect(() => {
		void loadData()
	}, [])

	return (
		<Box sx={{ p: 3 }}>
			<Stack spacing={3}>
				<Box>
					<Typography variant="h4" gutterBottom>
						Profitable Crafts
					</Typography>
					<Typography variant="body1" color="text.secondary">
						Explore profitable Guild Wars 2 crafting opportunities using live Trading Post data.
					</Typography>
				</Box>

				<Paper sx={{ p: 2 }}>
					<Stack direction={{ xs: "column", md: "row" }} spacing={2} flexWrap="wrap">
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
                        
						<Button variant="contained" onClick={() => void loadData()}>
							Refresh
						</Button>
					</Stack>
				</Paper>

				{loading && (
					<Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
						<CircularProgress />
					</Box>
				)}

				{error && <Alert severity="error">{error}</Alert>}

				{!loading && !error && (
					<TableContainer component={Paper}>
						<Table size="small">
							<TableHead>
								<TableRow>
									<TableCell
										onClick={() => handleSort("name")}
										sx={{ cursor: "pointer", userSelect: "none" }}
									>
										{sortLabel("Name", "name")}
									</TableCell>
									<TableCell>Disciplines</TableCell>
									<TableCell
										align="right"
										onClick={() => handleSort("craft_cost")}
										sx={{ cursor: "pointer", userSelect: "none" }}
									>
										{sortLabel("Craft Cost", "craft_cost")}
									</TableCell>
									<TableCell
										align="right"
										onClick={() => handleSort("sell_price")}
										sx={{ cursor: "pointer", userSelect: "none" }}
									>
										{sortLabel("Sell Price", "sell_price")}
									</TableCell>
									<TableCell
										align="right"
										onClick={() => handleSort("net_sale")}
										sx={{ cursor: "pointer", userSelect: "none" }}
									>
										{sortLabel("Net Sale", "net_sale")}
									</TableCell>
									<TableCell
										align="right"
										onClick={() => handleSort("profit")}
										sx={{ cursor: "pointer", userSelect: "none" }}
									>
										{sortLabel("Profit", "profit")}
									</TableCell>
									<TableCell
										align="right"
										onClick={() => handleSort("roi")}
										sx={{ cursor: "pointer", userSelect: "none" }}
									>
										{sortLabel("ROI", "roi")}
									</TableCell>
									<TableCell
										align="right"
										onClick={() => handleSort("buy_quantity")}
										sx={{ cursor: "pointer", userSelect: "none" }}
									>
										{sortLabel("Buy Qty", "buy_quantity")}
									</TableCell>
									<TableCell
										align="right"
										onClick={() => handleSort("sell_quantity")}
										sx={{ cursor: "pointer", userSelect: "none" }}
									>
										{sortLabel("Sell Qty", "sell_quantity")}
									</TableCell>
								</TableRow>
							</TableHead>
							<TableBody>
								{sortedRows.map((row) => (
									<TableRow
										key={row.item_id}
										hover
										onClick={() => void handleSelectItem(row.item_id)}
										sx={{ cursor: "pointer" }}
									>
										<TableCell>{row.name}</TableCell>
										<TableCell>{row.disciplines.join(", ")}</TableCell>
										<TableCell align="right">{formatCoins(row.craft_cost)}</TableCell>
										<TableCell align="right">{formatCoins(row.sell_price)}</TableCell>
										<TableCell align="right">{formatCoins(row.net_sale)}</TableCell>
										<TableCell align="right">{formatCoins(row.profit)}</TableCell>
										<TableCell align="right">{formatPercent(row.roi)}</TableCell>
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
					setDetailError(null)
				}}
				PaperProps={{
					sx: {
						width: "min(900px, 90vw)",
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
						<Stack spacing={2}>
							<Box>
								<Typography variant="h5">{selectedItem.name}</Typography>
								<Typography variant="body2" color="text.secondary">
									{selectedItem.disciplines.join(", ")}
								</Typography>
							</Box>

							<Divider />

							<Stack spacing={1}>
								<Typography><strong>Craft Cost:</strong> {formatCoins(selectedItem.craft_cost)}</Typography>
								<Typography><strong>Sell Price:</strong> {formatCoins(selectedItem.sell_price)}</Typography>
								<Typography><strong>Net Sale:</strong> {formatCoins(selectedItem.net_sale)}</Typography>
								<Typography><strong>Profit:</strong> {formatCoins(selectedItem.profit)}</Typography>
								<Typography><strong>ROI:</strong> {formatPercent(selectedItem.roi)}</Typography>
								<Typography><strong>Buy Quantity:</strong> {formatNumber(selectedItem.buy_quantity)}</Typography>
								<Typography><strong>Sell Quantity:</strong> {formatNumber(selectedItem.sell_quantity)}</Typography>
							</Stack>

							<Divider />

							<Box>
								<Typography variant="h6" gutterBottom>
									Ingredients
								</Typography>

								<TableContainer component={Paper} variant="outlined">
									<Table size="small">
										<TableHead>
											<TableRow>
												<TableCell>Name</TableCell>
												<TableCell align="right">Count</TableCell>
												<TableCell align="right">Buy Price</TableCell>
												<TableCell align="right">Craft Price</TableCell>
												<TableCell>Source</TableCell>
												<TableCell align="right">Chosen Unit</TableCell>
												<TableCell align="right">Total</TableCell>
											</TableRow>
										</TableHead>
										<TableBody>
											{selectedItem.ingredients?.map((ingredient) => (
												<TableRow key={ingredient.item_id}>
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