import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ecg_processor import analyse

app = FastAPI(title="Trackit ML Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictRequest(BaseModel):
    patientId: str
    signal: list[float]


class PredictResponse(BaseModel):
    patientId: str
    classification: str
    confidence: float
    leads: dict[str, list[float]]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    result = analyse(req.signal)
    return {
        "patientId": req.patientId,
        "classification": result["classification"],
        "confidence": result["confidence"],
        "leads": result["leads"],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
