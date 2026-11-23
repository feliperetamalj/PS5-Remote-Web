// Gráficos del panel admin con Chart.js (empaquetado en el sitio; la CSP no permite CDN).
import { useEffect, useRef } from 'react'
import {
  Chart, BarController, BarElement, CategoryScale, LinearScale, DoughnutController, ArcElement,
  LineController, LineElement, PointElement, Tooltip, Legend,
} from 'chart.js'
import type { ChartConfiguration } from 'chart.js'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, DoughnutController, ArcElement, LineController, LineElement, PointElement, Tooltip, Legend)
Chart.defaults.color = '#a3a8c9'
Chart.defaults.borderColor = 'rgba(255,255,255,0.08)'
Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif'
Chart.defaults.plugins.legend.labels.usePointStyle = true

export const SERIES = ['#6ea0ff', '#a78bfa', '#f0abfc', '#4ade80', '#fbbf24', '#fb7185']

/** `summary` es el texto alternativo: el canvas no es legible para lectores de pantalla. */
export function ChartBox({ config, summary, height = 240 }: { config: ChartConfiguration; summary: string; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const chart = useRef<Chart | null>(null)
  const key = JSON.stringify(config.data)

  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    chart.current = new Chart(canvas.current!, { ...config, options: { responsive: true, maintainAspectRatio: false, animation: reduced ? false : undefined, ...config.options } })
    return () => chart.current?.destroy()
  }, [])
  // El panel se refresca cada 5 s: solo se redibuja si los datos cambiaron, y sin animación.
  useEffect(() => {
    if (!chart.current) return
    chart.current.data = config.data
    chart.current.update('none')
  }, [key])

  return <div style={{ height }}><canvas ref={canvas} role="img" aria-label={summary} /></div>
}
