// Transaction links (issue #9): a public block explorer only knows Base Sepolia, never the local anvil fork, so on the
// fork every surface shows the hash with a "local fork" label instead of a Basescan link that leads nowhere.

/** The public explorer of Base Sepolia. */
export const BASESCAN_SEPOLIA = 'https://sepolia.basescan.org';

/** The explorer base URL for a chain mode: none on the fork. */
export function explorerFor(chainMode: string | undefined, url: string = BASESCAN_SEPOLIA): string | null {
  return chainMode === 'fork' ? null : url;
}

/** A transaction as text: the explorer link, or the hash marked as local when there is no explorer. */
export function txText(explorer: string | null | undefined, hash: string): string {
  return explorer ? `${explorer}/tx/${hash}` : `tx ${hash} (local fork, no public explorer)`;
}
