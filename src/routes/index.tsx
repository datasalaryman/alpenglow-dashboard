import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useCallback, useEffect, useRef, useState } from 'react'

const getNetworkSnapshot = createServerFn({ method: 'GET' }).handler(async () => {
  const { Connection, clusterApiUrl } = await import('@solana/web3.js')
  const endpoint = process.env.SOLANA_RPC_URL ?? clusterApiUrl('mainnet-beta')
  const connection = new Connection(endpoint, 'confirmed')

  const [epoch, samples, votes, version] = await Promise.all([
    connection.getEpochInfo(),
    connection.getRecentPerformanceSamples(6),
    connection.getVoteAccounts(),
    connection.getVersion(),
  ])

  const activeStake = votes.current.reduce(
    (total, vote) => total + vote.activatedStake,
    0n,
  )
  const delinquentStake = votes.delinquent.reduce(
    (total, vote) => total + vote.activatedStake,
    0n,
  )
  const totalStake = activeStake + delinquentStake
  const sampleSeconds = samples.reduce(
    (total, sample) => total + sample.samplePeriodSecs,
    0,
  )
  const transactions = samples.reduce(
    (total, sample) => total + sample.numTransactions,
    0n,
  )
  const nonVoteTransactions = samples.reduce(
    (total, sample) => total + sample.numNonVoteTransactions,
    0n,
  )

  return {
    slot: Number(epoch.absoluteSlot),
    blockHeight: Number(epoch.blockHeight),
    transactionCount: Number(epoch.transactionCount ?? 0n),
    epoch: Number(epoch.epoch),
    slotIndex: Number(epoch.slotIndex),
    slotsInEpoch: Number(epoch.slotsInEpoch),
    tps: sampleSeconds ? Number(transactions) / sampleSeconds : 0,
    nonVoteTps: sampleSeconds ? Number(nonVoteTransactions) / sampleSeconds : 0,
    activeValidators: votes.current.length,
    delinquentValidators: votes.delinquent.length,
    activeStakeSol: Number(activeStake) / 1_000_000_000,
    delinquentStakePercent:
      totalStake === 0n ? 0 : (Number(delinquentStake) / Number(totalStake)) * 100,
    coreVersion: version['solana-core'],
    featureSet: version['feature-set'],
    samples: samples
      .map((sample) => ({
        slot: Number(sample.slot),
        tps: Number(sample.numTransactions) / sample.samplePeriodSecs,
      }))
      .reverse(),
    updatedAt: new Date().toISOString(),
  }
})

type FeatureActivation =
  | { cluster: string; status: 'not-set' }
  | { cluster: string; status: 'activated' }
  | {
      cluster: string
      status: 'coming'
      activationEpoch: number
      estimatedActivationAt: number
    }

const getFeatureActivations = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FeatureActivation[]> => {
    const { Connection, PublicKey, clusterApiUrl } = await import(
      '@solana/web3.js'
    )
    const featureAddress = new PublicKey(
      'A1pengvuM6JEcyNuTnMqepBKhwHE3N6PmUrdATGawhJS',
    )
    const featureProgram = 'Feature111111111111111111111111111111111111'
    const clusters = [
      {
        cluster: 'Testnet',
        endpoint:
          process.env.SOLANA_TESTNET_RPC_URL ?? clusterApiUrl('testnet'),
      },
      {
        cluster: 'Devnet',
        endpoint: process.env.SOLANA_DEVNET_RPC_URL ?? clusterApiUrl('devnet'),
      },
      {
        cluster: 'Mainnet',
        endpoint:
          process.env.SOLANA_RPC_URL ?? clusterApiUrl('mainnet-beta'),
      },
    ]

    return Promise.all(
      clusters.map(async ({ cluster, endpoint }): Promise<FeatureActivation> => {
        const connection = new Connection(endpoint, 'confirmed')
        const account = await connection.getAccountInfo(featureAddress)

        // Feature addresses are commonly prefunded as empty system accounts
        // before the feature is scheduled.
        if (!account || account.data.length === 0) {
          return { cluster, status: 'not-set' }
        }
        if (
          account.owner.toBase58() !== featureProgram ||
          account.executable ||
          account.data.length !== 9
        ) {
          throw new Error(`Invalid feature account on ${cluster}`)
        }
        if (account.data[0] === 0) {
          return { cluster, status: 'not-set' }
        }
        if (account.data[0] !== 1) {
          throw new Error(`Invalid feature activation data on ${cluster}`)
        }

        const activationSlot = new DataView(
          account.data.buffer,
          account.data.byteOffset,
          account.data.byteLength,
        ).getBigUint64(1, true)
        const [epoch, epochSchedule, samples] = await Promise.all([
          connection.getEpochInfo(),
          connection.getEpochSchedule(),
          connection.getRecentPerformanceSamples(1),
        ])
        const currentSlot = epoch.absoluteSlot

        if (activationSlot <= currentSlot) {
          return { cluster, status: 'activated' }
        }

        const sample = samples[0]
        const secondsPerSlot = sample?.numSlots
          ? sample.samplePeriodSecs / Number(sample.numSlots)
          : 0.4
        const remainingSeconds =
          Number(activationSlot - currentSlot) * secondsPerSlot

        return {
          cluster,
          status: 'coming',
          activationEpoch: Number(epochSchedule.getEpoch(activationSlot)),
          estimatedActivationAt: Date.now() + remainingSeconds * 1_000,
        }
      }),
    )
  },
)

// Keep the high-frequency request small. Validator stake, version, and protocol
// status change much less often and are refreshed by the full snapshot below.
const getLiveNetworkSnapshot = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { Connection, clusterApiUrl } = await import('@solana/web3.js')
    const endpoint = process.env.SOLANA_RPC_URL ?? clusterApiUrl('mainnet-beta')
    const connection = new Connection(endpoint, 'confirmed')
    const [epoch, samples] = await Promise.all([
      connection.getEpochInfo(),
      connection.getRecentPerformanceSamples(6),
    ])
    const sampleSeconds = samples.reduce(
      (total, sample) => total + sample.samplePeriodSecs,
      0,
    )
    const transactions = samples.reduce(
      (total, sample) => total + sample.numTransactions,
      0n,
    )
    const nonVoteTransactions = samples.reduce(
      (total, sample) => total + sample.numNonVoteTransactions,
      0n,
    )

    return {
      slot: Number(epoch.absoluteSlot),
      blockHeight: Number(epoch.blockHeight),
      transactionCount: Number(epoch.transactionCount ?? 0n),
      epoch: Number(epoch.epoch),
      slotIndex: Number(epoch.slotIndex),
      slotsInEpoch: Number(epoch.slotsInEpoch),
      tps: sampleSeconds ? Number(transactions) / sampleSeconds : 0,
      nonVoteTps: sampleSeconds ? Number(nonVoteTransactions) / sampleSeconds : 0,
      samples: samples
        .map((sample) => ({
          slot: Number(sample.slot),
          tps: Number(sample.numTransactions) / sample.samplePeriodSecs,
        }))
        .reverse(),
      updatedAt: new Date().toISOString(),
    }
  },
)

export const Route = createFileRoute('/')({
  loader: async () => {
    const [snapshot, featureActivations] = await Promise.all([
      getNetworkSnapshot(),
      getFeatureActivations(),
    ])
    return { ...snapshot, featureActivations }
  },
  component: Home,
})

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

function Home() {
  const initialSnapshot = Route.useLoaderData()
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [refreshing, setRefreshing] = useState(false)
  const [connectionState, setConnectionState] = useState<'live' | 'reconnecting'>('live')
  const requestInFlight = useRef(false)
  const mounted = useRef(true)
  const epochProgress = (snapshot.slotIndex / snapshot.slotsInEpoch) * 100
  const maxTps = Math.max(...snapshot.samples.map((sample) => sample.tps), 1)

  const refresh = useCallback(async (full = true, manual = false) => {
    if (requestInFlight.current) return

    requestInFlight.current = true
    if (manual) setRefreshing(true)
    try {
      if (full) {
        const [nextSnapshot, featureActivations] = await Promise.all([
          getNetworkSnapshot(),
          getFeatureActivations(),
        ])
        if (mounted.current) {
          setSnapshot({ ...nextSnapshot, featureActivations })
        }
      } else {
        const liveSnapshot = await getLiveNetworkSnapshot()
        if (mounted.current) {
          setSnapshot((current) => ({ ...current, ...liveSnapshot }))
        }
      }
      if (mounted.current) setConnectionState('live')
    } catch {
      // Preserve the last good values while the next poll tries to reconnect.
      if (mounted.current) setConnectionState('reconnecting')
    } finally {
      requestInFlight.current = false
      if (mounted.current && manual) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true

    const updateLiveMetrics = () => {
      if (document.visibilityState === 'visible') void refresh(false)
    }
    const liveTimer = window.setInterval(updateLiveMetrics, 2_000)
    const fullTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(true)
    }, 30_000)

    document.addEventListener('visibilitychange', updateLiveMetrics)
    void refresh(false)

    return () => {
      mounted.current = false
      window.clearInterval(liveTimer)
      window.clearInterval(fullTimer)
      document.removeEventListener('visibilitychange', updateLiveMetrics)
    }
  }, [refresh])

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Alpenglow dashboard home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <path d="m3 24 8.2-14 4.2 7L20 8l9 16H3Z" />
              <path className="sun" d="M24 4v4M18.5 6l2 2M29.5 6l-2 2" />
            </svg>
          </span>
          <span>Alpenglow</span>
        </a>
        <div className="header-actions">
          <span className={`network-pill ${connectionState}`} aria-live="polite"><i /> Mainnet beta · {connectionState === 'live' ? 'Live' : 'Reconnecting'}</span>
          <button className="refresh-button" onClick={() => void refresh(true, true)} disabled={refreshing}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 9A7 7 0 0 1 18 6l2 2M17.9 15A7 7 0 0 1 6 18l-2-2" /></svg>
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">Solana consensus observatory</p>
            <h1>Network clarity,<br /><em>at a glance.</em></h1>
            <p className="intro">Live mainnet health and the path toward Alpenglow consensus, powered by Solana web3.js.</p>
          </div>
          <div className="orb" aria-hidden="true"><span /></div>
        </section>

        <section className="metric-grid" aria-label="Network metrics">
          <Metric label="Current slot" value={integer.format(snapshot.slot)} detail="Confirmed" />
          <Metric label="Network TPS" value={integer.format(snapshot.tps)} detail={`${integer.format(snapshot.nonVoteTps)} non-vote`} />
          <Metric label="Active validators" value={integer.format(snapshot.activeValidators)} detail={`${snapshot.delinquentValidators} delinquent`} />
          <Metric label="Active stake" value={`${compact.format(snapshot.activeStakeSol)} SOL`} detail={`${snapshot.delinquentStakePercent.toFixed(3)}% delinquent`} />
        </section>

        <section className="dashboard-grid">
          <article className="panel epoch-panel">
            <div className="panel-heading">
              <div><p className="panel-kicker">Epoch progress</p><h2>Epoch {snapshot.epoch}</h2></div>
              <span className="percentage">{epochProgress.toFixed(1)}%</span>
            </div>
            <div className="progress-track"><span style={{ width: `${epochProgress}%` }} /></div>
            <div className="progress-labels"><span>{integer.format(snapshot.slotIndex)} slots complete</span><span>{integer.format(snapshot.slotsInEpoch - snapshot.slotIndex)} remaining</span></div>
          </article>

          <article className="panel protocol-panel">
            <div className="panel-heading">
              <div><p className="panel-kicker">Feature account</p><h2>Activation status</h2></div>
            </div>
            <FeatureActivationTable states={snapshot.featureActivations} />
          </article>

          <article className="panel performance-panel">
            <div className="panel-heading">
              <div><p className="panel-kicker">Throughput</p><h2>Recent performance</h2></div>
              <span className="chart-legend"><i /> Transactions / sec</span>
            </div>
            <div className="bar-chart" aria-label="Recent TPS samples">
              {snapshot.samples.map((sample) => (
                <div className="bar-column" key={sample.slot} title={`${integer.format(sample.tps)} TPS at slot ${integer.format(sample.slot)}`}>
                  <span style={{ height: `${Math.max((sample.tps / maxTps) * 100, 4)}%` }} />
                </div>
              ))}
            </div>
            <div className="chart-axis"><span>6 min ago</span><span>Now</span></div>
          </article>

          <article className="panel details-panel">
            <p className="panel-kicker">Network details</p>
            <dl>
              <div><dt>Block height</dt><dd>{integer.format(snapshot.blockHeight)}</dd></div>
              <div><dt>Total transactions</dt><dd>{compact.format(snapshot.transactionCount)}</dd></div>
              <div><dt>Core version</dt><dd>v{snapshot.coreVersion}</dd></div>
              <div><dt>Feature set</dt><dd>{snapshot.featureSet}</dd></div>
            </dl>
          </article>
        </section>
      </main>

      <footer>
        <span>Data from Solana mainnet-beta</span>
        <span>Updated {new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · Live updates every 2s</span>
      </footer>
    </div>
  )
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="metric"><p>{label}</p><strong>{value}</strong><span>{detail}</span></article>
}

function FeatureActivationTable({ states }: { states: FeatureActivation[] }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!states.some((state) => state.status === 'coming')) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [states])

  return (
    <table className="activation-table">
      <thead><tr><th>Network</th><th>Status</th></tr></thead>
      <tbody>
        {states.map((state) => {
          const activated = state.status === 'activated' ||
            (state.status === 'coming' && state.estimatedActivationAt <= now)
          return (
            <tr key={state.cluster}>
              <th scope="row">{state.cluster}</th>
              <td className={activated ? 'activated' : state.status}>
                <i aria-hidden="true" />
                {activated
                  ? 'Activated'
                  : state.status === 'not-set'
                    ? 'Not set'
                    : <>Coming in Epoch {state.activationEpoch}<small>{formatCountdown(state.estimatedActivationAt - now)}</small></>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function formatCountdown(milliseconds: number) {
  let seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const days = Math.floor(seconds / 86_400)
  seconds %= 86_400
  const hours = Math.floor(seconds / 3_600)
  seconds %= 3_600
  const minutes = Math.floor(seconds / 60)
  seconds %= 60
  return `${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds`
}
