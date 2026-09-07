# Item detail loading

September 7, 2026: item detail, scenario, listing-depth and craft-plan endpoints now
load the selected output's recipe/ingredient graph through indexed queries. Every
alternative recipe remains available, shared ingredients load once, and visited
items stop cycles in the loader. Existing route selection and allocation rules
remain in the planner.

Details and scenarios calculate history/market flow only for the selected output.
Depth and shopping plans skip unused history calculations entirely. Prices and
account observations are read for each request; this change adds no shared account
cache or cache expiration delay after a sync or reservation update.

The drawer displays details as soon as that request finishes. Scenarios, market
depth and history have independent loading/error states. Closing the drawer,
changing items/accounts, or refreshing the table cancels old browser requests;
generation checks also reject late results and errors. History range changes have
their own cancellation and generation checks. Cancellation does not promise that
an already-running backend query or upstream request will stop immediately.

## Local measurements

Measured in market-estimate mode for +18 Agony Infusion (49441, recipe 7867), with
the four drawer requests issued concurrently against the same local database.
The patched HTTP server opened that database read-only, without migrations or an
extra automatic-sync worker.

| Request | Before | After |
| --- | ---: | ---: |
| Details | 32.28 s | 0.391 s |
| Four pricing scenarios | 46.03 s | 0.377 s |
| Live output depth | 42.50 s | 1.229 s |
| Item history | 0.34 s | 0.381 s |

The patched craft-plan endpoint took 0.249 s for the infusion and 0.211 s for
Cleric's Charged Stormcaller Torch. The infusion loaded 19 items/17 recipes; the
torch loaded 20 items/9 recipes. Each history calculation covered one output.

In an isolated browser check, the infusion heading appeared in 296 ms while
optional sections were deliberately delayed by 30 seconds. Switching items
prevented old data/errors from replacing the new item; optional request failures
left the details and shopping plan usable, and reopening recovered normally.
These are point measurements, not latency guarantees under every database load
or GW2 API condition. The browser's list was restricted to the two tested items.

## Validation and scope

173 backend tests pass; frontend lint/build pass. New tests compare complete
quotes across pricing modes, alternate roots, nested recipes and cycles; cover
account isolation, reservations, fresh price reads and Trading Post allocation;
and reject unfiltered catalog/history queries from the single-item endpoints.

Restart the backend to load the optimized queries. The README development command
enables automatic reload for subsequent edits. Broad market searches and batch
shortlisting still load the full catalog and are separate performance work.
Database contents, schema and local-only backup handling are unchanged.
