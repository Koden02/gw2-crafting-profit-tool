import { useEffect, useRef, useState } from "react"
import { Alert, Box, Button, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material"
import { fetchAccountMaterials, fetchCraftingStatus, saveMaterialReservation, type AccountMaterials, type CraftingStatus, type ReservedMaterial } from "../api/profitableCrafts"
import { formatDateTime } from "../utils/formatting"

function ReservationRow({ row, disabled, save }: { row: ReservedMaterial; disabled: boolean; save: (row: ReservedMaterial, quantity: number, purpose: string) => void }) {
    const [quantity, setQuantity] = useState(String(row.reserved))
    const [purpose, setPurpose] = useState(row.purpose)
    const value = Number(quantity)
    const valid = quantity !== "" && Number.isInteger(value) && value >= 0 && value <= 1000000000 && purpose.length <= 160
    return <TableRow>
        <TableCell>{row.name}</TableCell><TableCell>{row.usable} / {row.owned}</TableCell>
        <TableCell>{row.available}</TableCell>
        <TableCell><TextField size="small" type="number" label={`Reserve ${row.name}`} value={quantity} onChange={e => setQuantity(e.target.value)} sx={{ minWidth: 130 }} /></TableCell>
        <TableCell><TextField size="small" label={`Goal for ${row.name}`} value={purpose} onChange={e => setPurpose(e.target.value)} /></TableCell>
        <TableCell><Button disabled={disabled || !valid || (value === row.reserved && purpose === row.purpose)} onClick={() => save(row, value, purpose)}>Save</Button></TableCell>
    </TableRow>
}

export default function AccountCraftingPanel({ accountId, onChanged }: { accountId: string; onChanged: () => void }) {
    const [crafting, setCrafting] = useState<CraftingStatus | null>(null)
    const [materials, setMaterials] = useState<AccountMaterials | null>(null)
    const [search, setSearch] = useState("")
    const [error, setError] = useState("")
    const [saving, setSaving] = useState(false)
    const [revision, setRevision] = useState(0)
    const alive = useRef(true)
    useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
    useEffect(() => {
        const controller = new AbortController()
        void fetchCraftingStatus(accountId, controller.signal).then(value => {
            if (!controller.signal.aborted) setCrafting(value)
        }).catch(reason => { if (!controller.signal.aborted) setError(String(reason)) })
        return () => controller.abort()
    }, [accountId, revision])
    useEffect(() => {
        const controller = new AbortController()
        const timer = setTimeout(() => {
            void fetchAccountMaterials(accountId, search, controller.signal).then(value => {
                if (!controller.signal.aborted) setMaterials(value)
            }).catch(reason => { if (!controller.signal.aborted) setError(String(reason)) })
        }, 250)
        return () => { clearTimeout(timer); controller.abort() }
    }, [accountId, search, revision])
    async function save(row: ReservedMaterial, quantity: number, purpose: string) {
        if (!materials) return
        setSaving(true); setError("")
        try {
            await saveMaterialReservation(accountId, row.item_id, quantity, purpose, materials.reservation_revision)
            if (alive.current) onChanged()
        } catch (reason) {
            if (alive.current) { setError(reason instanceof Error ? reason.message : "Reservation failed."); setSaving(false) }
        }
    }
    const freshCharacters = crafting?.characters.filter(c => c.crafting.fresh).length ?? 0
    return <Box sx={{ my: 2 }}>
        {crafting && <Alert severity={crafting.characters_source.fresh && freshCharacters > 0 ? "info" : "warning"}>
            Crafting levels: {freshCharacters} of {crafting.characters_source.count} characters have fresh data.
            {" "}Account recipe list: {crafting.account_recipes_source.fresh ? `${crafting.account_recipes_source.count} unlocks` : "missing, stale or refresh failed"}.
            {" "}Automatic recipes and fresh character recipe lists can still establish eligibility.
        </Alert>}
        {error && <Alert severity="error">{error}</Alert>}
        <Box component="details" sx={{ mt: 1 }}>
            <Box component="summary" sx={{ cursor: "pointer", py: 1 }}>Character coverage and material reservations</Box>
            <Typography variant="body2">Only active disciplines are eligible. Missing or stale sources remain unknown; daily-limited crafting routes are excluded. Refresh account data with account, inventories, characters and unlocks permissions.</Typography>
            {crafting?.characters.map(character => <Box key={character.name} sx={{ my: 1 }}>
                <Typography>{character.name}: {character.disciplines.map(d => `${d.discipline} ${d.rating}${d.active ? "" : " (inactive)"}`).join(", ") || "No known disciplines"}</Typography>
                <Typography variant="caption">Levels {character.crafting.fresh ? "fresh" : "unverified"} ({formatDateTime(character.crafting.fetched_at)}); recipes {character.recipes.fresh ? `${character.recipes.count} available` : "unverified"}.</Typography>
            </Box>)}
            <Typography sx={{ mt: 2 }}>Reservations apply only to this account and survive syncs. Set a quantity to zero to release it. Reserved quantities are excluded from every account plan; they may exceed current stock for a future goal.</Typography>
            <Stack direction="row" spacing={1} sx={{ my: 2 }}>
                <TextField label="Find owned or reserved material" size="small" value={search} onChange={e => { setMaterials(null); setSearch(e.target.value) }} />
                <Button onClick={() => { setError(""); setMaterials(null); setRevision(v => v + 1) }}>Reload account data</Button>
                {saving && <CircularProgress size={24} />}
            </Stack>
            {!materials ? <CircularProgress size={24} /> : <>
                <Typography variant="caption">Showing {materials.rows.length} of {materials.total} materials. Usable stock excludes bound items. Equipped items are not imported.</Typography>
                <Box sx={{ overflowX: "auto" }}><Table size="small"><TableHead><TableRow>
                    <TableCell>Material</TableCell><TableCell>Usable / owned</TableCell><TableCell>Available</TableCell><TableCell>Reserved</TableCell><TableCell>Goal</TableCell><TableCell />
                </TableRow></TableHead><TableBody>
                    {materials.rows.map(row => <ReservationRow key={`${materials.reservation_revision}:${row.item_id}`} row={row} disabled={saving} save={(...args) => void save(...args)} />)}
                </TableBody></Table></Box>
            </>}
        </Box>
    </Box>
}
