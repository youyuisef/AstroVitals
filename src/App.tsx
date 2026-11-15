import {Suspense, lazy, useEffect, useState} from 'react'
import {Activity, AlertTriangle, ArrowLeft, ArrowUpRight, CircleHelp, ClipboardList, Gauge, HeartPulse, Moon, Plus, Radio, Satellite, Scan, ShieldCheck, Thermometer, Wind, X} from 'lucide-react'
import {CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts'
import {API_BASE_URL, fetchCrewHealth} from './api'
import type {CrewHealth} from './api'
import {demoAnalysis, demoStatusFor, demoTelemetryFor, emptyTelemetry, initialCrew, makeTrend, spacecrafts} from './demo'
import type {Analysis, Checkin, CrewMember, DataMode, Range, Status, TrendPoint} from './types'
import './App.css'
const HealthMap = lazy(() => import('./HealthMap'))
type Remote = {
  key: string
  state: 'loading' | 'ok' | 'error'
  data: CrewHealth | null
  error: string
}
const RANGES: Range[] = ['24H', '7D', '30D']
function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}
function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Browser storage may be unavailable
  }
}
function isCheckin(value: unknown): value is Checkin {
  return typeof value === 'object' && value !== null
    && 'fatigue' in value && typeof value.fatigue === 'number'
    && 'stress' in value && typeof value.stress === 'number'
    && 'note' in value && typeof value.note === 'string'
    && 'recorded' in value && typeof value.recorded === 'string'
}
function loadCheckins(): Record<string, Checkin> {
  const raw = readStorage<Record<string, unknown>>('astrovitals-checkins', {})
  const result: Record<string, Checkin> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (isCheckin(value)) {
      result[id] = value
    }
  }
  return result
}
function loadCustomCrew(): CrewMember[] {
  const raw = readStorage<unknown>('astrovitals-crew', [])
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter((item): item is CrewMember => typeof item === 'object' && item !== null
    && 'id' in item && typeof item.id === 'string'
    && 'name' in item && typeof item.name === 'string'
    && 'role' in item && typeof item.role === 'string'
    && 'initials' in item && typeof item.initials === 'string')
}
function newCrewId() {
  return typeof crypto.randomUUID === 'function'
    ? `crew-${crypto.randomUUID()}`
    : `crew-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
function initialsFor(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('')
}
function format(value: number | null, digits = 0) {
  return value === null ? '—' : value.toFixed(digits)
}
function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}
function Avatar({member}: {member: CrewMember}) {
  let hash = 0
  for (const char of member.id) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360
  }
  return (
    <div className="portrait" style={{background: `linear-gradient(150deg, hsl(${200 + hash % 40} 45% 24%), #101D35)`}}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="46" r="19" fill="none" stroke="#B8E3F0" strokeWidth="2" opacity="0.8"/>
        <circle cx="60" cy="46" r="26" fill="none" stroke="#B8E3F0" strokeWidth="1" opacity="0.35"/>
        <path d="M22 118c2-26 17-38 38-38s36 12 38 38z" fill="#B8E3F0" opacity="0.18" stroke="#B8E3F0" strokeWidth="2"/>
      </svg>
      <span>{member.initials}</span>
    </div>
  )
}
function StatusIcon({status}: {status: Status}) {
  if (status === 'Monitoring') {
    return <ShieldCheck size={16}/>
  }
  if (status === 'Review Needed') {
    return <AlertTriangle size={16}/>
  }
  return <CircleHelp size={16}/>
}
function App() {
  const [crew, setCrew] = useState<CrewMember[]>(() => [...initialCrew, ...loadCustomCrew()])
  const [selectedCrewId, setSelectedCrewId] = useState<string | null>(null)
  const [spacecraftId, setSpacecraftId] = useState('orbital')
  const [timeRange, setTimeRange] = useState<Range>('24H')
  const [dataMode, setDataMode] = useState<DataMode>('demo')
  const [showHealthMap, setShowHealthMap] = useState(false)
  const [showAddCrew, setShowAddCrew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('')
  const [remote, setRemote] = useState<Remote | null>(null)
  const [checkins, setCheckins] = useState<Record<string, Checkin>>(loadCheckins)
  const [fatigue, setFatigue] = useState(3)
  const [stress, setStress] = useState(3)
  const [note, setNote] = useState('')
  const selectedCrew = crew.find((member) => member.id === selectedCrewId) ?? null
  const spacecraft = spacecrafts.find((item) => item.id === spacecraftId) ?? spacecrafts[0]
  const requestKey = selectedCrewId ? `${selectedCrewId}|${spacecraftId}` : ''
  useEffect(() => {
    if (dataMode !== 'api' || !selectedCrewId) {
      return
    }
    const key = `${selectedCrewId}|${spacecraftId}`
    const controller = new AbortController()
    setRemote({key, state: 'loading', data: null, error: ''})
    fetchCrewHealth(selectedCrewId, spacecraftId, controller.signal)
      .then((data) => setRemote({key, state: 'ok', data, error: ''}))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setRemote({key, state: 'error', data: null, error: error instanceof Error ? error.message : 'Connection failed'})
        }
      })
    return () => controller.abort()
  }, [dataMode, selectedCrewId, spacecraftId])
  const current = dataMode === 'api' && remote?.key === requestKey ? remote : null
  const live = dataMode === 'api' && current?.state === 'ok' && current.data !== null ? current.data : null
  const loading = dataMode === 'api' && Boolean(selectedCrew) && (current === null || current.state === 'loading')
  const apiError = current?.state === 'error' ? current.error : ''
  const telemetry = selectedCrew
    ? dataMode === 'demo'
      ? demoTelemetryFor(selectedCrew.id, spacecraftId)
      : live?.telemetry ?? emptyTelemetry
    : null
  const analysis: Analysis | null = selectedCrew
    ? dataMode === 'demo'
      ? demoAnalysis(selectedCrew.id)
      : live?.analysis ?? {
        status: 'Data Unavailable',
        anomalyScore: null,
        modelStatus: loading ? 'Connecting to backend' : 'Backend unreachable',
        explanation: loading ? 'Waiting for the backend response.' : 'No analysis is available because the backend request failed. No simulated values are being shown as live data.',
        alerts: [],
        source: 'backend'
      }
    : null
  const trend: TrendPoint[] | null = dataMode === 'demo'
    ? makeTrend(telemetry?.heartRate ?? null, timeRange)
    : live?.trends[timeRange] ?? null
  const sourceLabel = dataMode === 'demo' ? 'Simulated' : 'API'
  const badge = dataMode === 'demo' ? 'DEMO MODE · SIMULATED DATA' : live ? 'LIVE · PYTHON API' : loading ? 'API · CONNECTING' : 'API · NO DATA'
  function addCrewMember() {
    const name = newName.trim()
    if (!name) {
      return
    }
    const member: CrewMember = {id: newCrewId(), name, role: newRole.trim() || 'Crew Member', initials: initialsFor(name) || '?'}
    const custom = [...crew.filter((item) => item.id.startsWith('crew-')), member]
    writeStorage('astrovitals-crew', custom)
    setCrew((previous) => [...previous, member])
    setNewName('')
    setNewRole('')
    setShowAddCrew(false)
    setSelectedCrewId(member.id)
    setTimeRange('24H')
  }
  function exportCsv() {
    if (!selectedCrew || !telemetry) {
      return
    }
    const rows: [string, number | null, string][] = [
      ['heart_rate', telemetry.heartRate, 'bpm'],
      ['sleep_duration', telemetry.sleepHours, 'hours'],
      ['systolic_pressure', telemetry.systolic, 'mmHg'],
      ['diastolic_pressure', telemetry.diastolic, 'mmHg'],
      ['heart_rate_variability', telemetry.hrv, 'ms'],
      ['oxygen_saturation', telemetry.spo2, 'percent'],
      ['activity_index', telemetry.activity, 'index'],
      ['respiratory_rate', telemetry.respiratoryRate, 'breaths_per_min'],
      ['cardiovascular_stress', telemetry.cardioStress, 'index']
    ]
    const lines = [
      'crew_member,spacecraft,data_source,metric,value,unit',
      ...rows.map(([metric, value, unit]) => [csvCell(selectedCrew.name), csvCell(spacecraft.name), dataMode === 'demo' ? 'SIMULATED' : 'PYTHON_API', metric, value ?? '', unit].join(','))
    ]
    const url = URL.createObjectURL(new Blob([lines.join('\n')], {type: 'text/csv;charset=utf-8'}))
    const link = document.createElement('a')
    link.href = url
    link.download = `astrovitals-${selectedCrew.id}-${dataMode === 'demo' ? 'simulated' : 'api'}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  function saveCheckin() {
    if (!selectedCrew) {
      return
    }
    const next = {...checkins, [selectedCrew.id]: {fatigue, stress, note: note.trim(), recorded: new Date().toLocaleString()}}
    setCheckins(next)
    writeStorage('astrovitals-checkins', next)
    setNote('')
  }
  if (showHealthMap) {
    return (
      <Suspense fallback={<div className="map-boot">Loading 3D Health Map…</div>}>
        <HealthMap
          onBack={() => setShowHealthMap(false)}
          crewName={selectedCrew?.name ?? 'Crew overview'}
          telemetry={telemetry}
          source={sourceLabel}
          cabinCo2={spacecraft.co2}
          checkin={selectedCrew ? checkins[selectedCrew.id] ?? null : null}
        />
      </Suspense>
    )
  }
  const missionPicker = (
    <div className="mission-select">
      <Satellite size={19}/>
      <div>
        <label htmlFor="spacecraft-select">SPACECRAFT / MISSION</label>
        <select id="spacecraft-select" value={spacecraftId} onChange={(event) => setSpacecraftId(event.target.value)}>
          {spacecrafts.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </div>
    </div>
  )
  const modeToggle = (
    <label className="backend-toggle">
      <input type="checkbox" checked={dataMode === 'api'} onChange={(event) => setDataMode(event.target.checked ? 'api' : 'demo')}/>
      Use Python API ({API_BASE_URL})
    </label>
  )
  return (
    <main className={selectedCrew ? 'dashboard' : 'crew-home'}>
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <Activity size={24}/>
          <h1>ASTROVITALS</h1>
        </div>
        <span className={dataMode === 'api' && live ? 'demo-badge live' : 'demo-badge'}>{badge}</span>
      </header>
      {!selectedCrew ? (
        <section className="crew-section">
          <h2>Crew</h2>
          <div className="mission-toolbar">
            {missionPicker}
            <div className="mission-toolbar-actions">
              <span>{spacecraft.mission} · simulated scenario</span>
              {modeToggle}
              <button className="action-button primary" onClick={() => setShowAddCrew(true)}>
                <Plus size={17}/>
                Add Crew Member
              </button>
            </div>
          </div>
          <div className="crew-grid">
            {crew.map((member) => {
              const status = demoStatusFor(member.id)
              return (
                <button
                  className="crew-card"
                  key={member.id}
                  onClick={() => {
                    setSelectedCrewId(member.id)
                    setTimeRange('24H')
                  }}
                >
                  <Avatar member={member}/>
                  <div className="card-content">
                    <p className="role">{member.role}</p>
                    <h3>{member.name}</h3>
                    {dataMode === 'demo' ? (
                      <div className="status">
                        <StatusIcon status={status}/>
                        <span>{status}</span>
                        <em>simulated</em>
                      </div>
                    ) : (
                      <div className="status">
                        <CircleHelp size={16}/>
                        <span>Status loads from API</span>
                      </div>
                    )}
                    <div className="card-footer">
                      <span>Open profile</span>
                      <ArrowUpRight size={18}/>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
          <p className="demo-note">Fictional crew and simulated telemetry · Research prototype · Not a medical device</p>
        </section>
      ) : (
        <div className="dashboard-content">
          <div className="dashboard-actions">
            <button className="action-button" onClick={() => setSelectedCrewId(null)}>
              <ArrowLeft size={17}/>
              Change Crew Member
            </button>
            <div className="dashboard-quick-actions">
              <button className="action-button" onClick={exportCsv}>
                <ClipboardList size={16}/>
                Export CSV
              </button>
              <button className="action-button primary" onClick={() => setShowHealthMap(true)}>
                <Scan size={18}/>
                Open 3D Health Map
              </button>
            </div>
          </div>
          <div className="mission-toolbar">
            {missionPicker}
            <div className="mission-toolbar-actions">
              <span>{spacecraft.mission}</span>
              {modeToggle}
            </div>
          </div>
          <h2 className="dashboard-title">{selectedCrew.name}</h2>
          <p className="dashboard-role">{selectedCrew.role}</p>
          <div className="dashboard-welcome">
            <h3>Health overview</h3>
            <div className="dashboard-status">
              <span>MONITORING STATUS · {dataMode === 'demo' ? 'SIMULATED' : 'FROM BACKEND'}</span>
              <strong>{loading ? 'Connecting…' : analysis?.status}</strong>
            </div>
          </div>
          {apiError && (
            <div className="connection-warning" role="alert">
              <AlertTriangle size={18}/>
              <span>API unavailable: {apiError}. No data is being shown for this crew member.</span>
              <button className="action-button" onClick={() => setDataMode('demo')}>Switch to demo mode</button>
            </div>
          )}
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-top"><HeartPulse size={18}/><span>HEART RATE</span></div>
              <div className="metric-value">{format(telemetry?.heartRate ?? null)}<small>BPM</small></div>
            </div>
            <div className="metric-card">
              <div className="metric-top"><Moon size={18}/><span>SLEEP DURATION</span></div>
              <div className="metric-value">{format(telemetry?.sleepHours ?? null, 1)}<small>HOURS</small></div>
            </div>
            <div className="metric-card">
              <div className="metric-top"><Activity size={18}/><span>BLOOD PRESSURE</span></div>
              <div className="metric-value">
                {telemetry?.systolic == null || telemetry.diastolic == null ? '—' : `${telemetry.systolic}/${telemetry.diastolic}`}
                <small>MMHG</small>
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-top"><HeartPulse size={18}/><span>HEART RATE VARIABILITY</span></div>
              <div className="metric-value">{format(telemetry?.hrv ?? null)}<small>MS</small></div>
            </div>
            <div className="metric-card">
              <div className="metric-top"><Wind size={18}/><span>OXYGEN SATURATION</span></div>
              <div className="metric-value">{format(telemetry?.spo2 ?? null)}<small>%</small></div>
            </div>
            <div className="metric-card">
              <div className="metric-top"><Activity size={18}/><span>ACTIVITY INDEX</span></div>
              <div className="metric-value">{format(telemetry?.activity ?? null)}<small>/ 100</small></div>
            </div>
          </div>
          <div className="dashboard-panels">
            <section className="health-panel">
              <div className="panel-heading">
                <h3>Heart rate</h3>
                <div className="time-buttons">
                  {RANGES.map((range) => (
                    <button key={range} className={timeRange === range ? 'active' : ''} aria-pressed={timeRange === range} onClick={() => setTimeRange(range)}>{range}</button>
                  ))}
                </div>
              </div>
              <div className="chart-container">
                {trend?.some((point) => point.heartRate !== null) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend}>
                      <CartesianGrid stroke="#30415B" strokeDasharray="3 3"/>
                      <XAxis dataKey="time" stroke="#829BAE"/>
                      <YAxis stroke="#829BAE" domain={[40, 120]}/>
                      <Tooltip contentStyle={{background: '#101D35', border: '1px solid #30415B', borderRadius: 6}}/>
                      <Line type="monotone" dataKey="heartRate" name="Heart rate (bpm)" stroke="#F5F75E" strokeWidth={2.5} dot={{fill: '#F5F75E'}} connectNulls={false}/>
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-state">
                    {loading ? 'Loading trend…' : dataMode === 'api' ? 'The backend did not provide a trend for this range.' : 'No heart-rate data for this crew member.'}
                  </div>
                )}
              </div>
              <p className="chart-caption">
                {dataMode === 'demo' ? 'Illustrative generated trend. Not historical sensor data or a clinical baseline.' : 'Trend supplied by the Python API.'}
              </p>
            </section>
            <section className="health-panel">
              <div className="panel-heading">
                <h3>Health analysis</h3>
                <span className="analysis-badge">{live ? 'API CONNECTED' : dataMode === 'demo' ? 'DEMO · NO MODEL' : 'NOT CONNECTED'}</span>
              </div>
              <div className="analysis-content">
                <p>{analysis?.explanation}</p>
                <div className="analysis-details">
                  <div>
                    <span>ANOMALY SCORE</span>
                    <strong>{live && analysis?.anomalyScore != null ? analysis.anomalyScore.toFixed(3) : 'Not available'}</strong>
                  </div>
                  <div>
                    <span>MODEL STATUS</span>
                    <strong>{analysis?.modelStatus}</strong>
                  </div>
                  <div>
                    <span>DATA SOURCE</span>
                    <strong>{live ? 'Python API' : dataMode === 'demo' ? 'Simulated demo' : 'None'}</strong>
                  </div>
                </div>
              </div>
            </section>
            <section className="health-panel">
              <div className="panel-heading">
                <h3>Alerts</h3>
                <span className="analysis-badge">{live ? 'MODEL OUTPUT' : 'SIMULATED'}</span>
              </div>
              <div className="alert-content">
                <div className="alert-icon">{analysis?.alerts.length ? <AlertTriangle size={22}/> : <ShieldCheck size={22}/>}</div>
                <div>
                  <h4>{analysis?.alerts.length ? 'Observations to review' : 'No alerts to show'}</h4>
                  {analysis?.alerts.length ? analysis.alerts.map((alert) => <p key={alert}>{alert}</p>) : (
                    <p>{live ? 'The backend returned no alerts. This does not confirm that the crew member is well.' : 'No analysis available. No clinical assessment has been performed.'}</p>
                  )}
                </div>
              </div>
              <p className="alert-disclaimer">Decision support only · Not a medical diagnosis</p>
            </section>
            <section className="health-panel">
              <div className="panel-heading">
                <h3>Cabin conditions</h3>
                <span className="analysis-badge">SIMULATED</span>
              </div>
              <div className="environment-grid">
                <div><Wind size={18}/><span>CO₂</span><strong>{spacecraft.co2.toFixed(1)} mmHg</strong></div>
                <div><Wind size={18}/><span>O₂</span><strong>{spacecraft.oxygen.toFixed(1)} %</strong></div>
                <div><Gauge size={18}/><span>PRESSURE</span><strong>{spacecraft.pressure.toFixed(1)} kPa</strong></div>
                <div><Thermometer size={18}/><span>TEMPERATURE</span><strong>{spacecraft.temperature.toFixed(1)} °C</strong></div>
                <div><Radio size={18}/><span>RADIATION</span><strong>{spacecraft.radiation.toFixed(2)} mSv/day</strong></div>
              </div>
              <p className="chart-caption">Simulated values for {spacecraft.name}. Not measured data.</p>
            </section>
            <section className="health-panel">
              <div className="panel-heading">
                <h3>Daily check-in</h3>
              </div>
              {checkins[selectedCrew.id] ? (
                <div className="checkin-summary">
                  Last check-in: fatigue {checkins[selectedCrew.id].fatigue}/5 · stress {checkins[selectedCrew.id].stress}/5 · {checkins[selectedCrew.id].recorded}
                  {checkins[selectedCrew.id].note && <div>Note: {checkins[selectedCrew.id].note}</div>}
                </div>
              ) : (
                <div className="checkin-summary">No previous check-in for this crew member.</div>
              )}
              <div className="checkin-form">
                <label htmlFor="fatigue-rating">Fatigue<strong>{fatigue}/5</strong></label>
                <input id="fatigue-rating" type="range" min="1" max="5" value={fatigue} onChange={(event) => setFatigue(Number(event.target.value))}/>
                <label htmlFor="stress-rating">Stress<strong>{stress}/5</strong></label>
                <input id="stress-rating" type="range" min="1" max="5" value={stress} onChange={(event) => setStress(Number(event.target.value))}/>
                <label htmlFor="checkin-note">Notes (optional)</label>
                <textarea id="checkin-note" rows={2} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional observation"/>
                <button className="action-button primary" onClick={saveCheckin}>Save check-in</button>
              </div>
            </section>
            <section className="health-panel">
              <div className="panel-heading">
                <h3>3D anatomy</h3>
              </div>
              <p className="panel-text">Explore heart, respiratory, circulatory and fatigue readings on an illustrative anatomical model.</p>
              <button className="action-button primary" onClick={() => setShowHealthMap(true)}>
                <Scan size={18}/>
                Open 3D Health Map
              </button>
            </section>
          </div>
          <p className="demo-note">AstroVitals research prototype · {dataMode === 'demo' ? 'Demonstration readings are synthetic' : 'Readings come from the Python API'} · AI output requires backend integration and independent validation</p>
        </div>
      )}
      {showAddCrew && (
        <div className="crew-modal-backdrop" onClick={() => setShowAddCrew(false)}>
          <div className="crew-modal" role="dialog" aria-modal="true" aria-label="Add crew member" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" aria-label="Close" onClick={() => setShowAddCrew(false)}><X size={22}/></button>
            <h3>Add Crew Member</h3>
            <label htmlFor="new-crew-name">FULL NAME</label>
            <input id="new-crew-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Casey Williams" maxLength={70}/>
            <label htmlFor="new-crew-role">MISSION ROLE</label>
            <input id="new-crew-role" value={newRole} onChange={(event) => setNewRole(event.target.value)} placeholder="e.g. Science Officer" maxLength={70}/>
            <button className="action-button primary" disabled={!newName.trim()} onClick={addCrewMember}>
              <Plus size={18}/>
              Add to Crew
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
export default App