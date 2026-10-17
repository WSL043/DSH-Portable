import { useEffect, useState } from 'react'

// 'unknown' while the answer is on its way, so the Portable button never flashes away and back.
export type OfficialMarketState = 'unknown' | 'active' | 'inactive'

let cached: OfficialMarketState = 'unknown'
let inflight: Promise<OfficialMarketState> | null = null

/** Asks the Portable market server whether the official plugin market is switched on in this profile. */
export function readOfficialMarket(fetcher: typeof fetch = fetch): Promise<OfficialMarketState> {
  inflight ??= fetcher('/dsh-market/official-market', { signal: AbortSignal.timeout(10_000) })
    .then(response => (response.ok ? response.json() as Promise<{ active?: unknown }> : { active: false }))
    .then((body): OfficialMarketState => (body.active === true ? 'active' : 'inactive'))
    // A failed lookup leaves the Portable market in place: the only surface must not vanish on a hiccup.
    .catch((): OfficialMarketState => 'inactive')
    .then(state => { cached = state; inflight = null; return state })
  return inflight
}

/** Forgets the answer, so a manager page opened after the user toggled the official market asks again. */
export function forgetOfficialMarket(): void {
  cached = 'unknown'
  inflight = null
}

export function useOfficialMarket(): OfficialMarketState {
  const [state, setState] = useState<OfficialMarketState>(cached)
  useEffect(() => {
    let live = true
    forgetOfficialMarket()
    void readOfficialMarket().then(next => { if (live) setState(next) })
    return () => { live = false }
  }, [])
  return state
}
