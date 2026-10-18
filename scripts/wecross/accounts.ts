/** What to do with the router's chain account for a key: keep it, add it, or replace it (remove, then add it as the
 *  default). An account that is there but not the default is replaced: after a switch of key set (fork, live, fork)
 *  the other set's account stays the default and the router signs with it. The ext must match exactly (lowercase). */
export function chainAccountStep(have: { keyID: number; ext: string; isDefault?: boolean } | undefined, ext: string): 'keep' | 'add' | 'replace' {
  if (!have) return 'add';
  return have.ext === ext && have.isDefault ? 'keep' : 'replace';
}
