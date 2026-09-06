import { useEffect, useState } from "react"
import { Alert, Box, Button, CircularProgress, Divider, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material"
import { fetchCraftPlan, type CraftPlan, type MaterialPricingMode, type OutputPricingMode } from "../api/profitableCrafts"
import { formatCoins, formatDateTime } from "../utils/formatting"

export default function CraftPlanPanel({ itemId, recipeId, accountId, accountName, materialPricing, outputPricing, eligibleOnly }: {
    itemId: number; recipeId: number; accountId: string; accountName: string; materialPricing: MaterialPricingMode; outputPricing: OutputPricingMode; eligibleOnly: boolean
}) {
    const [quantity, setQuantity] = useState(1)
    const [budget, setBudget] = useState("")
    const [liquidation, setLiquidation] = useState<OutputPricingMode>(outputPricing)
    const [revision, setRevision] = useState(0)
    const [checkDepth, setCheckDepth] = useState(false)
    const [plan, setPlan] = useState<CraftPlan | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [message, setMessage] = useState("")
    useEffect(() => {
        const controller = new AbortController()
        let cancelled = false
        const timer = setTimeout(() => {
            if (budget !== "" && (!Number.isFinite(Number(budget)) || Number(budget) < 0)) {
                setError("Budget must be a nonnegative amount of gold.")
                setLoading(false)
                return
            }
            void fetchCraftPlan(itemId, {
                quantity, eligible_only: eligibleOnly, recipe_id: recipeId, account_id: accountId || undefined, material_pricing: materialPricing,
                output_pricing: outputPricing, liquidation_pricing: liquidation, check_depth: checkDepth,
                budget: budget === "" ? undefined : Math.floor(Number(budget) * 10000),
            }, controller.signal).then(result => {
                if (!cancelled) { setPlan(result); setError(null); setLoading(false) }
            }).catch((reason: unknown) => {
                if (!cancelled) { setError(reason instanceof Error ? reason.message : "Plan failed."); setLoading(false) }
            })
        }, 250)
        return () => { cancelled = true; clearTimeout(timer); controller.abort() }
    }, [itemId, recipeId, accountId, materialPricing, outputPricing, quantity, budget, liquidation, revision, checkDepth, eligibleOnly])

    function invalidate() { setPlan(null); setError(null); setLoading(true); setMessage(""); setCheckDepth(false) }
    async function copyPlan() {
        if (!plan) return
        const lines = [
            plan.name, `Account: ${accountId || "market estimate"}; snapshot: ${plan.snapshot_id || "none"}`,
            `Recipe ${plan.recipe_id}; output ${plan.planned_quantity}; quoted ${plan.observed_at}`,
            `Materials: ${materialPricing === "buy" ? "buy orders" : "instant buy"}; output: ${outputPricing === "buy" ? "instant sell" : "list sell"}; owned liquidation: ${liquidation === "buy" ? "instant sell" : "list sell"}`,
            `Purchases: ${formatCoins(plan.purchase_cost)}; upfront gold: ${formatCoins(plan.additional_gold_needed)}; gain vs selling owned stock: ${formatCoins(plan.economic_gain)}`,
            "Buy:", ...plan.purchases.map(row => `${row.quantity} ${row.name}: ${formatCoins(row.cost)}`),
            "Use owned:", ...plan.consumed.map(row => `${row.quantity} ${row.name}`),
            "Craft in order:", ...plan.steps.map(row => `${row.runs} runs of recipe ${row.recipe_id}: ${row.produced} ${row.name}; crafter ${row.crafter || "unverified"}, recipe ${row.recipe_state}`),
            "Leftovers:", ...plan.leftovers.map(row => `${row.quantity} ${row.name}`),
            `Eligibility: ${plan.eligibility}; reservation revision: ${plan.reservation_revision ?? "none"}`,
            "Reserved (not used):", ...plan.reserved.map(row => `${row.quantity} ${row.name}`), ...plan.issues, plan.fee_model, plan.allocation_policy,
        ]
        try { await navigator.clipboard.writeText(lines.join("\n")); setMessage("Plan copied.") }
        catch { setMessage("Could not copy the plan.") }
    }
    return <Box>
        <Typography variant="h6">Craft and Shopping Plan</Typography>
        <Typography variant="body2">Account: {accountName}</Typography>
        <Alert severity="info" sx={{ my: 1 }}>{eligibleOnly ? "This plan requires verified crafting steps and excludes reserved stock. Purchases and sales still depend on the stated market assumptions." : "Estimate mode: crafting eligibility is not enforced. Account reservations are still excluded from owned stock."}</Alert>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ my: 2 }}>
            <TextField label="Target output" type="number" size="small" value={quantity}
                onChange={e => { invalidate(); setQuantity(Math.min(100000, Math.max(1, Math.floor(Number(e.target.value)) || 1))) }} />
            <TextField label="Budget (gold, optional)" type="number" size="small" value={budget}
                onChange={e => { invalidate(); setBudget(e.target.value) }} />
            <TextField label="Sell owned materials" select size="small" value={liquidation}
                onChange={e => { invalidate(); setLiquidation(e.target.value as OutputPricingMode) }}>
                <MenuItem value="buy">Instant sell</MenuItem><MenuItem value="sell">List sell</MenuItem>
            </TextField>
            <Button onClick={() => { setPlan(null); setLoading(true); setCheckDepth(true); setRevision(v => v + 1) }} disabled={loading}>Refresh and check depth</Button>
            <Button onClick={() => void copyPlan()} disabled={!plan || loading}>Copy plan</Button>
        </Stack>
        {loading && <CircularProgress size={24} />}
        {error && <Alert severity="error">{error}</Alert>}
        {message && <Typography>{message}</Typography>}
        {plan && !loading && <>
            <Typography variant="body2">Eligibility: {plan.eligibility} · Recipe {plan.recipe_id ?? "unavailable"} · Output {plan.planned_quantity} · {formatDateTime(plan.observed_at)}</Typography>
            <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ my: 2 }}>
                {[
                    ["Purchase cost", plan.purchase_cost], ["Upfront gold needed", plan.additional_gold_needed],
                    ["Net sale proceeds", plan.net_revenue], ["Owned stock resale value", plan.owned_sale_value],
                    ["Cash surplus", plan.cash_surplus], ["Gain vs selling owned stock", plan.economic_gain],
                ].map(([label, value]) => <Box key={String(label)}><Typography variant="caption">{label}</Typography><Typography>{formatCoins(value as number | null)}</Typography></Box>)}
            </Stack>
            {plan.issues.map(issue => <Alert key={issue} severity="warning" sx={{ mb: 1 }}>{issue}</Alert>)}
            <Table size="small"><TableHead><TableRow><TableCell>Buy</TableCell><TableCell>Quantity</TableCell><TableCell>Cost</TableCell></TableRow></TableHead>
                <TableBody>{plan.purchases.map(row => <TableRow key={row.item_id}><TableCell>{row.name}</TableCell><TableCell>{row.quantity}</TableCell><TableCell>{formatCoins(row.cost)}</TableCell></TableRow>)}</TableBody>
            </Table>
            <Typography sx={{ mt: 2 }}>Use owned: {plan.consumed.map(row => `${row.quantity} ${row.name}`).join(", ") || "None"}</Typography>
            <Typography sx={{ mt: 1 }}>Craft in order:</Typography>
            {plan.steps.map((row, index) => <Typography key={index} variant="body2">{row.runs} runs of recipe {row.recipe_id}: {row.produced} {row.name} — {row.crafter ? `${row.crafter} (${row.recipe_state})` : `crafter ${row.eligibility}`}</Typography>)}
            <Typography sx={{ mt: 1 }}>Reserved, not used: {plan.reserved.map(row => `${row.quantity} ${row.name}`).join(", ") || "None affecting this plan"}</Typography>
            <Typography sx={{ mt: 1 }}>Leftovers: {plan.leftovers.map(row => `${row.quantity} ${row.name}`).join(", ") || "None"}</Typography>
            <Typography variant="caption">{plan.fee_model} {plan.allocation_policy}</Typography>
        </>}
        <Divider sx={{ my: 2 }} />
    </Box>
}
