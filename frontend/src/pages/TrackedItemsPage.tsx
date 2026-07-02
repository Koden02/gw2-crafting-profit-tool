import { useCallback, useEffect, useState } from "react"
import {
	Alert,
	Box,
	Button,
	Chip,
	CircularProgress,
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
	fetchPriceHistoryEstimate,
	fetchPriceHistoryRelevance,
	ignorePriceHistoryItem,
	restorePriceHistoryItem,
	type PriceHistoryEstimate,
	type PriceHistoryRelevanceFilter,
	type PriceHistoryRelevanceItem,
} from "../api/profitableCrafts"
import { formatNumber } from "../utils/formatting"

const accentColor = "#a56f2c"
const warmPanel = "#fffdf8"
const tableHeaderBackground = "#f1e2cb"
const tableStripeBackground = "rgba(165, 111, 44, 0.055)"
const tableHoverBackground = "rgba(165, 111, 44, 0.14)"

const tableHeaderCellSx = {
	bgcolor: tableHeaderBackground,
	color: "#352515",
	fontWeight: 800,
	borderBottom: "1px solid rgba(98, 63, 24, 0.24)",
	whiteSpace: "nowrap",
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

export default function TrackedItemsPage() {
	const [estimate, setEstimate] = useState<PriceHistoryEstimate | null>(null)
	const [items, setItems] = useState<PriceHistoryRelevanceItem[]>([])
	const [total, setTotal] = useState(0)
	const [search, setSearch] = useState("")
	const [filter, setFilter] = useState<PriceHistoryRelevanceFilter>("relevant")
	const [loading, setLoading] = useState(false)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [message, setMessage] = useState<string | null>(null)

	const loadItems = useCallback(async () => {
		try {
			setLoading(true)
			setError(null)

			const [nextEstimate, relevance] = await Promise.all([
				fetchPriceHistoryEstimate(),
				fetchPriceHistoryRelevance({
					search,
					filter,
					limit: 100,
				}),
			])

			setEstimate(nextEstimate)
			setItems(relevance.items)
			setTotal(relevance.total)
		} catch (err) {
			if (err instanceof Error) {
				setError(err.message)
			} else {
				setError("Unknown error occurred while loading tracked items.")
			}
		} finally {
			setLoading(false)
		}
	}, [filter, search])

	useEffect(() => {
		void loadItems()
	}, [loadItems])

	async function handleToggleIgnore(item: PriceHistoryRelevanceItem) {
		try {
			setSaving(true)
			setError(null)
			setMessage(null)

			if (item.is_ignored) {
				await restorePriceHistoryItem(item.item_id)
				setMessage(`Restored ${item.name} to price history tracking.`)
			} else {
				await ignorePriceHistoryItem(item.item_id)
				setMessage(`Ignored ${item.name} for future price history snapshots.`)
			}

			await loadItems()
		} catch (err) {
			if (err instanceof Error) {
				setError(err.message)
			} else {
				setError("Unknown error occurred while updating tracked items.")
			}
		} finally {
			setSaving(false)
		}
	}

	return (
		<Box sx={{ bgcolor: "#f6f1e8", minHeight: "calc(100vh - 69px)", p: 3 }}>
			<Stack spacing={3}>
				<Box>
					<Typography variant="h4" gutterBottom sx={{ color: "#2f261b", fontWeight: 800 }}>
						Tracked Items
					</Typography>
					<Typography variant="body1" color="text.secondary">
						Review which items are recorded in local price history and exclude items you do not care about.
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
						{error && <Alert severity="error">{error}</Alert>}
						{message && <Alert severity="success">{message}</Alert>}

						{estimate && (
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
									<Typography variant="caption" color="text.secondary">Tracked Items</Typography>
									<Typography sx={{ fontWeight: 750 }}>{formatNumber(estimate.tracked_item_count)}</Typography>
								</Box>
								<Box sx={compactMetricSx}>
									<Typography variant="caption" color="text.secondary">Relevant Items</Typography>
									<Typography sx={{ fontWeight: 750 }}>{formatNumber(estimate.relevant_price_item_count)}</Typography>
								</Box>
								<Box sx={compactMetricSx}>
									<Typography variant="caption" color="text.secondary">Ignored Items</Typography>
									<Typography sx={{ fontWeight: 750 }}>{formatNumber(estimate.ignored_item_count)}</Typography>
								</Box>
								<Box sx={compactMetricSx}>
									<Typography variant="caption" color="text.secondary">Priced Items</Typography>
									<Typography sx={{ fontWeight: 750 }}>{formatNumber(estimate.price_count)}</Typography>
								</Box>
							</Box>
						)}

						<Stack
							direction={{ xs: "column", md: "row" }}
							justifyContent="space-between"
							spacing={1.25}
						>
							<Box>
								<Typography variant="subtitle2" sx={{ color: "#5a3d1f", fontWeight: 800 }}>
									Item Review
								</Typography>
								<Typography variant="body2" color="text.secondary">
									Showing {formatNumber(items.length)} of {formatNumber(total)} matching items.
								</Typography>
							</Box>
							<Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
								<TextField
									label="Search Items"
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									size="small"
									sx={{ minWidth: 220 }}
								/>
								<TextField
									select
									label="Review Filter"
									value={filter}
									onChange={(e) => setFilter(e.target.value as PriceHistoryRelevanceFilter)}
									size="small"
									sx={{ minWidth: 160 }}
								>
									<MenuItem value="relevant">Relevant</MenuItem>
									<MenuItem value="ignored">Ignored</MenuItem>
									<MenuItem value="untracked">Untracked</MenuItem>
									<MenuItem value="all">All</MenuItem>
								</TextField>
								<Button
									variant="outlined"
									disabled={loading || saving}
									onClick={() => void loadItems()}
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
									{loading ? (
										<Stack direction="row" spacing={1} alignItems="center">
											<CircularProgress color="inherit" size={16} />
											<span>Loading</span>
										</Stack>
									) : (
										"Refresh"
									)}
								</Button>
							</Stack>
						</Stack>

						<TableContainer
							component={Box}
							sx={{
								border: "1px solid rgba(98, 63, 24, 0.14)",
								borderRadius: 2,
								maxHeight: "calc(100vh - 390px)",
								overflow: "auto",
							}}
						>
							<Table stickyHeader size="small" sx={{ minWidth: 780 }}>
								<TableHead>
									<TableRow>
										<TableCell sx={tableHeaderCellSx}>Item</TableCell>
										<TableCell sx={tableHeaderCellSx}>Why</TableCell>
										<TableCell sx={tableHeaderCellSx}>History Status</TableCell>
										<TableCell align="right" sx={tableHeaderCellSx}>Action</TableCell>
									</TableRow>
								</TableHead>
								<TableBody>
									{items.map((item) => (
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
													{!item.has_price && <Chip label="No TP Price" size="small" variant="outlined" />}
												</Stack>
											</TableCell>
											<TableCell align="right">
												<Button
													size="small"
													variant={item.is_ignored ? "contained" : "outlined"}
													disabled={saving}
													onClick={() => void handleToggleIgnore(item)}
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
									{items.length === 0 && (
										<TableRow>
											<TableCell colSpan={4}>
												<Typography variant="body2" color="text.secondary">
													{loading ? "Loading tracked item review." : "No items match the current review filter."}
												</Typography>
											</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
						</TableContainer>
					</Stack>
				</Paper>
			</Stack>
		</Box>
	)
}
