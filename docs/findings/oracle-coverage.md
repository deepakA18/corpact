# Finding 0.4 — Pyth equity feed coverage

**Status:** complete · **Verdict:** ⚠️ Feeds exist, but **no usable price path exists today**. Both the pull source and the on-chain push source are unavailable to us as specified. This blocks NAV-banded orders and the basis dashboard until a price pipeline is built and funded.

| | |
|---|---|
| Scope | NVDA, AAPL, TSLA, SPCX |
| Observed | 2026-09-12 16:11Z (Saturday; US equity market closed) |
| Reproduce | `node tools/phase0/pyth-coverage.js` |
| Raw evidence | [`evidence/oracle-coverage-20260912.txt`](evidence/oracle-coverage-20260912.txt) |

---

## 1. Headline

§0.4 asks us to confirm per-ticker feed availability and to treat "no price" as a first-class state. Feed *availability* is fine. Feed *access* is not.

1. **Hermes price routes now require credentials.** `GET /v2/updates/price/latest` returns **HTTP 401 `unauthorized`** — including for the always-on BTC/USD control feed, which proves this is an authentication gate and not a market-hours signal. The legacy `/api/latest_price_feeds` route returns 401 too. Metadata (`/v2/price_feeds`) remains open.
2. **Sponsored on-chain equity feed accounts are stale by weeks.** NVDA's account was last written **17.0 days** ago; AAPL's **28.8 days**. The BTC control account, read with the identical parser, is current to the second.
3. **Half the relevant feeds have no on-chain account at all.** Every `Equity.Index.*` ("24/7") variant and `Equity.US.SPCX/USD` return nothing across shards 0–3.

The verification path matters here: the first version of this probe reported "no update returned" for closed-market feeds and I nearly wrote that up as market-hours behaviour. It was a 401. **The 401 is invisible unless you check an always-on control feed** — a trap the pricing service must not fall into at runtime.

## 2. Coverage

Both variants exist in Hermes metadata for all four tickers:

| Ticker | `Equity.US.<T>/USD` | `Equity.Index.<T>/USD` ("24/7") | On-chain account |
|---|---|---|---|
| NVDA | `b1073854…0a593` | `a470c4ac…27b852` | US only (`2w1Tg1XT…GZFC`) |
| AAPL | `49f6b65c…55688` | `aaba35e6…030f36` | US only (`DJ2FyTgU…VbUy`) |
| TSLA | `16dad506…632f1` | `e6da44bf…8ae3fc0` | US only (`E8WFH8br…EZUQ`) |
| SPCX | `8a593d6e…3bb94` | `2dbfb179…cdf17b9` | **none** |

SPCX having a Pyth feed at all is notable — a pre-IPO private company with a published equity price. Its provenance should be understood before it anchors any NAV band.

## 3. On-chain state

Sponsored price accounts are PDAs of the **push oracle** program `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`, seeded `[shard_id: u16 LE, feed_id: [u8;32]]`. (Not the receiver program `rec5EKMG…` — deriving against the receiver finds nothing, including for BTC, which is a useful sanity check.)

| Feed | Account | Price | Conf | Last publish | Age |
|---|---|---|---|---|---|
| BTC/USD *(control)* | `4cSM2e6r…PSPo` | 77,365.9969 | ±14.01 (1.8 bps) | 2026-09-12 15:53Z | **0.0h** |
| Equity.US.TSLA | `E8WFH8br…EZUQ` | 364.1100 | ±0.07 (1.9 bps) | 2026-09-11 06:04Z | **34.1h** |
| Equity.US.NVDA | `2w1Tg1XT…GZFC` | 211.0150 | ±0.11 (5.2 bps) | 2026-08-26 15:54Z | **408.3h (17.0d)** |
| Equity.US.AAPL | `DJ2FyTgU…VbUy` | 305.9200 | ±0.02 (0.7 bps) | 2026-08-14 20:00Z | **692.2h (28.8d)** |
| Equity.Index.* (all) | — | — | — | — | no account |
| Equity.US.SPCX | — | — | — | — | no account |

`publish_time == prev_publish_time` on NVDA and AAPL: the account has not been updated even once since its last write.

These are not weekend staleness. AAPL's last write, 2026-08-14 20:00:19Z, is a Thursday US close. NVDA's, 2026-08-26 15:54:46Z, is mid-session on a Tuesday. TSLA's, 2026-09-11 06:04Z, is Friday pre-market — it stopped *before* Friday's session rather than at its end. **Nobody is maintaining these accounts.** A Parity-run pusher is required, not optional.

The stale values are also far enough out to be dangerous if trusted. NVDAx currently trades at ~$219.83 per token against a 17-day-old NVDA reference of $211.02 — a nominal ~4% "basis" that is almost entirely oracle staleness. Computing basis off these accounts would produce confident, wrong numbers.

## 4. "24/7" does not mean 24/7 market hours

`Equity.Index.NVDA/USD` is described as *"PYTH PRICE IN USD FOR NVDA 24/7"*, which reads like the answer to §6's off-hours problem. Its metadata says otherwise:

```
America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;<holidays>
market open: false   next_open: 2026-09-14 13:30Z   next_close: 2026-09-14 20:00Z
```

Identical weekly hours to the `Equity.US` feed — 09:30–16:00 ET weekdays, closed weekends — differing only in the holiday list. Both report `is_open: false` on a Saturday.

The "24/7" label most likely refers to Pyth's pricing *methodology* (a continuously computed index) rather than to publishing hours, but with price routes credentialed we **cannot verify whether it actually publishes off-hours**, and it has no on-chain account to inspect. This is the single most valuable thing to check once credentials exist: an off-hours reference price would materially change §6's design, turning NAV-banded off-hours execution from impossible into merely expensive.

Until then, **assume no off-hours reference price exists.**

## 5. Market-hours metadata is good, and is the part we can rely on

The open metadata route gives everything §5.4 needs for market-state logic, without credentials:

- `market_hours.is_open`, `next_open`, `next_close` as unix timestamps.
- A full `schedule` string: timezone, per-weekday sessions, and explicit holiday overrides including half-days (`1127/0930-1300` — the day after US Thanksgiving; `1224/0930-1300` — Christmas Eve).

The frontend's "market state is always visible" requirement (§9) and the orders program's market-closed gate can both be built on this now. **Parse the schedule string rather than hardcoding NYSE hours** — half-days and holidays are exactly the edges where a naive implementation silently executes into a closed or thin market.

## 6. "No price" has three distinct flavours

§0.4 requires "no price" to be a first-class state. The observed reality needs three variants, not one, because they demand different responses:

| State | Observed as | Correct response |
|---|---|---|
| **Absent** | No feed, or no on-chain account | Underlying is ineligible for NAV-banded orders entirely. Reject at registry admission. |
| **Stale** | Account exists; `now − publish_time > max_staleness` | Block execution. Show last price with an explicit age. Never silently use it. |
| **Closed** | `market_hours.is_open == false` | Block unless the user opted into off-hours execution (§5.4). Distinct from stale — a price can be fresh and the market closed, or the market open and the feed stale. |

`pricing` must model these as separate enum variants, never collapse them to `None`, and never surface any of them as an error. A stale on-chain account still deserializes into a perfectly well-formed price; **staleness is never signalled, only computed.**

## 7. Consequences for the spec

1. **§8.2 `pricing` must include a Pyth price pusher.** Pull the VAA from Hermes, post it on-chain via the receiver. This is standard Pyth pull-oracle operation, but the spec assumes reference prices are simply available. They are not.
2. **Commercial dependency, Phase 1.** Hermes credentials are now a procurement item with cost, rate limits and terms. Add to the Phase 1 critical path — Phase 1's deliverable is a basis dashboard, and there is no basis without a price.
3. **§5.4 NAV-banded orders need a price update in the transaction.** With no maintained sponsored account, the fresh price must be posted by the executing transaction, which changes the `orders` instruction interface: every NAV-gated execution carries a price-update instruction and its account. This affects transaction size, compute budget and who pays for the update.
4. **`max_staleness` must be set per market state, not globally.** A single threshold cannot distinguish a healthy weekend from a dead publisher. Recommend: during market hours, tens of seconds; outside them, compare against `next_open`/`last_close` rather than wall-clock age.
5. **A second price source is needed for cross-checking.** With a single credentialed provider and demonstrably unmaintained on-chain accounts, a silent failure has no independent detector. The risk engine (§7.1) cannot flag a depeg it cannot see.
6. **SPCX has no on-chain feed.** Reinforces [`liquidity-fragmentation.md`](liquidity-fragmentation.md) §5: the one genuinely fragmented underlying is also the one we cannot price on-chain.

## 8. Open items

- [ ] Obtain Hermes credentials (or a commercial Pyth agreement) and re-run. Blocks Phase 1.
- [ ] With credentials, determine whether `Equity.Index.*` actually publishes outside US market hours. Directly determines what §6 can offer.
- [ ] Measure confidence-interval behaviour across the open→closed boundary. §5.4 widens the NAV band by confidence; if confidence does not widen as the close approaches, that mechanism does nothing when it is most needed.
- [ ] Cost out running our own pusher: update frequency × transaction cost × ticker count, against the number of underlyings Phase 1 covers.
- [ ] Evaluate a second reference source (Switchboard, Chainlink, or a licensed market-data feed) for cross-checking.
- [ ] Establish SPCX feed provenance — how is a private company's equity priced, and by whom?
