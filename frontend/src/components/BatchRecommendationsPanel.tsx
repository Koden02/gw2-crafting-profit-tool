import { useEffect, useRef, useState } from "react"
import { Alert, Box, Button, CircularProgress, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material"
import { fetchBatchRecommendations, type BatchSearch, type MaterialPricingMode } from "../api/profitableCrafts"
import { goldToCopper } from "../utils/craftRuns"
import { formatCoins, formatDateTime } from "../utils/formatting"
import CraftPlanPanel from "./CraftPlanPanel"
import { CraftRunHistory } from "./CraftRunResults"

export default function BatchRecommendationsPanel({ accountId, accountName }: { accountId: string; accountName: string }) {
    const [budget, setBudget] = useState("10")
    const [inventoryOnly, setInventoryOnly] = useState(true)
    const [minimum, setMinimum] = useState("0.0001")
    const [maximum, setMaximum] = useState("100")
    const [materialPricing, setMaterialPricing] = useState<MaterialPricingMode>("sell")
    const [result, setResult] = useState<BatchSearch | null>(null)
    const [selected, setSelected] = useState<number | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    const request = useRef<AbortController | null>(null)
    useEffect(() => () => request.current?.abort(), [])
    const budgetCopper = goldToCopper(budget)
    const minimumCopper = goldToCopper(minimum)
    const cap = Number(maximum)
    const valid = (inventoryOnly || (budgetCopper !== null && budgetCopper > 0)) && minimumCopper !== null && minimumCopper > 0 && Number.isInteger(cap) && cap >= 1 && cap <= 200
    function invalidate() { request.current?.abort(); setLoading(false); setResult(null); setSelected(null); setError("") }
    async function find() {
        if (!valid || minimumCopper === null) return
        request.current?.abort()
        const controller = new AbortController()
        request.current = controller
        setLoading(true); setError(""); setResult(null); setSelected(null)
        try {
            const data = await fetchBatchRecommendations({ account_id: accountId, budget: inventoryOnly ? undefined : budgetCopper ?? undefined,
                minimum_gain: minimumCopper, max_output: cap, material_pricing: materialPricing, inventory_only: inventoryOnly }, controller.signal)
            if (!controller.signal.aborted) setResult(data)
        } catch (reason) {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Search failed.")
        } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    return <Paper sx={{ my: 2, p: { xs: 2, sm: 3 }, border: "1px solid #b8cbb4", bgcolor: "#f3f7ef" }}>
        <Typography variant="h5" sx={{ color: "#294a2c", fontWeight: 700 }}>Find a profitable crafting batch</Typography>
        <Typography sx={{ mt: 1 }}>Find crafts that earn more than selling the materials you use. Output and owned materials are valued at current instant-sell offers, after fees.</Typography>
        {!accountId ? <Alert severity="info" sx={{ mt: 2 }}>Select an account and use Sync Account Data above to verify crafting access and inventory.</Alert> : <>
            <Typography variant="body2" sx={{ mt: 1 }}>Account: {accountName}. Gain includes Trading Post fees and the resale value of consumed materials.</Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} flexWrap="wrap" useFlexGap sx={{ my: 2 }}>
                <TextField label="Search for" select size="small" value={inventoryOnly ? "inventory" : "budget"} sx={{ minWidth: 240 }}
                    onChange={e => { invalidate(); setInventoryOnly(e.target.value === "inventory"); setMinimum(e.target.value === "inventory" ? "0.0001" : "0.1") }}>
                    <MenuItem value="inventory">Craft from inventory</MenuItem><MenuItem value="budget">Buy missing materials</MenuItem>
                </TextField>
                {!inventoryOnly && <TextField label="Material strategy" select size="small" value={materialPricing} onChange={e => { invalidate(); setMaterialPricing(e.target.value as MaterialPricingMode) }} sx={{ minWidth: 240 }}>
                    <MenuItem value="sell">Buy instantly</MenuItem><MenuItem value="buy">Buy orders + pending purchases</MenuItem>
                </TextField>}
                {!inventoryOnly && <TextField label="Budget (gold)" size="small" value={budget} onChange={e => { invalidate(); setBudget(e.target.value) }} helperText="Includes upfront sale fees" />}
                <TextField label="Minimum total gain (gold)" size="small" value={minimum} onChange={e => { invalidate(); setMinimum(e.target.value) }} helperText={inventoryOnly ? "0.0001 gold = 1 copper above selling materials" : "After valuing owned materials"} />
                <TextField label="Maximum output per batch" size="small" type="number" value={maximum} onChange={e => { invalidate(); setMaximum(e.target.value) }} helperText="1–200 items; whole crafts only" />
                <Button variant="contained" sx={{ alignSelf: "flex-start" }} disabled={!valid || loading} onClick={() => void find()}>Find batches</Button>
            </Stack>
            {inventoryOnly && <Alert severity="info" sx={{ my: 1 }}>Uses synced, unreserved, unbound stock, including materials you can craft into intermediate ingredients. No material purchases or pending orders are used. Sale fees still need gold upfront; collect Trading Post pickups and sync to include them.</Alert>}
            {!inventoryOnly && materialPricing === "buy" && <Alert severity="info" sx={{ my: 1 }}>Sync with Include Trading Post enabled. The budget covers new orders and output listing fees; existing order costs remain part of profit. Orders may take time to fill, and today's output price may change.</Alert>}
            {loading && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={22} /><Typography>Checking crafting access, quantities and live offers…</Typography></Stack>}
            {error && <Alert severity="error">{error}</Alert>}
            {result && <>
                {result.issues.map(issue => <Alert severity="warning" key={issue} sx={{ my: 1 }}>{issue}</Alert>)}
                {result.suggestions.length > 0 && <Alert severity="info" sx={{ my: 1 }}>Each batch is a separate use of your stock. Review one plan and refresh offers before crafting or purchasing; orders can change before you trade.</Alert>}
                <Typography variant="caption">Checked {result.candidates_checked} candidate recipes and {result.quantities_checked} whole-batch quantities. {result.shortlist_truncated ? "A shortlist was checked; other crafts may perform better. " : ""}{result.search_limited ? "The search was limited. " : ""}Current offers: {formatDateTime(result.market_observed_to ?? null)}. Suggestions are not a guaranteed optimum.</Typography>
                {result.suggestions.map(({ plan, quantity_limit_reason }) => <Box key={`${plan.item_id}:${plan.recipe_id}`} sx={{ p: 2, mt: 2, border: "1px solid #c7d4c0", borderRadius: 1, bgcolor: "white" }}>
                    <Typography variant="h6">{plan.planned_quantity} × {plan.name}</Typography>
                    <Typography variant="body2">Craft with {Array.from(new Set(plan.steps.map(step => step.crafter).filter(Boolean))).join(", ")}</Typography>
                    <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ my: 1 }}>
                        {result.inventory_only && <><Typography><strong>Sell materials as-is:</strong> {formatCoins(plan.owned_sale_value)}</Typography>
                            <Typography><strong>Sell crafted output:</strong> {formatCoins(plan.net_revenue)}</Typography></>}
                        <Typography><strong>{result.inventory_only ? "Extra gold from crafting:" : plan.procurement ? "Conditional gain:" : "Expected gain:"}</strong> {formatCoins(plan.economic_gain)}</Typography>
                        <Typography><strong>{result.inventory_only ? "Gold needed for sale fees:" : "New gold needed:"}</strong> {formatCoins(plan.additional_gold_needed)}</Typography>
                        {!result.inventory_only && <Typography><strong>Material outlay:</strong> {formatCoins(plan.purchase_cost)}</Typography>}
                        {plan.procurement && <Typography><strong>Already committed:</strong> {formatCoins(plan.procurement.committed_cost)}</Typography>}
                    </Stack>
                    <Typography variant="body2">{quantity_limit_reason}.</Typography>
                    <Button sx={{ mt: 1 }} onClick={() => setSelected(selected === plan.item_id ? null : plan.item_id)}>{selected === plan.item_id ? "Close plan" : "Review and refresh plan"}</Button>
                    {selected === plan.item_id && plan.recipe_id !== null && <Box sx={{ mt: 2 }}>
                        <CraftPlanPanel key={`${result.observed_at}:${plan.item_id}`} itemId={plan.item_id} itemName={plan.name} recipeId={plan.recipe_id} accountId={accountId} accountName={accountName}
                            materialPricing={result.material_pricing} outputPricing="buy" eligibleOnly inventoryOnly={result.inventory_only}
                            useTradingPost={!result.inventory_only && result.material_pricing === "buy"} initialQuantity={plan.planned_quantity}
                            initialBudget={result.budget === null ? "" : String(result.budget / 10000)} initialCheckDepth />
                    </Box>}
                </Box>)}
            </>}
            <CraftRunHistory key={accountId} accountId={accountId} />
        </>}
    </Paper>
}
