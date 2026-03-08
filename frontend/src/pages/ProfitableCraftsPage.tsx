import { useEffect, useState } from "react"
import {
	Alert,
	Box,
	Button,
	Checkbox,
	CircularProgress,
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
	fetchProfitableCrafts,
	type ProfitableCraft,
} from "../api/profitableCrafts"

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

export default function ProfitableCraftsPage() {
	const [rows, setRows] = useState<ProfitableCraft[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const [limit, setLimit] = useState(50)
	const [minProfit, setMinProfit] = useState(0)
	const [minBuyQuantity, setMinBuyQuantity] = useState(5)
	const [minSellQuantity, setMinSellQuantity] = useState(5)
	const [excludeLowLiquidity, setExcludeLowLiquidity] = useState(true)
	const [excludeSuspiciousSpread, setExcludeSuspiciousSpread] = useState(true)
	const [discipline, setDiscipline] = useState("")

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
									<TableCell>Name</TableCell>
									<TableCell>Disciplines</TableCell>
									<TableCell align="right">Craft Cost</TableCell>
									<TableCell align="right">Sell Price</TableCell>
									<TableCell align="right">Net Sale</TableCell>
									<TableCell align="right">Profit</TableCell>
									<TableCell align="right">ROI</TableCell>
									<TableCell align="right">Buy Qty</TableCell>
									<TableCell align="right">Sell Qty</TableCell>
								</TableRow>
							</TableHead>
							<TableBody>
								{rows.map((row) => (
									<TableRow key={row.item_id}>
										<TableCell>{row.name}</TableCell>
										<TableCell>{row.disciplines.join(", ")}</TableCell>
										<TableCell align="right">{row.craft_cost.toLocaleString()}</TableCell>
										<TableCell align="right">{row.sell_price.toLocaleString()}</TableCell>
										<TableCell align="right">{row.net_sale.toLocaleString()}</TableCell>
										<TableCell align="right">{row.profit.toLocaleString()}</TableCell>
										<TableCell align="right">
											{row.roi !== null ? row.roi.toFixed(4) : "-"}
										</TableCell>
										<TableCell align="right">{row.buy_quantity.toLocaleString()}</TableCell>
										<TableCell align="right">{row.sell_quantity.toLocaleString()}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableContainer>
				)}
			</Stack>
		</Box>
	)
}