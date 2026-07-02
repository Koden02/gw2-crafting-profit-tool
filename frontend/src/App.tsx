import { BrowserRouter, Link as RouterLink, Route, Routes, useLocation } from "react-router-dom"
import { Box, Button, Stack, Typography } from "@mui/material"

import OptionsPage from "./pages/OptionsPage"
import ProfitableCraftsPage from "./pages/ProfitableCraftsPage"
import TrackedItemsPage from "./pages/TrackedItemsPage"

const navItems = [
	{ label: "Crafts", path: "/" },
	{ label: "Options", path: "/options" },
	{ label: "Tracked Items", path: "/tracked-items" },
]

function AppShell() {
	const location = useLocation()

	return (
		<Box sx={{ bgcolor: "#f6f1e8", minHeight: "100vh" }}>
			<Box
				component="nav"
				sx={{
					bgcolor: "#fffdf8",
					borderBottom: "1px solid rgba(98, 63, 24, 0.16)",
					px: 3,
					py: 1.5,
				}}
			>
				<Stack
					direction={{ xs: "column", sm: "row" }}
					spacing={1.5}
					alignItems={{ sm: "center" }}
					justifyContent="space-between"
				>
					<Typography variant="h6" sx={{ color: "#2f261b", fontWeight: 850 }}>
						GW2 Profit
					</Typography>

					<Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
						{navItems.map((item) => {
							const isActive = location.pathname === item.path

							return (
								<Button
									key={item.path}
									component={RouterLink}
									to={item.path}
									variant={isActive ? "contained" : "outlined"}
									sx={{
										bgcolor: isActive ? "#a56f2c" : "transparent",
										borderColor: "#a56f2c",
										color: isActive ? "#fff" : "#a56f2c",
										minHeight: 36,
										"&:hover": {
											bgcolor: isActive ? "#8d5e25" : "rgba(165, 111, 44, 0.08)",
											borderColor: "#8d5e25",
										},
									}}
								>
									{item.label}
								</Button>
							)
						})}
					</Stack>
				</Stack>
			</Box>

			<Routes>
				<Route path="/" element={<ProfitableCraftsPage />} />
				<Route path="/options" element={<OptionsPage />} />
				<Route path="/tracked-items" element={<TrackedItemsPage />} />
			</Routes>
		</Box>
	)
}

function App() {
	return (
		<BrowserRouter>
			<AppShell />
		</BrowserRouter>
	)
}

export default App
