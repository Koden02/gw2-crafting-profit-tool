import type { CraftPlan } from "../api/profitableCrafts"

export function goldToCopper(value: string): number | null {
    if (!/^\d+(\.\d{1,4})?$/.test(value.trim())) return null
    const copper = Math.round(Number(value) * 10000)
    return Number.isSafeInteger(copper) && copper <= 100000000 ? copper : null
}

export type CraftRun = {
    id: string; name: string; quantity: number; recipeId: number | null; completedAt: string
    quotedGain: number | null; quotedOwnedValue: number | null; actualPurchases: number; actualNetSales: number
}
const key = (accountId: string) => `gw2-profit:completed-crafts:${accountId}`
export function loadCraftRuns(accountId: string): CraftRun[] {
    try {
        const raw: unknown = JSON.parse(localStorage.getItem(key(accountId)) ?? "[]")
        return Array.isArray(raw) ? raw.filter((r): r is CraftRun => r && typeof r.id === "string" && typeof r.name === "string"
            && typeof r.completedAt === "string" && Number.isFinite(r.quantity)
            && Number.isFinite(r.actualPurchases) && Number.isFinite(r.actualNetSales)
            && (r.quotedOwnedValue === null || Number.isFinite(r.quotedOwnedValue))
            && (r.quotedGain === null || Number.isFinite(r.quotedGain))).slice(0, 50) : []
    } catch { return [] }
}
export function saveCraftRun(plan: CraftPlan, actualPurchases: number, actualNetSales: number): void {
    if (!plan.account_id) throw new Error("Select an account before recording a result.")
    const run: CraftRun = { id: crypto.randomUUID(), name: plan.name, quantity: plan.planned_quantity,
        recipeId: plan.recipe_id, completedAt: new Date().toISOString(), quotedGain: plan.economic_gain,
        quotedOwnedValue: plan.owned_sale_value, actualPurchases, actualNetSales }
    localStorage.setItem(key(plan.account_id), JSON.stringify([run, ...loadCraftRuns(plan.account_id)].slice(0, 50)))
    window.dispatchEvent(new Event("gw2-craft-run-saved"))
}
