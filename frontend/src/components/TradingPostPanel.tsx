import { useEffect, useState } from "react"
import { Alert, Box, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material"
import { fetchTradingPostStatus, type TradingPostStatus } from "../api/profitableCrafts"
import { formatCoins, formatDateTime } from "../utils/formatting"
import { ItemMarketLink } from "./ItemReferenceLinks"

export default function TradingPostPanel({ accountId }: { accountId: string }) {
    const [data, setData] = useState<TradingPostStatus | null>(null)
    const [error, setError] = useState("")
    useEffect(() => {
        const controller = new AbortController()
        const read = () => {
            void fetchTradingPostStatus(accountId, controller.signal).then(value => {
                if (!controller.signal.aborted) { setData(value); setError("") }
            }).catch(() => { if (!controller.signal.aborted) setError("Could not load Trading Post data. Check that the backend is running the latest version, then sync again.") })
        }
        read()
        const timer = setInterval(read, 60000)
        return () => { controller.abort(); clearInterval(timer) }
    }, [accountId])
    if (error) return <Alert severity="warning" sx={{ my: 2 }}>{error}</Alert>
    if (!data) return <CircularProgress size={20} />
    return <Box sx={{ my: 2 }}>
        <Alert severity={data.fresh ? "success" : "warning"}>
            {data.fresh ? "Trading Post orders and pickups are available for planning." : data.error || "To plan with buy orders, enable Include Trading Post and sync account data with tradingpost permission."}
            {data.fetched_at && ` Last successful read: ${formatDateTime(data.fetched_at)}.`}
            {!data.fresh && data.fetched_at && " Saved observations below are not used in new plans."}
        </Alert>
        <Box component="details" sx={{ mt: 1 }}>
            <Box component="summary" sx={{ cursor: "pointer", py: 1 }}>Your Trading Post orders and pickups</Box>
            <Typography variant="body2">{data.note}</Typography>
            {data.fetched_at && <>
                <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ my: 2 }}>
                    <Typography>Gold committed to open buy orders: <strong>{formatCoins(data.committed_gold)}</strong></Typography>
                    <Typography>Gold awaiting pickup: <strong>{formatCoins(data.delivery.coins)}</strong></Typography>
                </Stack>
                <Typography variant="caption">Committed gold has already left your wallet. Pickup gold is not added to the budget you enter. Pending orders and pickup items are separate from your usable inventory.</Typography>
                {(["buys", "sells"] as const).map(side => <Box key={side} sx={{ my: 2 }}>
                    <Typography variant="subtitle1">{side === "buys" ? "Open buy orders" : "Open sell listings"} ({data[side].length})</Typography>
                    <Box sx={{ maxHeight: 300, overflow: "auto" }}><Table size="small" stickyHeader>
                        <TableHead><TableRow><TableCell>Item</TableCell><TableCell>Remaining</TableCell><TableCell>Unit price</TableCell><TableCell>Created</TableCell></TableRow></TableHead>
                        <TableBody>{data[side].map(row => <TableRow key={row.id}>
                            <TableCell>{row.name} <ItemMarketLink itemId={row.item_id} name={row.name} /></TableCell>
                            <TableCell>{row.quantity}</TableCell><TableCell>{formatCoins(row.price)}</TableCell><TableCell>{formatDateTime(row.created)}</TableCell>
                        </TableRow>)}{!data[side].length && <TableRow><TableCell colSpan={4}>None in this snapshot.</TableCell></TableRow>}</TableBody>
                    </Table></Box>
                </Box>)}
                <Typography variant="subtitle1">Items awaiting pickup</Typography>
                {data.delivery.items.map(row => <Typography key={row.item_id} variant="body2">{row.quantity} × {row.name} <ItemMarketLink itemId={row.item_id} name={row.name} /></Typography>)}
                {!data.delivery.items.length && <Typography variant="body2">None in this snapshot.</Typography>}
            </>}
        </Box>
    </Box>
}
