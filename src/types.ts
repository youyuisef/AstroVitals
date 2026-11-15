export type Status = 'Monitoring' | 'Review Needed' | 'Data Unavailable'
export type Range = '24H' | '7D' | '30D'
export type DataMode = 'demo' | 'api'
export type CrewMember = {
  id: string
  name: string
  role: string
  initials: string
}
export type Spacecraft = {
  id: string
  name: string
  mission: string
  co2: number
  oxygen: number
  pressure: number
  temperature: number
  radiation: number
}
export type Telemetry = {
  heartRate: number | null
  sleepHours: number | null
  systolic: number | null
  diastolic: number | null
  hrv: number | null
  spo2: number | null
  activity: number | null
  respiratoryRate: number | null
  cardioStress: number | null
}
export type Analysis = {
  status: Status
  anomalyScore: number | null
  modelStatus: string
  explanation: string
  alerts: string[]
  source: 'demo' | 'backend'
}
export type TrendPoint = {
  time: string
  heartRate: number | null
}
export type Trends = Partial<Record<Range, TrendPoint[]>>
export type Checkin = {
  fatigue: number
  stress: number
  note: string
  recorded: string
}