// Defer ownership-dependent fallback while VK login or hero collection is pending.
export function shouldDeferHeroFallback({registered,collectionReady,identityPending}){
 return Boolean(identityPending || (registered && !collectionReady));
}
