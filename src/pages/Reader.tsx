import { useCallback, useEffect, useRef, useState } from 'react'
import { useCamera } from '../hooks/useCamera'
import { useFaceLandmarker } from '../hooks/useFaceLandmarker'
import {
  HeartRateEstimator,
  type BvpMethod,
  type HeartRateState,
} from '../lib/heartRate'
import {
  FOREHEAD_RING,
  LEFT_CHEEK_RING,
  RIGHT_CHEEK_RING,
  sampleCheekRgb,
} from '../lib/roi'
import { LandmarkFilter } from '../lib/landmarkFilter'
import Footer from '../components/Footer'
import HeartIcon from '../components/HeartIcon'
import SignalPlot from '../components/SignalPlot'
import FFTPlot from '../components/FFTPlot'

const INITIAL_HR_STATE: HeartRateState = {
  bpm: 0,
  snr: 0,
  valid: false,
  fps: 0,
  warmup: 0,
  signal: new Float64Array(0),
  fft: new Float64Array(0),
  freqsBpm: new Float64Array(0),
  stableBpm: 0,
  stableReadable: false,
  framesSinceValid: Infinity,
  method: 'POS',
  rr: 0,
  rrSnr: 0,
  rrValid: false,
  spo2: 0,
  spo2Valid: false,
  spo2Trend: 'stable',
}

export default function Reader() {
  const camera = useCamera()
  const landmarker = useFaceLandmarker()
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const samplingCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const estimatorRef = useRef<HeartRateEstimator>(new HeartRateEstimator())
  // Alpha-Beta filter over the 478 face-mesh landmarks. Absorbs per-frame
  // jitter in landmark positions so the polygon ROIs don't wiggle pixel
  // by pixel (which would leak into the BVP as noise).
  const landmarkFilterRef = useRef<LandmarkFilter>(new LandmarkFilter())

  const [faceDetected, setFaceDetected] = useState(false)
  const [fps, setFps] = useState(0)
  const [hr, setHr] = useState<HeartRateState>(INITIAL_HR_STATE)
  // BVP extractor choice. POS by default; GREEN exists so a user can A/B
  // against the pre-Apr-2026 behavior on their own face. Swapping resets
  // the estimator because the two methods' signal shapes differ.
  const [method, setMethodState] = useState<BvpMethod>('POS')

  const runLoop = useCallback(() => {
    const video = camera.videoRef.current
    const overlay = overlayCanvasRef.current
    const sampling = samplingCanvasRef.current
    if (!video || !overlay || !sampling || landmarker.status !== 'ready') return

    const overlayCtx = overlay.getContext('2d')
    const samplingCtx = sampling.getContext('2d', { willReadFrequently: true })
    if (!overlayCtx || !samplingCtx) return

    let frameCount = 0
    let lastFpsTick = performance.now()

    const tick = () => {
      if (video.readyState < 2 || video.videoWidth === 0) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      const vw = video.videoWidth
      const vh = video.videoHeight
      if (overlay.width !== vw) overlay.width = vw
      if (overlay.height !== vh) overlay.height = vh
      if (sampling.width !== vw) sampling.width = vw
      if (sampling.height !== vh) sampling.height = vh

      const now = performance.now()
      const result = landmarker.landmarker.detectForVideo(video, now)
      samplingCtx.drawImage(video, 0, 0, vw, vh)

      overlayCtx.clearRect(0, 0, vw, vh)
      const faces = result.faceLandmarks
      if (faces && faces.length > 0) {
        setFaceDetected(true)
        // Alpha-Beta smooth the landmarks before anything else consumes
        // them — ROI polygons and sampling both benefit.
        const lm = landmarkFilterRef.current.stabilize(faces[0], now)
        drawPolygon(overlayCtx, LEFT_CHEEK_RING, lm, vw, vh)
        drawPolygon(overlayCtx, RIGHT_CHEEK_RING, lm, vw, vh)
        drawPolygon(overlayCtx, FOREHEAD_RING, lm, vw, vh)

        const sample = sampleCheekRgb(lm, samplingCtx, vw, vh)
        if (sample) {
          // pushRegional gives the estimator per-region RGB streams so
          // the per-region SNR-weighted spectrum combination kicks in.
          // Falls back to the old single-stream behavior internally when
          // a region is missing for too many frames.
          const state = estimatorRef.current.pushRegional(sample, now / 1000)
          setHr(state)
        }
      } else {
        setFaceDetected(false)
      }

      frameCount++
      if (now - lastFpsTick > 500) {
        setFps((frameCount * 1000) / (now - lastFpsTick))
        frameCount = 0
        lastFpsTick = now
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [camera.videoRef, landmarker])

  useEffect(() => {
    if (camera.state.status === 'running' && landmarker.status === 'ready') {
      runLoop()
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [camera.state.status, landmarker.status, runLoop])

  const onStart = () => {
    estimatorRef.current.reset()
    landmarkFilterRef.current.reset()
    setHr(INITIAL_HR_STATE)
    camera.start()
  }
  const onStop = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    camera.stop()
    estimatorRef.current.reset()
    landmarkFilterRef.current.reset()
    setFaceDetected(false)
    setFps(0)
    setHr(INITIAL_HR_STATE)
  }

  // Swap camera mid-session: stop the current stream, then ask for the new
  // one. Reset the estimator so the buffer doesn't mix signals from two
  // different sensors.
  const onChangeCamera = (id: string) => {
    camera.setDeviceId(id)
    if (camera.state.status === 'running') {
      estimatorRef.current.reset()
      landmarkFilterRef.current.reset()
      setHr(INITIAL_HR_STATE)
      camera.start(id)
    }
  }

  // Swap BVP extractor. The two methods produce different signal shapes,
  // so we wipe the running buffer and re-fill it under the new method.
  const onChangeMethod = (next: BvpMethod) => {
    setMethodState(next)
    estimatorRef.current.setMethod(next)
    setHr(INITIAL_HR_STATE)
  }

  // Show the stable BPM whenever it's readable — even during brief SNR
  // dips. It only disappears after ~5 seconds without a valid sample.
  const canShowNumber = hr.stableReadable || hr.valid
  const displayBpm = hr.stableReadable
    ? hr.stableBpm
    : hr.valid
      ? hr.bpm
      : 0
  const bpmText = canShowNumber ? displayBpm.toFixed(0) : '--'
  const acquiring = camera.state.status === 'running' && !canShowNumber
  // True when we're showing a held reading but the instantaneous window
  // has dropped out — useful for a softer status note without flapping.
  const holding = hr.stableReadable && !hr.valid

  const statusLine = (() => {
    if (landmarker.status === 'loading') return 'Loading face model…'
    if (landmarker.status === 'error') return `Model error: ${landmarker.error}`
    if (camera.state.status === 'error')
      return `Camera error: ${camera.state.error}`
    if (camera.state.status !== 'running') return 'Camera off'
    if (!faceDetected) return 'Looking for your face…'
    if (acquiring)
      return `Acquiring · SNR ${hr.snr.toFixed(1)} · buffer ${(hr.warmup * 100).toFixed(0)}%`
    if (holding)
      return `Holding reading · reacquiring (SNR ${hr.snr.toFixed(1)})`
    return `Signal locked · SNR ${hr.snr.toFixed(1)}`
  })()

  const isRunning = camera.state.status === 'running'

  const statusTone: 'live' | 'idle' | 'error' =
    camera.state.status === 'error'
      ? 'error'
      : isRunning
        ? 'live'
        : 'idle'

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-20 border-b border-line/80 bg-surface/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 px-4 md:px-8 py-3.5">
          <Logo />
          <div className="flex items-center gap-2 md:gap-3">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink2">
              <LockIcon className="w-3.5 h-3.5 text-pulse" />
              On-device
            </span>
            <StatusPill tone={statusTone} label={isRunning ? 'Live' : 'Idle'} />
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-6 lg:gap-8">
          {/* Video column */}
          <section>
            <div className="relative w-full rounded-3xl overflow-hidden bg-ink shadow-card ring-1 ring-line aspect-[4/3] max-h-[46vh] lg:max-h-none lg:aspect-video">
              <video
                ref={camera.videoRef}
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
              />
              <canvas
                ref={overlayCanvasRef}
                className="absolute inset-0 w-full h-full object-cover scale-x-[-1] pointer-events-none"
              />
              <canvas ref={samplingCanvasRef} className="hidden" />

              {!isRunning && (
                <IdleOverlay
                  onStart={onStart}
                  ready={landmarker.status === 'ready'}
                  error={camera.state.status === 'error' ? camera.state.error : null}
                />
              )}

              {isRunning && (
                <div className="absolute inset-x-0 top-0 p-3 md:p-4 flex items-start justify-between gap-3 pointer-events-none">
                  <div className="rounded-2xl bg-ink/55 backdrop-blur px-3.5 py-2 text-white">
                    <div className="text-[10px] uppercase tracking-widest text-white/60 leading-none mb-1">
                      BPM
                    </div>
                    <div className="text-2xl md:text-3xl font-bold tabular-nums leading-none">
                      {bpmText}
                    </div>
                  </div>
                  <div className="rounded-full bg-ink/55 backdrop-blur px-3 py-1.5 text-[11px] text-white/85">
                    {faceDetected ? 'Face tracked' : 'No face'}
                  </div>
                </div>
              )}

              {acquiring && faceDetected && (
                <div className="absolute bottom-3 left-3 rounded-full bg-pulse/90 text-white text-xs font-medium px-3 py-1.5 backdrop-blur">
                  Hold still · {(hr.warmup * 100).toFixed(0)}%
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {isRunning ? (
                <button
                  onClick={onStop}
                  className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-2.5 text-white font-medium text-sm hover:bg-ink/85 transition"
                >
                  <span className="w-2 h-2 rounded-[2px] bg-white" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={onStart}
                  disabled={landmarker.status !== 'ready'}
                  className="inline-flex items-center gap-2 rounded-full bg-pulse px-6 py-2.5 text-white font-medium text-sm shadow-float hover:bg-pulse2 transition disabled:opacity-50"
                >
                  <PlayIcon className="w-4 h-4" />
                  {landmarker.status === 'ready' ? 'Start measurement' : 'Preparing…'}
                </button>
              )}

              {camera.devices.length > 1 && camera.deviceId && (
                <select
                  value={camera.deviceId}
                  onChange={(e) => onChangeCamera(e.target.value)}
                  className="rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink hover:border-pulse/40 transition"
                >
                  {camera.devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
              )}

              {/* BVP method A/B toggle. POS (default) is the chrominance-based
                  extractor from Wang 2017; GREEN is the pre-Apr-2026 baseline
                  kept as an escape hatch. Swapping wipes the signal buffer. */}
              <label className="inline-flex items-center gap-2 text-xs font-medium text-ink2">
                Algorithm
                <select
                  value={method}
                  onChange={(e) => onChangeMethod(e.target.value as BvpMethod)}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink hover:border-pulse/40 transition"
                  title="Pure: POS / CHROM / GREEN. Hybrids average z-scored BVPs."
                >
                  <option value="POS">POS</option>
                  <option value="CHROM">CHROM</option>
                  <option value="OMIT">OMIT</option>
                  <option value="GREEN">GREEN</option>
                  <option value="POS+CHROM">POS + CHROM</option>
                  <option value="POS+GREEN">POS + GREEN</option>
                  <option value="CHROM+GREEN">CHROM + GREEN</option>
                  <option value="POS+CHROM+GREEN">POS + CHROM + GREEN</option>
                </select>
              </label>
            </div>
          </section>

          {/* Metrics + plots column */}
          <aside className="flex flex-col gap-5">
            {/* Vitals card — BPM, RR, SpO2 */}
            <div className="rounded-3xl bg-surface shadow-card ring-1 ring-line p-6">
              {/* BPM — primary vital */}
              <div className="flex flex-col items-center">
                <div className="relative flex items-center justify-center mb-2">
                  {hr.valid && (
                    <span className="absolute w-16 h-16 rounded-full border-2 border-heart/40 animate-ring-pulse" />
                  )}
                  <HeartIcon
                    bpm={canShowNumber ? displayBpm : 0}
                    size={34}
                    className={hr.valid ? 'text-heart' : holding ? 'text-heart/50' : 'text-line'}
                  />
                </div>
                <div
                  className={`text-6xl md:text-7xl font-extrabold tabular-nums leading-none tracking-tight ${hr.valid ? 'text-ink' : holding ? 'text-ink/50' : 'text-ink2/30'}`}
                >
                  {bpmText}
                </div>
                <div className="mt-2 text-[11px] font-semibold text-ink2 uppercase tracking-[0.18em]">
                  Heart rate · bpm
                </div>
              </div>

              {/* RR + SpO2 — secondary vitals, side by side */}
              <div className="mt-6 grid grid-cols-2 gap-3 border-t border-line pt-5">
                <VitalTile
                  value={hr.rrValid ? String(Math.round(hr.rr)) : '--'}
                  unit="br/min"
                  label="Respiration"
                  tone="sky"
                  active={hr.rrValid}
                />
                <VitalTile
                  value={hr.spo2Valid ? hr.spo2.toFixed(0) : '--'}
                  unit="%"
                  label="SpO₂"
                  tone="pulse"
                  active={hr.spo2Valid}
                  note={
                    hr.spo2Valid && hr.spo2Trend !== 'stable'
                      ? hr.spo2Trend === 'rising'
                        ? '↑'
                        : '↓'
                      : undefined
                  }
                />
              </div>

              {/* Status line */}
              <div className="mt-5 flex items-center gap-2 rounded-2xl bg-canvas px-3.5 py-2.5 text-xs text-ink2 tabular-nums">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusTone === 'live' ? 'bg-pulse' : statusTone === 'error' ? 'bg-heart' : 'bg-ink2/40'}`}
                />
                <span className="truncate">{statusLine}</span>
              </div>
            </div>

            {/* Plots */}
            <div className="rounded-3xl bg-surface shadow-card ring-1 ring-line p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold text-ink2 uppercase tracking-[0.16em]">
                  Pulse waveform
                </span>
                <span className="text-[10px] text-ink2/60 tabular-nums">
                  {fps.toFixed(0)} fps
                </span>
              </div>
              <SignalPlot signal={hr.signal} />
            </div>

            <div className="rounded-3xl bg-surface shadow-card ring-1 ring-line p-5">
              <div className="text-[11px] font-semibold text-ink2 uppercase tracking-[0.16em] mb-3">
                Frequency spectrum
              </div>
              <FFTPlot
                fft={hr.fft}
                freqsBpm={hr.freqsBpm}
                peakBpm={hr.valid ? hr.bpm : 0}
              />
            </div>
          </aside>
        </div>
      </main>
      <Footer />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Presentational helpers                                              */
/* ------------------------------------------------------------------ */

function IdleOverlay({
  onStart,
  ready,
  error,
}: {
  onStart: () => void
  ready: boolean
  error: string | null
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 bg-gradient-to-b from-ink/70 via-ink/80 to-ink/90">
      <div className="rounded-2xl bg-white/10 p-3.5 mb-4 ring-1 ring-white/15">
        <CameraIcon className="w-7 h-7 text-white" />
      </div>
      <p className="text-white font-semibold text-lg">
        {error ? 'Camera unavailable' : 'Camera is off'}
      </p>
      <p className="mt-1.5 max-w-xs text-sm text-white/70 leading-relaxed">
        {error
          ? error
          : 'Face a light source, keep still, and hold for about 15 seconds to capture your pulse.'}
      </p>
      {!error && (
        <button
          onClick={onStart}
          disabled={!ready}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-pulse px-6 py-2.5 text-white font-medium text-sm shadow-float hover:bg-pulse2 transition disabled:opacity-50"
        >
          <PlayIcon className="w-4 h-4" />
          {ready ? 'Start measurement' : 'Preparing…'}
        </button>
      )}
      <div className="mt-5 flex items-center gap-2 text-[11px] text-white/55">
        <LockIcon className="w-3.5 h-3.5" />
        Video never leaves this device
      </div>
    </div>
  )
}

function VitalTile({
  value,
  unit,
  label,
  tone,
  active,
  note,
}: {
  value: string
  unit: string
  label: string
  tone: 'sky' | 'pulse'
  active: boolean
  note?: string
}) {
  const toneText = tone === 'sky' ? 'text-sky' : 'text-pulse'
  const toneDot = tone === 'sky' ? 'bg-sky' : 'bg-pulse'
  return (
    <div className="rounded-2xl bg-canvas px-3 py-3.5 text-center">
      <div className="flex items-center justify-center gap-1.5 mb-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${toneDot}`} />
        <span className="text-[10px] font-semibold text-ink2 uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className={`text-3xl font-bold tabular-nums leading-none ${active ? toneText : 'text-ink2/30'}`}>
        {value}
        <span className="text-sm font-medium ml-0.5 text-ink2/70">
          {active ? unit : ''}
        </span>
        {note && <span className="text-base ml-1">{note}</span>}
      </div>
    </div>
  )
}

function StatusPill({ tone, label }: { tone: 'live' | 'idle' | 'error'; label: string }) {
  const styles =
    tone === 'live'
      ? 'bg-pulse/10 text-pulse border-pulse/20'
      : tone === 'error'
        ? 'bg-heart/10 text-heart border-heart/20'
        : 'bg-canvas text-ink2 border-line'
  const dot =
    tone === 'live' ? 'bg-pulse' : tone === 'error' ? 'bg-heart' : 'bg-ink2/40'
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${styles}`}
    >
      <span className="relative flex w-2 h-2">
        {tone === 'live' && (
          <span className="absolute inline-flex w-full h-full rounded-full bg-pulse opacity-60 animate-ping" />
        )}
        <span className={`relative inline-flex w-2 h-2 rounded-full ${dot}`} />
      </span>
      {label}
    </span>
  )
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-pulse to-sky shadow-float">
        <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12h3.5l2-6 3.5 12 2.5-8 1.5 4H22" />
        </svg>
      </div>
      <div className="leading-none">
        <div className="text-lg font-extrabold tracking-tight text-ink">
          onebeep
        </div>
        <div className="text-[10px] font-medium text-ink2 tracking-wide mt-0.5">
          contactless vitals
        </div>
      </div>
    </div>
  )
}

function PlayIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />
    </svg>
  )
}

function CameraIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  )
}

function LockIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  indices: number[],
  lm: { x: number; y: number }[],
  w: number,
  h: number
) {
  ctx.beginPath()
  for (let i = 0; i < indices.length; i++) {
    const p = lm[indices[i]]
    const x = p.x * w
    const y = p.y * h
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = 'rgba(13, 148, 136, 0.20)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(13, 148, 136, 0.95)'
  ctx.lineWidth = 2
  ctx.stroke()
}
