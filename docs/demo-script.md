# Corpact - final Stocklana pitch and demo script

**One video: all four pitch-deck slides, followed by the working demo. Target: about three minutes.** Read only the blockquotes aloud at about about 150 words per minute, leaving short pauses for slide changes and clicks. The timings are rehearsal targets, not an instruction to rush.

## 0:00–0:12 - Slide 1: Title

**Show:** page 1 of [corpact-deck.pdf](../corpact-deck.pdf). Stay on the title while introducing the project.

> Hi everyone, introducing Corpact. So Corpact is a corporate-actions engine for tokenized stocks on Solana, built for exchanges, wallets, and reporting tools.

## 0:12–1:02 - Slide 2: Problem

**Show:** page 2, with **641 of 654**, **0 transactions**, and **+95.11%** visible. Use the NVIDIA example to explain **0 transactions**, point to **641 of 654** when discussing labels, then **+2.93%** when comparing sizes. The 100-to-101 example is illustrative, not a claim about the demo wallet.

> So let's say you're holding a tokenized NVIDIA share and NVIDIA pays a dividend. Instead of sending cash or tokens to your wallet, the issuer changes a number called a multiplier, which adjusts the balance you see. If it goes from one to 1.01, a balance of 100 becomes 101.
>
> The issuer can schedule that change in advance, so when it takes effect, there's no new transaction for a transfer tracker to pick up.
>
> But a bigger balance doesn't tell you what happened. Of 654 changes we recorded, 641 were labelled dividend, including four spin-offs and a stock dividend. Size doesn't settle it either: the biggest cash dividend caused a larger increase than four of the six spin-offs.

## 1:02–1:13 - Slide 3: Solution

**Show:** page 3. Follow the three boxes from **Observe** to **Match** to **Book or refuse**.

> So Corpact checks each change against the issuer's record, matching the numbers and the time before deciding how to account for it.

## 1:13–1:24 - Slide 4: Product

**Show:** page 4. Point to KOx, **not_booked**, and the reason in the API response. Finish the sentence before switching away.

> Here, KOx has no matching issuer record, so Corpact records no income and explains why. Six recorded changes remained unmatched like this.

## 1:24–1:47 - Demo: Wallet overview

**Show:** switch from the PDF to the [wallet demo](http://localhost:3000/wallet/6kn8Vj9YkvNLo8peW2fzebQdSLtX33A3TkRJwXqMCy1U). Frame the summary cards, then scroll slightly to the positions. The snapshot date is spoken, not displayed in the overview.

> Alright, so this is the demo. It's reading from the Corpact API and showing five positions from a real mainnet wallet, using a September 16 snapshot.
>
> We have 28 dollars and 94 cents in dividend income, while the protected floor tracks principal separately from dividend-derived units.

## 1:47–2:02 - Demo: KOx pending classification

**Show:** scroll to **Balance adjustments**, point to KOx on September 15, 2026, and open the row. Let the drawer load before continuing.

> Opening that KOx row shows the on-chain change and why classification is pending. We can see that the balance changed, but without matching issuer evidence, Corpact won't call it income.

## 2:02–2:24 - Demo: NVDAx unknown dollar value

**Show:** close the drawer and open NVDAx on April 2, 2026. Point to **Unknown** and the missing-net-cash explanation.

> This NVDAx row is different because the dividend is verified, but the issuer record is missing the net cash amount needed to value it. So Corpact records the extra stock units and leaves the dollar value unknown, which is deliberately not the same as zero.

## 2:24–2:59 - Demo: Integration and close

**Show:** briefly show **History** and expand **Issuer record (recorded fixture)** in the NVDAx drawer. Close it and point to **Journal CSV** and **Income CSV** without clicking, since downloads open a Save dialog. Finish on the landing-page hero or deck title.

> Platforms get eight validated action types through the API, with evidence and CSV exports, while corrections preserve earlier entries through reversals and replacements.
>
> This preview uses recorded issuer data and doesn't convert holdings to USDC; the protected floor is a bookkeeping control.
>
> So that's Corpact: it explains what happened, and when it can't prove it, it tells you instead of guessing. Thanks for watching.

## Before recording - not spoken

1. Open the deck and wallet, load the two evidence drawers, and confirm the named rows and displayed totals. The verified portfolio timestamp was September 16, 2026; these are stored mainnet results, not a claim about today's balances.
2. Use the already-synced wallet and read-only demo key from [the README](../README.md#see-it-working). Do not trigger a sync on camera. After opening an evidence row, let the loading indicator finish before narrating its contents. Warm the hosted API by loading the wallet and waiting for it to finish.
3. If you want the landing-page close, run `pnpm --filter @corpact/site dev` and open `http://localhost:3700` beforehand; otherwise finish on the deck title.
4. Record at 1440 × 900, enlarge the relevant rows enough to read, and hide bookmarks and development overlays. Point to each row before explaining it.
5. Keep issuer-recorded data and the displayed chain-data timestamp clear. If a row or total changes, update the narration before recording rather than reading an old figure over new footage.
6. Record the deck opening and product demonstration separately if convenient, then join them into one video under three minutes. Allow a short end card for GitHub and the judge-accessible demo link; do not use a localhost URL in the submitted end card.

## Corrections to the supplied longer draft - not spoken

- The PDF has four slides, not six, and the original deck-plus-demo timing was about five and a half minutes, not four or 2:50.
- A transaction writes the multiplier schedule; no new transaction is needed when that schedule activates. Avoid claiming that no transaction ever exists for a multiplier update.
- Displayed stock quantity is raw base units divided by the decimal scale, multiplied by the active multiplier. The video's plain-language explanation avoids omitting that decimal conversion.
- The two unknowns are not both unproven event types: one lacks a matching action record, while the other is a verified dividend lacking a supported dollar valuation.
- Positions reconcile to their stored chain snapshot. Do not claim that they match balances on chain “right now.”
- The floor tracks principal through the accounting rules, including splits and other basis events; describing it simply as the shares the holder bought is incomplete.
- Dollar values are calculated when supported by issuer net cash. “Nothing is priced” would contradict the income shown on screen.
- The API stores observations even when it cannot book an accounting treatment. “Books nothing” does not mean that evidence or the observed change is discarded.
- Avoid blanket claims about every wallet or indexer, universal tax treatment, or being the least crowded hackathon category. None is needed to explain or demonstrate the product.
- The pasted draft's claims about staged files and completed housekeeping were not verified in this script review.

## Reference material

- [Pitch deck](../corpact-deck.pdf)
- [Project overview and wallet setup](../README.md)
- [Recorded findings](findings/what-this-catches.md)
- [Saved synthetic walkthrough](demo-walkthrough-sample.md), available as supplementary evidence but not part of this short video's narration

## Browser rehearsal - September 24, 2026

Verified the wallet visually in Brave: the summary cards, all five positions, partial-history labels, and yield values load. Opened both featured rows and confirmed that the KOx drawer explains the missing match and the NVDAx drawer explains the missing net cash amount. Expanded the recorded issuer record and checked its history. Both CSV buttons downloaded successfully, and both exports contain 11 data rows. The landing-page hero also renders correctly in light mode, with the artwork and statistics visible. The NVDAx history shows an initial recognition, not a reversal; the closing narration describes correction handling as a capability, not as an event visible in that row. These checks cover the recording path, not every feature of the project.
