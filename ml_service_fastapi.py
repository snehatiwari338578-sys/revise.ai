"""
ReviseAI — Priority Prediction Service (future upgrade path)

This is a drop-in replacement for the explainable rule-based engine that ships
in the frontend MVP (see computePriority() in ReviseAI.jsx). Point the frontend
at POST /predict and it can stop calculating scores locally.

Run locally:
    pip install fastapi uvicorn scikit-learn pandas joblib --break-system-packages
    uvicorn ml_service_fastapi:app --reload --port 8000

IMPORTANT: this predicts *revision priority* (how urgently a topic needs
review), not exam outcomes or grades.
"""

from fastapi import FastAPI
from pydantic import BaseModel, Field
from typing import Literal
import numpy as np

app = FastAPI(title="ReviseAI Priority Prediction Service", version="0.1.0")

DIFFICULTY_MAP = {"Easy": 0.3, "Medium": 0.65, "Hard": 1.0}
WEIGHTAGE_MAP = {"Low": 0.3, "Medium": 0.65, "High": 1.0}


class TopicFeatures(BaseModel):
    marks_percentage: float = Field(..., ge=0, le=100)
    confidence_level: int = Field(..., ge=1, le=10)
    days_until_exam: int = Field(..., ge=0)
    days_since_revision: int = Field(..., ge=0)
    difficulty: Literal["Easy", "Medium", "Hard"]
    topic_weightage: Literal["Low", "Medium", "High"]
    revision_count: int = Field(0, ge=0)
    incorrect_answers: int = Field(0, ge=0)


class PredictionResponse(BaseModel):
    priority_score: int
    priority_level: Literal["HIGH", "MEDIUM", "LOW"]
    reasons: list[str]


def featurize(t: TopicFeatures) -> np.ndarray:
    return np.array([[
        t.marks_percentage,
        t.confidence_level,
        t.days_until_exam,
        min(t.days_since_revision, 60),
        DIFFICULTY_MAP[t.difficulty],
        WEIGHTAGE_MAP[t.topic_weightage],
        t.revision_count,
        t.incorrect_answers,
    ]])


# ----------------------------------------------------------------------------
# MODEL LOADING
#
# For the MVP this uses the same explainable weighted-sum heuristic as the
# frontend (so behavior is consistent whichever layer computes it). To swap
# in a trained RandomForestRegressor:
#
#   import joblib
#   model = joblib.load("priority_model.joblib")
#   score = float(model.predict(featurize(t))[0])
#
# Train it on historical (features -> actual revision urgency / outcome)
# pairs collected from real usage, with the same 8 input columns as above.
# ----------------------------------------------------------------------------
def heuristic_score(t: TopicFeatures) -> float:
    weak_marks = np.clip(100 - t.marks_percentage, 0, 100)
    low_confidence = np.clip((10 - t.confidence_level) * 10, 0, 100)
    exam_urgency = np.clip(100 - t.days_until_exam * 3.2, 0, 100)
    staleness = np.clip(min(t.days_since_revision, 30) * 3.3, 0, 100)
    difficulty_score = DIFFICULTY_MAP[t.difficulty] * 100
    weightage_score = WEIGHTAGE_MAP[t.topic_weightage] * 100
    error_rate = np.clip(t.incorrect_answers * 8, 0, 100)
    practice_gap = np.clip(100 - min(t.revision_count, 6) * 16.6, 0, 100)

    return (
        weak_marks * 0.22
        + low_confidence * 0.18
        + exam_urgency * 0.16
        + staleness * 0.14
        + difficulty_score * 0.10
        + weightage_score * 0.10
        + error_rate * 0.06
        + practice_gap * 0.04
    )


def explain(t: TopicFeatures) -> list[str]:
    reasons = []
    if t.marks_percentage < 60:
        reasons.append(f"Previous score is low ({t.marks_percentage:.0f}%)")
    if t.confidence_level <= 5:
        reasons.append(f"Confidence is only {t.confidence_level}/10")
    if t.days_until_exam <= 10:
        reasons.append(f"Exam is approaching ({t.days_until_exam} days away)")
    if t.topic_weightage == "High":
        reasons.append("Topic carries high exam weightage")
    if t.days_since_revision >= 7:
        reasons.append(f"Not revised in {t.days_since_revision} days")
    if t.difficulty == "Hard":
        reasons.append("Topic is rated hard")
    if t.incorrect_answers >= 3:
        reasons.append(f"Missed {t.incorrect_answers} quiz questions on this topic")
    if not reasons:
        reasons.append("Topic is in good shape for now")
    return reasons[:5]


@app.post("/predict", response_model=PredictionResponse)
def predict(t: TopicFeatures):
    score = int(round(np.clip(heuristic_score(t), 0, 100)))
    level = "HIGH" if score >= 75 else "MEDIUM" if score >= 45 else "LOW"
    return PredictionResponse(priority_score=score, priority_level=level, reasons=explain(t))


@app.get("/health")
def health():
    return {"status": "ok"}
