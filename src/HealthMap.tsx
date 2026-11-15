import {Component, Suspense, useEffect, useMemo, useRef, useState} from 'react'
import type {ComponentRef, ReactNode, RefObject} from 'react'
import {Canvas, useFrame, useThree} from '@react-three/fiber'
import type {ThreeEvent} from '@react-three/fiber'
import {OrbitControls, useGLTF, useProgress} from '@react-three/drei'
import * as THREE from 'three'
import {ArrowLeft, Brain, Eye, EyeOff, HeartPulse, Info, Layers3, RotateCcw, Waves, Wind, X} from 'lucide-react'
import type {Checkin, Telemetry} from './types'
import {ANATOMY_LABELS} from './anatomyLabels'
import './HealthMap.css'
type SystemId = 'heart' | 'respiratory' | 'circulation' | 'fatigue'
type Layer = 'skin' | 'skeleton' | 'muscles' | 'organs' | 'vessels' | 'nerves'
type Selection = {
  system: SystemId | null
  structure: string | null
  source: 'system' | 'click'
  nonce: number
}
type FlyGoal = {
  target: THREE.Vector3
  distance: number
  direction: THREE.Vector3 | null
}
type SystemDefinition = {
  id: SystemId
  label: string
  summary: string
  structures: string[]
}
type Props = {
  onBack: () => void
  crewName: string
  telemetry: Telemetry | null
  source: 'Simulated' | 'API'
  cabinCo2: number
  checkin: Checkin | null
}
const MODEL_URL: string = import.meta.env.VITE_ANATOMY_MODEL_URL || '/models/anatomy-male.glb'
const INITIAL_TARGET: [number, number, number] = [0, 0.95, 0]
const INITIAL_DISTANCE = 3.3
const INITIAL_DIRECTION = new THREE.Vector3(0, 0.04, 1).normalize()
const FRONT_DIRECTION = new THREE.Vector3(0.18, 0.06, 1).normalize()
const LAYERS: {id: Layer, label: string}[] = [
  {id: 'skin', label: 'Skin'},
  {id: 'skeleton', label: 'Skeleton'},
  {id: 'muscles', label: 'Muscles'},
  {id: 'organs', label: 'Organs'},
  {id: 'vessels', label: 'Vessels'},
  {id: 'nerves', label: 'Nerves'}
]
const DEFAULT_VISIBILITY: Record<Layer, boolean> = {
  skin: true,
  skeleton: true,
  muscles: false,
  organs: true,
  vessels: true,
  nerves: false
}
const SYSTEMS: SystemDefinition[] = [
  {id: 'heart', label: 'Heart / Cardiac', summary: 'The heart pumps blood around the body. AstroVitals relates it to heart rate and heart rate variability.', structures: ['heart', 'coronary_arteries']},
  {id: 'respiratory', label: 'Respiratory', summary: 'The lungs and airway exchange oxygen and carbon dioxide. AstroVitals relates them to breathing rate, blood oxygen and cabin CO₂.', structures: ['lung_l', 'lung_r', 'trachea', 'bronchi']},
  {id: 'circulation', label: 'Circulatory', summary: 'Arteries and veins carry blood to and from tissues. AstroVitals relates them to blood pressure, pulse and cardiovascular stress.', structures: ['aorta', 'arteries_thorax', 'veins_thorax', 'vena_cava_superior', 'vena_cava_inferior', 'pulmonary_vessels', 'carotid_l', 'carotid_r']},
  {id: 'fatigue', label: 'Fatigue / Cognitive', summary: 'Fatigue is not an organ. The brain is shown only as a navigation marker; readings come from sleep, activity and voluntary check-ins, not from any brain scan.', structures: ['brain', 'cerebellum', 'brainstem']}
]
const SYSTEM_COLORS: Record<SystemId, string> = {
  heart: '#E8707E',
  respiratory: '#6FD0E8',
  circulation: '#B58AD6',
  fatigue: '#E0A96D'
}
const SYSTEM_OF: Record<string, SystemId> = {}
for (const system of SYSTEMS) {
  for (const name of system.structures) {
    SYSTEM_OF[name] = system.id
  }
}
function formatReading(value: number | null | undefined, digits = 0) {
  return value == null ? 'Unavailable' : value.toFixed(digits)
}
function layerOf(object: THREE.Object3D): Layer | null {
  let current: THREE.Object3D | null = object
  while (current) {
    const match = LAYERS.find((layer) => layer.id === current?.name)
    if (match) {
      return match.id
    }
    current = current.parent
  }
  return null
}
function createMaterials() {
  const make = (color: string, opacity: number, emissive = '#000000', intensity = 0) =>
    new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: intensity,
      roughness: 0.55,
      metalness: 0.05,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1
    })
  const layers: Record<Layer, THREE.MeshStandardMaterial> = {
    skin: make('#B8E3F0', 0.15, '#B8E3F0', 0.35),
    skeleton: make('#DCEBF2', 0.5),
    muscles: make('#7C9BB2', 0.45),
    organs: make('#7FA9BE', 0.3),
    vessels: make('#6C94B2', 0.3),
    nerves: make('#A9B6D9', 1)
  }
  const highlight = make('#F5F75E', 1, '#F5F75E', 0.6)
  const systems: Record<SystemId, THREE.MeshStandardMaterial> = {
    heart: make(SYSTEM_COLORS.heart, 1),
    respiratory: make(SYSTEM_COLORS.respiratory, 1),
    circulation: make(SYSTEM_COLORS.circulation, 1),
    fatigue: make(SYSTEM_COLORS.fatigue, 1)
  }
  return {layers, highlight, systems}
}
function prettyName(key: string) {
  return ANATOMY_LABELS[key]?.label ?? key.replaceAll('_', ' ')
}
class ModelBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false}
  static getDerivedStateFromError() {
    return {failed: true}
  }
  render() {
    return this.state.failed
      ? <div className="map-error" role="alert">The 3D anatomy model could not be loaded. Check that public/models/anatomy-male.glb exists, then reload.</div>
      : this.props.children
  }
}
function Anatomy({visibility, selection, goalRef, onReveal, onSelect}: {
  visibility: Record<Layer, boolean>
  selection: Selection | null
  goalRef: RefObject<FlyGoal | null>
  onReveal: (layers: Layer[]) => void
  onSelect: (structure: string) => void
}) {
  const gltf = useGLTF(MODEL_URL, false, true)
  const visibilityRef = useRef(visibility)
  const model = useMemo(() => {
    const root = gltf.scene.clone(true)
    const {layers, highlight, systems} = createMaterials()
    const entries = new Map<string, {mesh: THREE.Mesh, layer: Layer, base: THREE.MeshStandardMaterial}>()
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return
      }
      const layer = layerOf(object)
      if (!layer) {
        return
      }
      const system = SYSTEM_OF[object.name]
      const base = system ? systems[system] : layers[layer]
      object.material = base
      if (layer === 'skin' || !system) {
        object.raycast = () => undefined
      }
      entries.set(object.name, {mesh: object, layer, base})
    })
    return {root, layers, systems, highlight, entries}
  }, [gltf.scene])
  useEffect(() => {
    return () => {
      Object.values(model.layers).forEach((material) => material.dispose())
      Object.values(model.systems).forEach((material) => material.dispose())
      model.highlight.dispose()
    }
  }, [model])
  useEffect(() => {
    visibilityRef.current = visibility
    model.entries.forEach((entry) => {
      entry.mesh.visible = visibility[entry.layer]
    })
  }, [model, visibility])
  useEffect(() => {
    const names = new Set<string>()
    if (selection?.structure) {
      names.add(selection.structure)
    } else if (selection?.system) {
      SYSTEMS.find((system) => system.id === selection.system)?.structures.forEach((name) => names.add(name))
    }
    const hidden = new Set<Layer>()
    const box = new THREE.Box3()
    model.entries.forEach((entry, name) => {
      const selected = names.has(name)
      entry.mesh.material = selected ? model.highlight : entry.base
      if (selected) {
        box.union(new THREE.Box3().setFromObject(entry.mesh))
        if (!visibilityRef.current[entry.layer]) {
          hidden.add(entry.layer)
        }
      }
    })
    if (hidden.size > 0) {
      onReveal([...hidden])
    }
    if (selection && !box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3())
      goalRef.current = {
        target: box.getCenter(new THREE.Vector3()),
        distance: Math.min(Math.max(Math.max(size.x, size.y, size.z) * 3, 1.1), 3),
        direction: selection.source === 'system' ? FRONT_DIRECTION.clone() : null
      }
    }
  }, [model, selection, goalRef, onReveal])
  function handleClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()
    const hit = event.intersections.find((item) => item.object.visible && SYSTEM_OF[item.object.name] !== undefined)
    if (hit) {
      onSelect(hit.object.name)
    }
  }
  return <primitive object={model.root} onClick={handleClick}/>
}
function CameraRig({goalRef, controlsRef}: {
  goalRef: RefObject<FlyGoal | null>
  controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>
}) {
  const camera = useThree((state) => state.camera)
  useFrame((_, delta) => {
    const goal = goalRef.current
    const controls = controlsRef.current
    if (!goal || !controls) {
      return
    }
    if (!goal.direction) {
      goal.direction = camera.position.clone().sub(controls.target).normalize()
    }
    const desired = goal.target.clone().addScaledVector(goal.direction, goal.distance)
    const blend = 1 - Math.exp(-6 * Math.min(delta, 0.05))
    controls.target.lerp(goal.target, blend)
    camera.position.lerp(desired, blend)
    if (camera.position.distanceTo(desired) < 0.003 && controls.target.distanceTo(goal.target) < 0.003) {
      camera.position.copy(desired)
      controls.target.copy(goal.target)
      goalRef.current = null
    }
    controls.update()
  })
  return null
}
function Readings({system, telemetry, cabinCo2, checkin}: {
  system: SystemId
  telemetry: Telemetry | null
  cabinCo2: number
  checkin: Checkin | null
}) {
  const bloodPressure = telemetry?.systolic == null || telemetry.diastolic == null
    ? 'Unavailable'
    : `${telemetry.systolic}/${telemetry.diastolic} mmHg`
  const unit = (value: number | null | undefined, suffix: string, digits = 0) =>
    value == null ? 'Unavailable' : `${formatReading(value, digits)} ${suffix}`
  const rows: [string, string][] = system === 'heart'
    ? [['Heart rate', unit(telemetry?.heartRate, 'bpm')], ['Heart rate variability', unit(telemetry?.hrv, 'ms')]]
    : system === 'respiratory'
      ? [['Respiratory rate', unit(telemetry?.respiratoryRate, 'breaths/min')], ['Blood oxygen (SpO₂)', unit(telemetry?.spo2, '%')], ['Cabin CO₂ (simulated)', `${cabinCo2.toFixed(1)} mmHg`]]
      : system === 'circulation'
        ? [['Blood pressure', bloodPressure], ['Pulse', unit(telemetry?.heartRate, 'bpm')], ['Cardiovascular stress', unit(telemetry?.cardioStress, '/ 100')]]
        : [
          ['Sleep duration', unit(telemetry?.sleepHours, 'h', 1)],
          ['Activity index', unit(telemetry?.activity, '/ 100')],
          ['Check-in fatigue', checkin ? `${checkin.fatigue} / 5` : 'No check-in'],
          ['Check-in stress', checkin ? `${checkin.stress} / 5` : 'No check-in']
        ]
  return (
    <div className="map-readings">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong className={value === 'Unavailable' || value === 'No check-in' ? 'unavailable' : ''}>{value}</strong>
        </div>
      ))}
    </div>
  )
}
function LoadingOverlay() {
  const {active, progress} = useProgress()
  return active ? <div className="map-loading" role="status">Loading anatomy model… {Math.round(progress)}%</div> : null
}
function SystemIcon({system}: {system: SystemId}) {
  if (system === 'heart') {
    return <HeartPulse size={18}/>
  }
  if (system === 'respiratory') {
    return <Wind size={18}/>
  }
  if (system === 'circulation') {
    return <Waves size={18}/>
  }
  return <Brain size={18}/>
}
export default function HealthMap({onBack, crewName, telemetry, source, cabinCo2, checkin}: Props) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [visibility, setVisibility] = useState<Record<Layer, boolean>>(DEFAULT_VISIBILITY)
  const [showLayers, setShowLayers] = useState(false)
  const goalRef = useRef<FlyGoal | null>(null)
  const controlsRef = useRef<ComponentRef<typeof OrbitControls> | null>(null)
  const nonce = useRef(0)
  const system = SYSTEMS.find((item) => item.id === selection?.system) ?? null
  const structureKey = selection?.structure ?? null
  const category = structureKey ? ANATOMY_LABELS[structureKey]?.category : null
  function chooseSystem(id: SystemId) {
    nonce.current += 1
    setSelection(selection?.system === id && selection.source === 'system'
      ? null
      : {system: id, structure: null, source: 'system', nonce: nonce.current})
  }
  function chooseStructure(name: string) {
    nonce.current += 1
    setSelection({system: SYSTEM_OF[name], structure: name, source: 'click', nonce: nonce.current})
  }
  function resetView() {
    setSelection(null)
    goalRef.current = {target: new THREE.Vector3(...INITIAL_TARGET), distance: INITIAL_DISTANCE, direction: INITIAL_DIRECTION.clone()}
  }
  const reveal = useMemo(() => (layers: Layer[]) => {
    setVisibility((current) => {
      const next = {...current}
      layers.forEach((layer) => {
        next[layer] = true
      })
      return next
    })
  }, [])
  const initialPosition = useMemo(() => {
    const position = INITIAL_DIRECTION.clone().multiplyScalar(INITIAL_DISTANCE)
    position.y += INITIAL_TARGET[1]
    return position.toArray()
  }, [])
  return (
    <main className="health-map">
      <header className="map-topbar">
        <button className="map-button" aria-label="Back to dashboard" onClick={onBack}>
          <ArrowLeft size={17}/>
          <span>Dashboard</span>
        </button>
        <div className="map-title">
          <h1>3D Health Map</h1>
          <span>{crewName}</span>
        </div>
        <button className="map-button" aria-label="Reset View" onClick={resetView}>
          <RotateCcw size={17}/>
          <span>Reset View</span>
        </button>
      </header>
      <section className="map-stage" aria-label="Interactive human anatomy">
        <LoadingOverlay/>
        <div className="map-canvas">
          <ModelBoundary>
            <Canvas camera={{position: initialPosition, fov: 35, near: 0.05, far: 50}} dpr={[1, 2]}>
              <color attach="background" args={['#101D35']}/>
              <ambientLight intensity={1.1}/>
              <hemisphereLight args={['#dff3fa', '#1a2b4a', 1]}/>
              <directionalLight position={[2, 4, 4]} intensity={2}/>
              <directionalLight position={[-3, 2, -3]} intensity={0.8} color="#B8E3F0"/>
              <Suspense fallback={null}>
                <Anatomy visibility={visibility} selection={selection} goalRef={goalRef} onReveal={reveal} onSelect={chooseStructure}/>
              </Suspense>
              <OrbitControls
                ref={controlsRef}
                target={INITIAL_TARGET}
                enablePan={false}
                enableDamping
                dampingFactor={0.1}
                rotateSpeed={0.7}
                zoomSpeed={0.8}
                minDistance={0.4}
                maxDistance={6}
                onStart={() => {
                  goalRef.current = null
                }}
              />
              <CameraRig goalRef={goalRef} controlsRef={controlsRef}/>
            </Canvas>
          </ModelBoundary>
        </div>
        <aside className="map-left">
          <div className="map-card">
            <div className="map-card-heading">MONITORED SYSTEMS</div>
            {SYSTEMS.map((item) => (
              <button
                key={item.id}
                className={selection?.system === item.id ? 'map-system active' : 'map-system'}
                aria-pressed={selection?.system === item.id}
                onClick={() => chooseSystem(item.id)}
              >
                <span className="map-dot" style={{backgroundColor: SYSTEM_COLORS[item.id]}}/>
                {item.label}
              </button>
            ))}
          </div>
          <div className="map-card">
            <button className="map-layers-toggle" aria-expanded={showLayers} onClick={() => setShowLayers((value) => !value)}>
              <Layers3 size={16}/>
              Anatomy layers
            </button>
            {showLayers && (
              <div className="map-layer-list">
                {LAYERS.map((layer) => (
                  <button
                    key={layer.id}
                    aria-pressed={visibility[layer.id]}
                    onClick={() => setVisibility((current) => ({...current, [layer.id]: !current[layer.id]}))}
                  >
                    {visibility[layer.id] ? <Eye size={15}/> : <EyeOff size={15}/>}
                    {layer.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
        {selection && system ? (
          <aside className="map-info" aria-live="polite">
            <button className="map-close" aria-label="Close information panel" onClick={() => setSelection(null)}>
              <X size={18}/>
            </button>
            <div className="map-info-heading">
              <SystemIcon system={system.id}/>
              <h2>{structureKey ? prettyName(structureKey) : system.label}</h2>
            </div>
            {structureKey && (
              <p className="map-meta">
                {category ?? 'Anatomy'} · {system.label}
              </p>
            )}
            <p>{system.summary}</p>
            <Readings system={system.id} telemetry={telemetry} cabinCo2={cabinCo2} checkin={checkin}/>
            <div className="map-note">
              <Info size={13}/>
              <span>{source === 'API' ? 'Source: Python API telemetry' : 'Source: simulated demo telemetry'} · Decision support only · Not a diagnosis</span>
            </div>
          </aside>
        ) : (
          <aside className="map-legend">
            <strong>Select a structure or system</strong>
            <span>Drag to rotate · Scroll or pinch to zoom · Click a coloured organ or vessel</span>
            <span>The skeleton and organs are illustrative. No fracture or disease detection is performed.</span>
          </aside>
        )}
      </section>
      <footer className="map-credit">
        Anatomy: BodyParts3D © The Database Center for Life Science (CC BY 4.0); female organs: Human Reference Atlas 3D Reference Organs, HuBMAP (CC BY 4.0); female body: MakeHuman (CC0). Modified by <a href="https://github.com/MervinR07/open-anatomy-3d" target="_blank" rel="noreferrer">open-anatomy-3d</a>, CC BY 4.0. Recoloured and rendered translucent for AstroVitals. Educational visualisation, not for diagnosis.
      </footer>
    </main>
  )
}