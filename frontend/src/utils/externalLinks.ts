// Public item references only. Account data and API keys are never URL parameters.
export function craftingCalculatorUrl(itemId: number, quantity = 1): string {
    const count = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1
    return `https://gw2efficiency.com/crafting/calculator/d~${count}-${itemId}`
}

export function tradingPostItemUrl(itemId: number): string {
    return `https://www.gw2tp.com/item/${itemId}`
}

export function wikiItemUrl(name: string): string {
    const query = new URLSearchParams({ title: "Special:Search", search: name, go: "Go" })
    return `https://wiki.guildwars2.com/index.php?${query}`
}
