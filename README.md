# Token Radar — radar-4

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/RenzzHGE/token-radar-04/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/RenzzHGE/token-radar-04/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for [make.fun's token-radar-01 bounty](https://make.fun/bounty/token-radar-01) ($1,325). It reads the sealed DefiLlama snapshot of 758 protocols, ranks the 203 pre-token ones by an implied value, and shows a reader how to farm each one.

## The model — radar-4

One scoring function runs every row, from the snapshot's own figures only:

1. **Base, log scale:** √TVL × 3000. A protocol 100× larger in TVL is worth 10× more, not 100×.
2. **Growth:** 1 + clamp(7-day change, −60%, +120%) ÷ 100 × 0.40.
3. **Chain pay:** min(1.35, 1 + 0.70 × summed chain weight). A chain's weight is its share of the live set's total TVL, each protocol's TVL split evenly across its chains.
4. **Crowding:** 1 ÷ (1 + 0.06 × ln(n)), n the rankable protocols in the category.
5. **Bleed:** when the 7-day drop passes −20%, up to a further 15% off at −40% and beyond.
6. **Completeness haircut:** −3% when the 7-day change is missing, −2% when the listing date is unreported.
7. **Maturity:** 0.85 + 0.15 × min(age in days, 730) ÷ 730.

Implied value = base × growth × chain pay × crowding × bleed × haircut × maturity. The board is the snapshot's 40-protocol watchlist plus the 163 rankable pre-token protocols below the $50M floor with the most TVL. Live-token protocols are kept apart and shown at the market's own value.

## The dashboard

`dashboard/` is a static page (no framework, no network): a sortable, filterable board, a detail view per protocol with the full arithmetic waterfall and its farm plan, a live view of already-trading protocols, and a model sandbox — move a slider and the board rescores itself. Each farm plan names the cheapest chain to farm on and gives concrete steps with costs and times.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. It runs twice and both runs write the same bytes.

## License

MIT. See [LICENSE](LICENSE).
