import { useEffect, useState } from "react"
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material"
import type { CraftPlan } from "../api/profitableCrafts"
import { goldToCopper, loadCraftRuns, saveCraftRun } from "../utils/craftRuns"
import { formatCoins, formatDateTime } from "../utils/formatting"

export function RecordCraftResult({ plan }: { plan: CraftPlan }) {
    const [purchases, setPurchases] = useState("")
    const [sales, setSales] = useState("")
    const [message, setMessage] = useState("")
    const [saved, setSaved] = useState(false)
    const purchaseCopper = goldToCopper(purchases)
    const saleCopper = goldToCopper(sales)
    const valid = purchaseCopper !== null && saleCopper !== null
    function save() {
        if (purchaseCopper === null || saleCopper === null) return
        try { saveCraftRun(plan, purchaseCopper, saleCopper); setSaved(true); setMessage("Result saved locally for this account.") }
        catch { setMessage("Could not save in browser storage. Your result has not been recorded.") }
    }
    return <Box component="details" sx={{ mt: 2 }}>
        <Box component="summary" sx={{ cursor: "pointer" }}>Record the result after crafting and selling</Box>
        <Typography variant="body2" sx={{ my: 1 }}>Enter the totals for all {plan.planned_quantity} outputs after they have sold. Net sales must already subtract both Trading Post fees, including the upfront listing fee. Partial or unsold batches should wait.</Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ my: 1 }}>
            <TextField label="Actual material purchases (gold)" size="small" value={purchases} disabled={saved} onChange={e => setPurchases(e.target.value)} />
            <TextField label="Actual net sales after all fees (gold)" size="small" value={sales} disabled={saved} onChange={e => setSales(e.target.value)} />
            <Button disabled={!valid || saved} onClick={save}>Save completed result</Button>
        </Stack>
        {valid && <Typography>Actual cash surplus: {formatCoins(saleCopper - purchaseCopper)}. Gain using the quote’s owned-stock valuation: {formatCoins(plan.owned_sale_value === null ? null : saleCopper - purchaseCopper - plan.owned_sale_value)}.</Typography>}
        {message && <Alert severity={saved ? "success" : "error"}>{message}</Alert>}
    </Box>
}

export function CraftRunHistory({ accountId }: { accountId: string }) {
    const [runs, setRuns] = useState(() => loadCraftRuns(accountId))
    useEffect(() => {
        const reload = () => setRuns(loadCraftRuns(accountId))
        window.addEventListener("gw2-craft-run-saved", reload)
        window.addEventListener("storage", reload)
        return () => { window.removeEventListener("gw2-craft-run-saved", reload); window.removeEventListener("storage", reload) }
    }, [accountId])
    if (!runs.length) return null
    return <Box component="details" sx={{ mt: 2 }}>
        <Box component="summary" sx={{ cursor: "pointer" }}>Completed craft results ({runs.length})</Box>
        <Typography variant="caption">The latest 50 manual records are saved in this browser for this account. Owned materials retain their quoted resale value for comparison. Sync account data again after crafting to update available stock.</Typography>
        {runs.map(run => <Box key={run.id} sx={{ my: 1.5 }}>
            <Typography>{run.quantity} × {run.name} · {formatDateTime(run.completedAt)}</Typography>
            <Typography variant="body2">Cash surplus: {formatCoins(run.actualNetSales - run.actualPurchases)} · Gain using quoted stock value: {formatCoins(run.quotedOwnedValue === null ? null : run.actualNetSales - run.actualPurchases - run.quotedOwnedValue)} · Estimated gain: {formatCoins(run.quotedGain)}</Typography>
        </Box>)}
    </Box>
}
