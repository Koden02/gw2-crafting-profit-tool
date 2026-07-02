import { useCallback, useEffect, useState } from "react"
import { Link as RouterLink } from "react-router-dom"
import {
	Alert,
	Box,
	Button,
	Chip,
	CircularProgress,
	Divider,
	MenuItem,
	Paper,
	Stack,
	TextField,
	Tooltip,
	Typography,
} from "@mui/material"

import {
	fetchAutoPriceSyncStatus,
	fetchPriceHistoryConfig,
	fetchPriceHistoryEstimate,
	pauseAutoPriceSync,
	resumeAutoPriceSync,
	updatePriceHistoryConfig,
	type AutoPriceSyncStatus,
	type PriceHistoryConfig,
	type PriceHistoryEstimate,
	type SnapshotItemMode,
} from "../api/profitableCrafts"
import { formatDateTime, formatNumber } from "../utils/formatting"

const accentColor = "#a56f2c"
const warmPanel = "#fffdf8"

const compactMetricSx = {
	border: "1px solid rgba(98, 63, 24, 0.14)",
	borderRadius: 2,
	bgcolor: "rgba(255, 255, 255, 0.72)",
	p: 1.25,
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

function MetricCard({
	description,
	label,
	value,
}: {
	description: string
	label: string
	value: string
}) {
	return (
		<Tooltip arrow title={description}>
			<Box sx={compactMetricSx}>
				<Typography variant="caption" color="text.secondary">
					{label}
				</Typography>
				<Typography sx={{ fontWeight: 750 }}>{value}</Typography>
			</Box>
		</Tooltip>
	)
}

export default function OptionsPage() {
	const [autoPriceSyncStatus, setAutoPriceSyncStatus] = useState<AutoPriceSyncStatus | null>(null)
	const [priceHistoryConfig, setPriceHistoryConfig] = useState<PriceHistoryConfig | null>(null)
	const [priceHistoryEstimate, setPriceHistoryEstimate] = useState<PriceHistoryEstimate | null>(null)
	const [loading, setLoading] = useState(false)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [message, setMessage] = useState<string | null>(null)

	const loadOptions = useCallback(async () => {
		try {
			setLoading(true)
			setError(null)

			const [autoStatus, config, estimate] = await Promise.all([
				fetchAutoPriceSyncStatus(),
				fetchPriceHistoryConfig(),
				fetchPriceHistoryEstimate(),
			])

			setAutoPriceSyncStatus(autoStatus)
			setPriceHistoryConfig(config)
			setPriceHistoryEstimate(estimate)
		} catch (err) {
			if (err instanceof Error) {
				setError(err.message)
			} else {
				setError("Unknown error occurred while loading options.")
			}
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void loadOptions()
	}, [loadOptions])

	async function handleToggleAutoPriceSync() {
		try {
			setSaving(true)
			setError(null)
			setMessage(null)

			const nextStatus = autoPriceSyncStatus?.enabled
				? await pauseAutoPriceSync()
				: await resumeAutoPriceSync()

			setAutoPriceSyncStatus(nextStatus)
			await loadOptions()
			setMessage(nextStatus.enabled ? "Automatic price sync resumed." : "Automatic price sync paused.")
		} catch (err) {
			if (err instanceof Error) {
				setError(err.message)
			} else {
				setError("Unknown error occurred while updating automatic price sync.")
			}
		} finally {
			setSaving(false)
		}
	}

	async function handleSavePriceHistoryConfig() {
		if (priceHistoryConfig === null) {
			return
		}

		try {
			setSaving(true)
			setError(null)
			setMessage(null)

			const savedConfig = await updatePriceHistoryConfig(priceHistoryConfig)
			setPriceHistoryConfig(savedConfig)
			await loadOptions()
			setMessage("Saved price history settings.")
		} catch (err) {
			if (err instanceof Error) {
				setError(err.message)
			} else {
				setError("Unknown error occurred while saving price history settings.")
			}
		} finally {
			setSaving(false)
		}
	}

	function handleNumberSetting(
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

	function handleModeSetting(value: SnapshotItemMode) {
		setPriceHistoryConfig((current) => current === null ? current : { ...current, snapshot_item_mode: value })
	}

	return (
		<Box sx={{ bgcolor: "#f6f1e8", minHeight: "calc(100vh - 69px)", p: 3 }}>
			<Stack spacing={3}>
				<Box>
					<Typography variant="h4" gutterBottom sx={{ color: "#2f261b", fontWeight: 800 }}>
						Options
					</Typography>
					<Typography variant="body1" color="text.secondary">
						Automatic Trading Post price sync, local history retention, and storage controls.
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
									Server-owned price refresh and local history capture.
								</Typography>
							</Box>

							<Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
								<Tooltip arrow title="Shows whether the backend timer is allowed to run automatic price refreshes.">
									<Chip
										label={autoPriceSyncStatus?.enabled ? "Auto Sync On" : "Paused"}
										color={autoPriceSyncStatus?.enabled ? "success" : "default"}
										size="small"
										sx={{ fontWeight: 800 }}
									/>
								</Tooltip>
								<Tooltip arrow title="Shows whether any price sync is running right now, including manual syncs.">
									<Chip
										label={autoPriceSyncStatus?.running ? "Running" : "Idle"}
										color={autoPriceSyncStatus?.running ? "warning" : "default"}
										size="small"
										variant="outlined"
										sx={{ fontWeight: 800 }}
									/>
								</Tooltip>
								<Button
									variant={autoPriceSyncStatus?.enabled ? "outlined" : "contained"}
									disabled={saving || loading}
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
									{saving ? (
										<Stack direction="row" spacing={1} alignItems="center">
											<CircularProgress color="inherit" size={16} />
											<span>Saving</span>
										</Stack>
									) : autoPriceSyncStatus?.enabled ? (
										"Pause Auto Sync"
									) : (
										"Resume Auto Sync"
									)}
								</Button>
								<Button
									variant="outlined"
									disabled={saving || loading}
									onClick={() => void loadOptions()}
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
									Refresh
								</Button>
							</Stack>
						</Stack>

						<Stack
							direction={{ xs: "column", sm: "row" }}
							spacing={1}
							sx={{ color: "text.secondary" }}
						>
							<Tooltip arrow title="Most recent completed Trading Post price cache update.">
								<Typography variant="caption">
									Last price sync: {formatDateTime(autoPriceSyncStatus?.last_price_sync_at)}
								</Typography>
							</Tooltip>
							<Tooltip arrow title="Most recent local history snapshot written after a price sync.">
								<Typography variant="caption">
									Last snapshot: {formatDateTime(autoPriceSyncStatus?.last_snapshot_at)}
								</Typography>
							</Tooltip>
							<Tooltip arrow title="Earliest time the backend will start the next automatic price sync.">
								<Typography variant="caption">
									Next eligible sync: {formatDateTime(autoPriceSyncStatus?.next_due_at)}
								</Typography>
							</Tooltip>
						</Stack>

						{autoPriceSyncStatus?.last_error && <Alert severity="error">{autoPriceSyncStatus.last_error}</Alert>}
						{error && <Alert severity="error">{error}</Alert>}
						{message && <Alert severity="success">{message}</Alert>}

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
								<MetricCard
									label="Tracked Items"
									value={formatNumber(priceHistoryEstimate.tracked_item_count)}
									description="Number of priced items that will be saved into future raw snapshots after relevance and ignore rules are applied."
								/>
								<MetricCard
									label="Ignored Items"
									value={formatNumber(priceHistoryEstimate.ignored_item_count)}
									description="Number of items excluded from future history snapshots until restored on the Tracked Items page."
								/>
								<MetricCard
									label="Raw Data / Day"
									value={formatStorageMegabytes(priceHistoryEstimate.estimated_raw_mb_per_day)}
									description="Estimated disk growth per day from full-resolution snapshots before retention pruning and rollups."
								/>
								<MetricCard
									label="Retention Estimate"
									value={formatStorageMegabytes(priceHistoryEstimate.estimated_total_retention_mb)}
									description="Estimated total history storage under the current raw, hourly, and daily retention settings."
								/>
								<MetricCard
									label="Current History"
									value={formatStorageMegabytes(priceHistoryEstimate.current_history_estimated_mb)}
									description="Estimated storage currently used by raw snapshot and rollup rows."
								/>
								<MetricCard
									label="Database File"
									value={formatStorageMegabytes(priceHistoryEstimate.database_file_mb)}
									description="Current SQLite database file size, including items, recipes, latest prices, account holdings, and history."
								/>
							</Box>
						)}

						<Divider />

						{priceHistoryConfig && (
							<Stack spacing={1.5}>
								<Stack direction={{ xs: "column", lg: "row" }} spacing={1.5} flexWrap="wrap" useFlexGap>
									<Tooltip arrow title="Minutes between backend automatic price-sync attempts. Manual price sync remains available.">
										<TextField
											label="Sync Interval (min)"
											type="number"
											value={priceHistoryConfig.price_sync_interval_minutes}
											onChange={(e) => handleNumberSetting("price_sync_interval_minutes", Number(e.target.value))}
											size="small"
											sx={{ width: 170 }}
										/>
									</Tooltip>
									<Tooltip arrow title="Days to keep full-resolution snapshots before they are rolled up and pruned.">
										<TextField
											label="Raw Retention (days)"
											type="number"
											value={priceHistoryConfig.raw_snapshot_retention_days}
											onChange={(e) => handleNumberSetting("raw_snapshot_retention_days", Number(e.target.value))}
											size="small"
											sx={{ width: 180 }}
										/>
									</Tooltip>
									<Tooltip arrow title="Days to keep hourly summarized history after raw snapshots age out.">
										<TextField
											label="Hourly Rollups (days)"
											type="number"
											value={priceHistoryConfig.hourly_rollup_retention_days}
											onChange={(e) => handleNumberSetting("hourly_rollup_retention_days", Number(e.target.value))}
											size="small"
											sx={{ width: 190 }}
										/>
									</Tooltip>
									<Tooltip arrow title="Days to keep daily summarized history for long-range trend checks.">
										<TextField
											label="Daily Rollups (days)"
											type="number"
											value={priceHistoryConfig.daily_rollup_retention_days}
											onChange={(e) => handleNumberSetting("daily_rollup_retention_days", Number(e.target.value))}
											size="small"
											sx={{ width: 185 }}
										/>
									</Tooltip>
									<Tooltip arrow title="Maximum estimated storage for history tables. Oldest history rows are pruned when this limit is exceeded.">
										<TextField
											label="Max History (MB)"
											type="number"
											value={priceHistoryConfig.max_history_mb}
											onChange={(e) => handleNumberSetting("max_history_mb", Number(e.target.value))}
											size="small"
											sx={{ width: 170 }}
										/>
									</Tooltip>
									<Tooltip arrow title="Relevant Only records craft outputs and recipe ingredients. All Priced Items records every Trading Post item except ignored items.">
										<TextField
											select
											label="Snapshot Items"
											value={priceHistoryConfig.snapshot_item_mode}
											onChange={(e) => handleModeSetting(e.target.value as SnapshotItemMode)}
											size="small"
											sx={{ minWidth: 180 }}
										>
											<MenuItem value="relevant">Relevant Only</MenuItem>
											<MenuItem value="all">All Priced Items</MenuItem>
										</TextField>
									</Tooltip>
								</Stack>

								<Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
									<Button
										variant="contained"
										disabled={saving || loading}
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
									<Button
										component={RouterLink}
										to="/tracked-items"
										variant="outlined"
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
										Review Tracked Items
									</Button>
								</Stack>
							</Stack>
						)}
					</Stack>
				</Paper>
			</Stack>
		</Box>
	)
}
