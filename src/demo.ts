import type {Analysis, CrewMember, Range, Spacecraft, Status, Telemetry, TrendPoint} from './types'
export const initialCrew: CrewMember[] = [
  {id: '1', name: 'Alex Morgan', role: 'Commander', initials: 'AM'},
  {id: '2', name: 'Jordan Lee', role: 'Flight Engineer', initials: 'JL'},
  {id: '3', name: 'Sam Rivera', role: 'Mission Specialist', initials: 'SR'},
  {id: '4', name: 'Taylor Chen', role: 'Medical Officer', initials: 'TC'}
]
export const spacecrafts: Spacecraft[] = [
  {id: 'orbital', name: 'Orbital Research Station', mission: 'Low Earth Orbit', co2: 3.2, oxygen: 20.9, pressure: 101.3, temperature: 22.4, radiation: 0.42},
  {id: 'lunar', name: 'Lunar Gateway', mission: 'Lunar Orbit', co2: 4.8, oxygen: 20.7, pressure: 100.8, temperature: 23.1, radiation: 0.81},
  {id: 'mars', name: 'Mars Transit Vehicle', mission: 'Deep Space Transit', co2: 5.6, oxygen: 20.6, pressure: 100.4, temperature: 21.8, radiation: 1.24}
]
export const emptyTelemetry: Telemetry = {
  heartRate: null,
  sleepHours: null,
  systolic: null,
  diastolic: null,
  hrv: null,
  spo2: null,
  activity: null,
  respiratoryRate: null,
  cardioStress: null
}
const demoProfiles: Record<string, Telemetry> = {
  '1': {heartRate: 72, sleepHours: 7.4, systolic: 118, diastolic: 76, hrv: 58, spo2: 98, activity: 74, respiratoryRate: 14, cardioStress: 22},
  '2': {heartRate: 91, sleepHours: 5.6, systolic: 136, diastolic: 87, hrv: 34, spo2: 97, activity: 48, respiratoryRate: 18, cardioStress: 61},
  '3': {heartRate: 66, sleepHours: 8.1, systolic: 114, diastolic: 72, hrv: 65, spo2: 99, activity: 86, respiratoryRate: 13, cardioStress: 15},
  '4': emptyTelemetry
}
const demoStatuses: Record<string, Status> = {
  '1': 'Monitoring',
  '2': 'Review Needed',
  '3': 'Monitoring',
  '4': 'Data Unavailable'
}
export function demoTelemetryFor(crewId: string, spacecraftId: string): Telemetry {
  const base = demoProfiles[crewId] ?? emptyTelemetry
  if (base.heartRate === null) {
    return base
  }
  const shift = spacecraftId === 'mars' ? 3 : spacecraftId === 'lunar' ? 1 : 0
  return {
    ...base,
    heartRate: base.heartRate + shift,
    spo2: base.spo2 === null ? null : base.spo2 - (shift > 2 ? 1 : 0)
  }
}
export function demoStatusFor(crewId: string): Status {
  const base = demoProfiles[crewId] ?? emptyTelemetry
  return base.heartRate === null ? 'Data Unavailable' : demoStatuses[crewId] ?? 'Monitoring'
}
export function demoAnalysis(crewId: string): Analysis {
  const status = demoStatusFor(crewId)
  return {
    status,
    anomalyScore: null,
    modelStatus: 'Not connected (demo mode)',
    explanation: 'Demo mode: no autoencoder inference has been performed. The status shown is a fictional scenario, not a clinical or AI assessment.',
    alerts: status === 'Review Needed'
      ? ['Simulated observation: sleep and cardiovascular readings differ from the fictional reference scenario.']
      : status === 'Data Unavailable'
        ? ['Simulated telemetry unavailable for this crew member.']
        : [],
    source: 'demo'
  }
}
export function makeTrend(heartRate: number | null, range: Range): TrendPoint[] {
  const labels = range === '24H'
    ? ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00']
    : range === '7D'
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      : ['Week 1', 'Week 2', 'Week 3', 'Week 4']
  const offsets = range === '24H'
    ? [-6, -9, 2, 9, 4, -3]
    : range === '7D'
      ? [-4, 1, 3, -2, 6, 2, -1]
      : [-3, 2, -1, 4]
  return labels.map((time, index) => ({
    time,
    heartRate: heartRate === null ? null : heartRate + offsets[index]
  }))
}