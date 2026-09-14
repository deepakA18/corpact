---
title: Spin-off
description: Shares of a separated company distributed to the parent's holders.
---

| | |
|---|---|
| Type | `spin_off` |
| Category | basis |
| Ledger treatment | Basis allocation |
| Validation status | **Validated** |
| Real instances | **6** |

## What we detect

A multiplier increase matching a standing `SpinOff` record. xStocks never deliver the new company's shares: they sell them and reinvest the proceeds into the parent.

## Evidence required

- A standing record matching both multipliers and the activation time.
- The multiplier increases.
- Issuer proceeds, when published, must imply a parent price within ×3 of the median implied by the same asset's dividends.

## When evidence is missing or conflicts

- The multiplier does not increase: unclassified. Only distributions reinvested into the parent are supported.
- No proceeds published: booked from the multipliers alone, with a warning.
- Implausible proceeds: booked, with proceeds null and a warning.

## How it is booked

**Basis allocation.** The distributed share of the position's value is exactly (M_new − M_old) ÷ M_new, with no price needed. The added units are principal carrying allocated basis. The floor scales with the multiplier. Zero income; nothing newly convertible.

## Real instances

GMEx, HONx ×2, DFDVx, OPENx and CMCSAx. Four are labelled "Dividend" and two "Administrative"; four of the six raise the multiplier less than the largest cash dividend (+2.93%).

Census note: GMEx, HONx ×2, DFDVx, OPENx, CMCSAx; all delivered as cash reinvested through the parent multiplier; distributed share = ΔM ÷ M_new; HONx proceeds reconcile within 3% of its dividend-implied price.

## In the API

- **v2:** `type: "spin_off"`, `treatment: "basis_allocation"`, `validation.status: "validated"`, and the lifecycle and evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`, with the treatment stated in `reasons` and `headline`.
