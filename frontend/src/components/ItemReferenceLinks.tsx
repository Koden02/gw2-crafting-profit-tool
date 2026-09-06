import { Button, Link, Stack, Typography } from "@mui/material"
import { craftingCalculatorUrl, tradingPostItemUrl, wikiItemUrl } from "../utils/externalLinks"

type ItemReferenceProps = { itemId: number; name: string; quantity?: number }

export default function ItemReferenceLinks({ itemId, name, quantity = 1 }: ItemReferenceProps) {
    return <Stack spacing={0.75} sx={{ my: 1.5 }} role="group" aria-label={`External information for ${name}`}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {[
                { label: "gw2efficiency", href: craftingCalculatorUrl(itemId, quantity), description: `Craft ${quantity} × ${name} in gw2efficiency` },
                { label: "GW2TP", href: tradingPostItemUrl(itemId), description: `Market details for ${name} on GW2TP` },
                { label: "Wiki", href: wikiItemUrl(name), description: `${name} on the Guild Wars 2 Wiki` },
            ].map(link => <Button key={link.label} href={link.href} target="_blank" rel="noopener noreferrer"
                variant="outlined" size="small" sx={{ textTransform: "none" }}
                title={`${link.description} (opens in a new tab)`} aria-label={`${link.description} (opens in a new tab)`}
                endIcon={<span aria-hidden="true">↗</span>}>
                {link.label}
            </Button>)}
        </Stack>
        <Typography variant="caption" color="text.secondary">External sites use their own prices and account settings. Local reservations and recipe choices are not carried over.</Typography>
    </Stack>
}

export function ItemMarketLink({ itemId, name }: Pick<ItemReferenceProps, "itemId" | "name">) {
    return <Link href={tradingPostItemUrl(itemId)} target="_blank" rel="noopener noreferrer" underline="hover"
        variant="caption" sx={{ whiteSpace: "nowrap" }}
        title={`Market details for ${name} on GW2TP (opens in a new tab)`}
        aria-label={`Market details for ${name} on GW2TP (opens in a new tab)`}>
        Market <span aria-hidden="true">↗</span>
    </Link>
}
