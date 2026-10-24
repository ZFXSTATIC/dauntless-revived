# Cross-region party world routing

On October 8, 2026, shared-world joins falling through the solo allocation path
used the member's saved region, even when they had accepted a party invitation
from a leader in another region. Party hunt allocation already used the leader.

CITY and SHARED fallback allocations now use the current party leader's region.
The selected region is retained for capacity retries. Tutorial allocations keep
the player's preference, and leaving the party restores personal world routing
without changing the stored preference.

Validation: 39 controller tests and 26 HTTP party tests passed. HTTP expectations
were updated for the previously deployed 1000 ms candidate polling field; the
old expectations also failed against the unmodified production controller.

The compiled controller was deployed to the central metagame only. Regional
workers receive its routing decision. This does not establish that every reported
disconnect is resolved or that separate regional infrastructure outages are fixed.
