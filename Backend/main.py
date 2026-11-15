from pathlib import Path
from contextlib import asynccontextmanager
from datetime import datetime
import joblib
import numpy as np
import pandas as pd
import torch
from torch import nn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

ROOT = Path(__file__).resolve().parent


class AutoEncoder(nn.Module):
    def __init__(self, input_dim):
        super().__init__()
        self.encoder = nn.Module()
        self.encoder.net = nn.Sequential(
            nn.Linear(input_dim, 16),
            nn.ReLU(),
            nn.Linear(16, 32),
            nn.ReLU(),
            nn.Linear(32, 32)
        )
        self.decoder = nn.Module()
        self.decoder.net = nn.Sequential(
            nn.Linear(32, 16),
            nn.ReLU(),
            nn.Linear(16, input_dim)
        )

    def forward(self, values):
        return self.decoder.net(self.encoder.net(values))


state = {}


@asynccontextmanager
async def lifespan(app):
    try:
        scaler = joblib.load(ROOT / 'scaler.pkl')
        features = list(scaler.feature_names_in_)
        model = AutoEncoder(len(features))
        weights = torch.load(ROOT / 'model.pt', map_location='cpu', weights_only=True)
        model.load_state_dict(weights, strict=True)
        model.eval()

        telemetry = pd.read_csv(ROOT / 'astronaut_telemetry.csv')
        sleep = pd.read_csv(ROOT / 'astronaut_sleep.csv')
        telemetry['timestamp'] = pd.to_datetime(telemetry['timestamp'])
        telemetry['date'] = telemetry['timestamp'].dt.strftime('%Y-%m-%d')
        sleep['date'] = pd.to_datetime(sleep['date']).dt.strftime('%Y-%m-%d')
        merged = telemetry.merge(
            sleep[['astronaut_id', 'date', 'sleep_duration_hours', 'sleep_quality_score']],
            on=['astronaut_id', 'date'],
            how='left'
        ).sort_values(['astronaut_id', 'timestamp'])
        merged[['sleep_duration_hours', 'sleep_quality_score']] = (
            merged.groupby('astronaut_id')[['sleep_duration_hours', 'sleep_quality_score']]
            .transform(lambda series: series.ffill().bfill())
        )
        state.update(model=model, scaler=scaler, features=features, data=merged)
        print('AstroVitals model loaded successfully on CPU')
    except Exception as error:
        print('AstroVitals backend startup failed:', error)
        raise
    yield
    state.clear()


app = FastAPI(title='AstroVitals API', lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r'http://(localhost|127\.0\.0\.1):517[0-9]+',
    allow_credentials=False,
    allow_methods=['GET'],
    allow_headers=['*']
)


def number(value, digits=1):
    if pd.isna(value):
        return None
    return round(float(value), digits)


def trend(rows):
    return [
        {'time': row['timestamp'].strftime('%d %b %H:%M'), 'heartRate': number(row['heart_rate_bpm'])}
        for _, row in rows.iterrows()
    ]


@app.get('/health')
def health():
    return {'status': 'ok', 'modelLoaded': bool(state.get('model'))}


@app.get('/api/crew/{crew_id}/health')
def crew_health(crew_id: str, spacecraft: str = 'orbital'):
    if spacecraft not in ('orbital', 'lunar', 'mars'):
        raise HTTPException(status_code=400, detail='Unknown spacecraft')
    astronaut_id = f'AST-{int(crew_id):03d}' if crew_id.isdigit() else crew_id
    rows = state['data'].loc[state['data']['astronaut_id'] == astronaut_id]
    if rows.empty:
        raise HTTPException(status_code=404, detail='No dataset records for this crew member')
    latest = rows.iloc[-1]
    features = state['features']
    missing = [column for column in features if column not in rows.columns]
    if missing:
        raise HTTPException(status_code=500, detail=f'Missing model features: {missing}')
    feature_values = pd.DataFrame([latest[features]], columns=features).apply(pd.to_numeric, errors='coerce')
    if feature_values.isna().any().any():
        raise HTTPException(status_code=422, detail='Latest record lacks required model features')
    scaled = state['scaler'].transform(feature_values)
    with torch.no_grad():
        original = torch.tensor(scaled, dtype=torch.float32)
        reconstructed = state['model'](original)
        reconstruction_error = torch.mean(torch.abs(original - reconstructed)).item()

    latest_time = latest['timestamp']
    last_day = rows.loc[rows['timestamp'] >= latest_time - pd.Timedelta(hours=24)]
    last_week = rows.loc[rows['timestamp'] >= latest_time - pd.Timedelta(days=7)]
    last_month = rows.loc[rows['timestamp'] >= latest_time - pd.Timedelta(days=30)]

    def sampled(frame, maximum):
        if len(frame) <= maximum:
            return trend(frame)
        indices = np.linspace(0, len(frame) - 1, maximum, dtype=int)
        return trend(frame.iloc[indices])

    return {
        'telemetry': {
            'heartRate': number(latest['heart_rate_bpm']),
            'sleepHours': number(latest['sleep_duration_hours']),
            'systolic': number(latest['systolic_bp_mmhg']),
            'diastolic': number(latest['diastolic_bp_mmhg']),
            'hrv': number(latest['hrv_rmssd_ms']),
            'spo2': None,
            'activity': None,
            'respiratoryRate': None,
            'cardioStress': None
        },
        'analysis': {
            'status': 'Monitoring',
            'anomalyScore': round(reconstruction_error, 5),
            'modelStatus': 'Trained autoencoder inference (CPU); uncalibrated reconstruction error',
            'explanation': (
                'The existing trained autoencoder calculated a mean absolute reconstruction error '
                'on a historical SYNTHETIC dataset record. This score has no validated anomaly '
                'threshold, so Monitoring means data is available, not medically normal. '
                'The selected spacecraft is a UI scenario and does not change these dataset records.'
            ),
            'alerts': [],
            'source': 'backend'
        },
        'trends': {
            '24H': sampled(last_day, 24),
            '7D': sampled(last_week, 28),
            '30D': sampled(last_month, 30)
        }
    }
