import { useEffect, useRef } from 'react'

interface Props {
  /** BVP buffer to plot (most recent few seconds of samples). */
  signal: Float64Array
  /** How tall the plot should be in CSS pixels. */
  height?: number
}

// Tiny dep-free line chart on a <canvas>. We redraw on every render —
// Reader re-renders when hr state changes, ~30× per second — and the
// canvas has ~100 data points, so a fresh stroke is cheaper than any
// diffing library would be.
export default function SignalPlot({ signal, height = 120 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, rect.width, rect.height)

    if (signal.length < 2) return

    // Autoscale to max absolute value so the trace always fills the box.
    let peak = 1e-9
    for (let i = 0; i < signal.length; i++) {
      const v = Math.abs(signal[i])
      if (v > peak) peak = v
    }
    const mid = rect.height / 2
    const scale = (rect.height * 0.42) / peak
    const step = rect.width / (signal.length - 1)

    // Faint centerline for a clinical-monitor feel.
    ctx.strokeStyle = 'rgba(90, 107, 123, 0.15)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, mid)
    ctx.lineTo(rect.width, mid)
    ctx.stroke()

    // Filled area under the trace.
    ctx.fillStyle = 'rgba(13, 148, 136, 0.12)'
    ctx.beginPath()
    ctx.moveTo(0, mid)
    for (let i = 0; i < signal.length; i++) {
      ctx.lineTo(i * step, mid - signal[i] * scale)
    }
    ctx.lineTo(rect.width, mid)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = 'rgba(13, 148, 136, 0.95)'
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.beginPath()
    for (let i = 0; i < signal.length; i++) {
      const x = i * step
      const y = mid - signal[i] * scale
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }, [signal])

  return (
    <canvas
      ref={canvasRef}
      style={{ height, width: '100%', display: 'block' }}
    />
  )
}
