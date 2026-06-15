"""ECG classification and 12-lead derivation for the Trackit ML service."""

import numpy as np
import neurokit2 as nk

SAMPLING_RATE = 360
MIN_SAMPLES = 500
LEAD_LENGTH = 500

# Frontal-plane projection ratios used to derive Lead I and Lead III from
# Lead II. Chosen so that Lead I + Lead III == Lead II (Einthoven's law).
LEAD_I_RATIO = 0.7
LEAD_III_RATIO = 1.0 - LEAD_I_RATIO

# Precordial leads capture horizontal-plane vectors that cannot be derived
# from frontal-plane limb leads by any formula. These ratios are a stylised
# approximation of normal R-wave progression (small/negative in V1-V2,
# growing to a dominant R wave by V5-V6), applied to Lead II so every lead
# still resembles a plausible ECG trace.
PRECORDIAL_RATIOS = {
    "V1": -0.3,
    "V2": -0.1,
    "V3": 0.2,
    "V4": 0.5,
    "V5": 0.8,
    "V6": 0.9,
}


def _to_fixed_length(signal: np.ndarray, length: int = LEAD_LENGTH) -> np.ndarray:
    if len(signal) >= length:
        return signal[:length]
    return np.pad(signal, (0, length - len(signal)))


def derive_leads(signal: list[float]) -> dict[str, list[float]]:
    lead_ii = _to_fixed_length(np.asarray(signal, dtype=float))

    lead_i = LEAD_I_RATIO * lead_ii
    lead_iii = lead_ii - lead_i  # Einthoven's law: II = I + III

    avr = -(lead_i + lead_ii) / 2.0       # Goldberger: aVR = -(I + II) / 2
    avl = lead_i - lead_ii / 2.0          # aVL = (I - III) / 2 == I - II/2
    avf = lead_ii - lead_i / 2.0          # aVF = (II + III) / 2 == II - I/2

    leads = {
        "I": lead_i,
        "II": lead_ii,
        "III": lead_iii,
        "aVR": avr,
        "aVL": avl,
        "aVF": avf,
    }
    for name, ratio in PRECORDIAL_RATIOS.items():
        leads[name] = ratio * lead_ii

    return {name: values.tolist() for name, values in leads.items()}


def classify(signal: list[float]) -> tuple[str, float]:
    signal_arr = np.asarray(signal, dtype=float)

    if len(signal_arr) < MIN_SAMPLES:
        return "Unavailable", 0.0

    try:
        cleaned = nk.ecg_clean(signal_arr, sampling_rate=SAMPLING_RATE)
        _, info = nk.ecg_peaks(cleaned, sampling_rate=SAMPLING_RATE)
        rpeaks = info["ECG_R_Peaks"]
    except Exception:
        return "Unavailable", 0.0

    if len(rpeaks) < 2:
        return "Chaotic", 0.2

    rr_intervals = np.diff(rpeaks) / SAMPLING_RATE  # seconds
    mean_rr = float(np.mean(rr_intervals))
    std_rr = float(np.std(rr_intervals))

    if mean_rr <= 0:
        return "Chaotic", 0.2

    cv = std_rr / mean_rr
    heart_rate = 60.0 / mean_rr

    # Extreme variability -> peaks were found but the rhythm makes no sense
    if cv > 0.5 or not np.isfinite(heart_rate):
        confidence = round(min(0.4, 0.2 + 0.01 * len(rpeaks)), 2)
        return "Chaotic", confidence

    if cv > 0.15:
        confidence = round(min(0.95, 0.5 + (cv - 0.15) * 2), 2)
        return "Atrial Fibrillation", confidence

    regularity = max(0.0, 1.0 - cv / 0.15)

    if heart_rate > 100:
        confidence = round(min(0.95, 0.6 + 0.3 * regularity), 2)
        return "Tachycardia", confidence

    if heart_rate < 60:
        confidence = round(min(0.95, 0.6 + 0.3 * regularity), 2)
        return "Bradycardia", confidence

    confidence = round(0.7 + 0.25 * regularity, 2)
    return "Normal", confidence


def analyse(signal: list[float]) -> dict:
    classification, confidence = classify(signal)
    return {
        "classification": classification,
        "confidence": confidence,
        "leads": derive_leads(signal),
    }
