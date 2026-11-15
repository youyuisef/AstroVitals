import type {Analysis, Range, Status, Telemetry, TrendPoint, Trends} from './types'
const configuredUrl: unknown = import.meta.env.VITE_API_URL
export const API_BASE_URL = (typeof configuredUrl === 'string' && configuredUrl
  ? configuredUrl
  : 'http://localhost:8000').replace(/\/+$/, '')
export type CrewHealth = {
  telemetry: Telemetry
  analysis: Analysis
  trends: Trends
}
const REQUEST_TIMEOUT_MS = 8000
const STATUSES: Status[] = ['Monitoring', 'Review Needed', 'Data Unavailable']
const RANGES: Range[] = ['24H', '7D', '30D']
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
function parseTelemetry(value: unknown): Telemetry {
  if (!isRecord(value)) {
    throw new Error('Response is missing the telemetry object')
  }
  return {
    heartRate: numberOrNull(value.heartRate),
    sleepHours: numberOrNull(value.sleepHours),
    systolic: numberOrNull(value.systolic),
    diastolic: numberOrNull(value.diastolic),
    hrv: numberOrNull(value.hrv),
    spo2: numberOrNull(value.spo2),
    activity: numberOrNull(value.activity),
    respiratoryRate: numberOrNull(value.respiratoryRate),
    cardioStress: numberOrNull(value.cardioStress)
  }
}
function parseAnalysis(value: unknown): Analysis {
  if (!isRecord(value)) {
    throw new Error('Response is missing the analysis object')
  }
  const status = STATUSES.find((item) => item === value.status)
  if (!status) {
    throw new Error('Response contains an unrecognised status')
  }
  return {
    status,
    anomalyScore: numberOrNull(value.anomalyScore),
    modelStatus: typeof value.modelStatus === 'string' ? value.modelStatus : 'Not reported',
    explanation: typeof value.explanation === 'string' ? value.explanation : 'No explanation was returned by the backend.',
    alerts: Array.isArray(value.alerts)
      ? value.alerts.filter((item): item is string => typeof item === 'string')
      : [],
    source: 'backend'
  }
}
function parseTrends(value: unknown): Trends {
  const trends: Trends = {}
  if (!isRecord(value)) {
    return trends
  }
  for (const range of RANGES) {
    const series = value[range]
    if (!Array.isArray(series)) {
      continue
    }
    const points: TrendPoint[] = []
    for (const item of series) {
      if (isRecord(item) && typeof item.time === 'string') {
        points.push({time: item.time, heartRate: numberOrNull(item.heartRate)})
      }
    }
    trends[range] = points
  }
  return trends
}
export async function fetchCrewHealth(
  crewId: string,
  spacecraftId: string,
  signal: AbortSignal
): Promise<CrewHealth> {
  const timeout = new AbortController()
  const timer = window.setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS)
  const onAbort = () => timeout.abort()
  signal.addEventListener('abort', onAbort)
  try {
    const url = `${API_BASE_URL}/api/crew/${encodeURIComponent(crewId)}/health?spacecraft=${encodeURIComponent(spacecraftId)}`
    const response = await fetch(url, {signal: timeout.signal})
    if (!response.ok) {
      throw new Error(`Backend returned HTTP ${response.status}`)
    }
    const body: unknown = await response.json()
    if (!isRecord(body)) {
      throw new Error('Backend response is not a JSON object')
    }
    return {
      telemetry: parseTelemetry(body.telemetry),
      analysis: parseAnalysis(body.analysis),
      trends: parseTrends(body.trends)
    }
  } catch (error) {
    if (timeout.signal.aborted && !signal.aborted) {
      throw new Error('Backend did not respond in time')
    }
    throw error instanceof Error ? error : new Error('Connection failed')
  } finally {
    window.clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}