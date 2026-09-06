import { useEffect, useRef, useState } from "react"
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from "@mui/material"
import { fetchBatchRecommendations, type BatchSearch } from "../api/profitableCrafts"
import { goldToCopper } from "../utils/craftRuns"
import { formatCoins, formatDateTime } from "../utils/formatting"
import CraftPlanPanel from "./CraftPlanPanel"
import { CraftRunHistory } from "./CraftRunResults"

export default function BatchRecommendationsPanel({ accountId, accountName }: { accountId: string; accountName: string }) {
    const [budget, setBudget] = useState("10")
    const [minimum, setMinimum] = useState("0.1")
    const [maximum, setMaximum] = useState("100")
    const [result, setResult] = useState<BatchSearch | null>(null)
    const [selected, setSelected] = useState<number | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    const request = useRef<AbortController | null>(null)
    useEffect(() => () => request.current?.abort(), [])
    const budgetCopper = goldToCopper(budget)
    const minimumCopper = goldToCopper(minimum)
    const cap = Number(maximum)
    const valid = budgetCopper !== null && budgetCopper > 0 && minimumCopper !== null && minimumCopper > 0 && Number.isInteger(cap) && cap >= 1 && cap <= 200
    function invalidate() { request.current?.abort(); setLoading(false); setResult(null); setSelected(null); setError("") }
    async function find() {
        if (!valid || budgetCopper === null || minimumCopper === null) return
        request.current?.abort()
        const controller = new AbortController()
        request.current = controller
        setLoading(true); setError(""); setResult(null); setSelected(null)
        try {
            const data = await fetchBatchRecommendations({ account_id: accountId, budget: budgetCopper, minimum_gain: minimumCopper, max_output: cap }, controller.signal)
            if (!controller.signal.aborted) setResult(data)
        } catch (reason) {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Search failed.")
        } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    return <Paper sx={{ my: 2, p: { xs: 2, sm: 3 }, border: "1px solid #b8cbb4", bgcolor: "#f3f7ef" }}>
        <Typography variant="h5" sx={{ color: "#294a2c", fontWeight: 700 }}>Find a profitable crafting batch</Typography>
        <Typography sx={{ mt: 1 }}>Choose a gold budget. Compare small batches your account can craft, using current instant-buy and instant-sell offers.</Typography>
        {!accountId ? <Alert severity="info" sx={{ mt: 2 }}>Select an account and use Sync Account Data above to verify crafting access and inventory.</Alert> : <>
            <Typography variant="body2" sx={{ mt: 1 }}>Account: {accountName}. Gain includes Trading Post fees and the resale value of consumed materials.</Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} flexWrap="wrap" useFlexGap sx={{ my: 2 }}>
                <TextField label="Budget (gold)" size="small" value={budget} onChange={e => { invalidate(); setBudget(e.target.value) }} helperText="Includes upfront sale fees" />
                <TextField label="Minimum total gain (gold)" size="small" value={minimum} onChange={e => { invalidate(); setMinimum(e.target.value) }} helperText="After valuing owned materials" />
                <TextField label="Maximum output per batch" size="small" type="number" value={maximum} onChange={e => { invalidate(); setMaximum(e.target.value) }} helperText="1–200 items; whole crafts only" />
                <Button variant="contained" sx={{ alignSelf: "flex-start" }} disabled={!valid || loading} onClick={() => void find()}>Find batches</Button>
            </Stack>
            {loading && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={22} /><Typography>Checking crafting access, quantities and live offers…</Typography></Stack>}
            {error && <Alert severity="error">{error}</Alert>}
            {result && <>
                {result.issues.map(issue => <Alert severity="warning" key={issue} sx={{ my: 1 }}>{issue}</Alert>)}
                {result.suggestions.length > 0 && <Alert severity="info" sx={{ my: 1 }}>Each batch is a separate use of your budget and stock. Review one plan and refresh offers before purchasing; orders can change before you trade.</Alert>}
                <Typography variant="caption">Checked {result.candidates_checked} candidate recipes and {result.quantities_checked} whole-batch quantities. {result.shortlist_truncated ? "A shortlist was checked; other crafts may perform better. " : ""}{result.search_limited ? "The search was limited. " : ""}Current offers: {formatDateTime(result.market_observed_to ?? null)}. Suggestions are not a guaranteed optimum.</Typography>
                {result.suggestions.map(({ plan, quantity_limit_reason }) => <Box key={`${plan.item_id}:${plan.recipe_id}`} sx={{ p: 2, mt: 2, border: "1px solid #c7d4c0", borderRadius: 1, bgcolor: "white" }}>
                    <Typography variant="h6">{plan.planned_quantity} × {plan.name}</Typography>
                    <Typography variant="body2">Craft with {Array.from(new Set(plan.steps.map(step => step.crafter).filter(Boolean))).join(", ")}</Typography>
                    <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ my: 1 }}>
                        <Typography><strong>Expected gain:</strong> {formatCoins(plan.economic_gain)}</Typography>
                        <Typography><strong>Upfront gold:</strong> {formatCoins(plan.additional_gold_needed)}</Typography>
                        <Typography><strong>Buy materials:</strong> {formatCoins(plan.purchase_cost)}</Typography>
                    </Stack>
                    <Typography variant="body2">{quantity_limit_reason}.</Typography>
                    <Button sx={{ mt: 1 }} onClick={() => setSelected(selected === plan.item_id ? null : plan.item_id)}>{selected === plan.item_id ? "Close plan" : "Review and refresh plan"}</Button>
                    {selected === plan.item_id && plan.recipe_id !== null && <Box sx={{ mt: 2 }}>
                        <CraftPlanPanel key={`${result.observed_at}:${plan.item_id}`} itemId={plan.item_id} itemName={plan.name} recipeId={plan.recipe_id} accountId={accountId} accountName={accountName}
                            materialPricing="sell" outputPricing="buy" eligibleOnly initialQuantity={plan.planned_quantity} initialBudget={String(result.budget / 10000)} initialCheckDepth />
                    </Box>}
                </Box>)}
            </>}
            <CraftRunHistory key={accountId} accountId={accountId} />
        </>}
    </Paper>
}
