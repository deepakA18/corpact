import {
  airdropFactory,
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  extension,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToCheckedInstruction,
  getPreInitializeInstructionsForMintExtensions,
  getTransferCheckedInstruction,
  getUpdateMultiplierScaledUiMintInstruction,
} from '@solana-program/token-2022';
import { assertLocalRpc } from './localnet';

export type Commitment = 'confirmed' | 'finalized';

export interface MultiplierWriteInput {
  multiplier: number;
  effectiveUnix: bigint;
}

/**
 * Kit-built transactions for the synthetic scenario. Local validator only: every key is
 * generated per run, the issuer pays all fees, and nothing is ever signed for a real cluster.
 */
export async function createDemoChain(rpcUrl: string, wsUrl: string) {
  assertLocalRpc(rpcUrl);
  assertLocalRpc(wsUrl.replace(/^ws/, 'http'));
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  const airdrop = airdropFactory({ rpc, rpcSubscriptions });
  const fundedSigner = async () => {
    const signer = await generateKeyPairSigner();
    await airdrop({ recipientAddress: signer.address, lamports: lamports(100_000_000_000n), commitment: 'confirmed' });
    return signer;
  };
  const issuer = await fundedSigner();

  async function send(instructions: readonly Instruction[], feePayer: KeyPairSigner = issuer): Promise<Signature> {
    const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const transaction = await signTransactionMessageWithSigners(message);
    assertIsTransactionWithBlockhashLifetime(transaction);
    await sendAndConfirm(transaction, { commitment: 'confirmed' });
    return getSignatureFromTransaction(transaction);
  }

  /** Cluster Clock time of a slot at the given commitment: the time the Token-2022 processor sees. */
  async function clock(commitment: Commitment = 'confirmed'): Promise<bigint> {
    const slot = await rpc.getSlot({ commitment }).send();
    const time = await rpc.getBlockTime(slot).send();
    if (time === null) throw new Error(`Slot ${slot} has no block time`);
    return BigInt(time);
  }

  async function waitForClock(unix: bigint, commitment: Commitment = 'confirmed'): Promise<void> {
    while ((await clock(commitment)) < unix) await new Promise((resolve) => setTimeout(resolve, 400));
  }

  async function blockTimeOf(signature: Signature): Promise<bigint> {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const slot = value[0]?.slot;
    if (slot === undefined) throw new Error(`No status for ${signature}`);
    const time = await rpc.getBlockTime(slot).send();
    if (time === null) throw new Error(`Slot ${slot} has no block time`);
    return BigInt(time);
  }

  async function ata(owner: Address, mint: Address): Promise<Address> {
    const [address] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
    return address;
  }

  const ensureAta = (owner: Address, mint: Address) =>
    getCreateAssociatedTokenIdempotentInstructionAsync({ payer: issuer, owner, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });

  return {
    issuer,
    /** A fresh local keypair with SOL, for a deployer whose transactions the issuer never signs. */
    fundedSigner,

    clock,
    waitForClock,
    /** The associated Token-2022 account of `owner` for `mint`. */
    tokenAccount: ata,

    /** Token-2022 mint with a ScaledUiAmount multiplier of 1 and the issuer as mint authority, created and paid for by `payer`. */
    async createScaledUiMint(multiplierAuthority: Address, decimals: number, payer: KeyPairSigner = issuer): Promise<Address> {
      const mint = await generateKeyPairSigner();
      const extensions = [
        extension('ScaledUiAmountConfig', { authority: multiplierAuthority, multiplier: 1, newMultiplierEffectiveTimestamp: 0n, newMultiplier: 1 }),
      ];
      const space = getMintSize(extensions);
      const rent = await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();
      await send(
        [
          getCreateAccountInstruction({ payer, newAccount: mint, lamports: rent, space, programAddress: TOKEN_2022_PROGRAM_ADDRESS }),
          ...getPreInitializeInstructionsForMintExtensions(mint.address, extensions),
          getInitializeMint2Instruction({ mint: mint.address, decimals, mintAuthority: issuer.address }),
        ],
        payer,
      );
      return mint.address;
    },

    async mintTo(mint: Address, owner: Address, raw: bigint, decimals: number): Promise<Signature> {
      return send([
        await ensureAta(owner, mint),
        getMintToCheckedInstruction({ mint, token: await ata(owner, mint), mintAuthority: issuer, amount: raw, decimals }),
      ]);
    },

    /** A transfer the holder signs, so it appears among the holder's own transactions. */
    async transfer(mint: Address, from: KeyPairSigner, to: Address, raw: bigint, decimals: number): Promise<Signature> {
      return send([
        await ensureAta(to, mint),
        getTransferCheckedInstruction({
          source: await ata(from.address, mint),
          mint,
          destination: await ata(to, mint),
          authority: from,
          amount: raw,
          decimals,
        }),
      ]);
    },

    /** One transaction of UpdateMultiplier instructions, in order; returns its signature and Clock time. */
    async updateMultiplier(mint: Address, authority: KeyPairSigner, writes: readonly MultiplierWriteInput[]) {
      const signature = await send(
        writes.map((w) => getUpdateMultiplierScaledUiMintInstruction({ mint, authority, multiplier: w.multiplier, effectiveTimestamp: w.effectiveUnix })),
      );
      return { signature, clockUnix: await blockTimeOf(signature) };
    },
  };
}

export type DemoChain = Awaited<ReturnType<typeof createDemoChain>>;
