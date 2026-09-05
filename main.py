"""Standalone FastAPI + SQLite version of FareIndex.

Run locally with:
    python main.py

The React/Vite dashboard and Netlify Function use the same API contract. The
standalone service is intentionally dependency-light for local demos and
deployments that prefer a Python process.
"""

from __future__ import annotations

import random
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Generator

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

BASE_DIR = Path(__file__).resolve().parent
DATABASE_URL = f"sqlite:///{BASE_DIR / 'fareindex.db'}"
STATIC_DIR = BASE_DIR / "static"
STATIC_TEMPLATE = STATIC_DIR / "index.template.html"
STATIC_INDEX = STATIC_DIR / "index.html"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


class Route(Base):
    __tablename__ = "routes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    origin: Mapped[str] = mapped_column(String(80), nullable=False)
    destination: Mapped[str] = mapped_column(String(80), nullable=False)
    weight: Mapped[float] = mapped_column(Float, nullable=False)
    base_fare: Mapped[float] = mapped_column(Float, nullable=False)
    observations: Mapped[list["FareObservation"]] = relationship(back_populates="route")


class FareObservation(Base):
    __tablename__ = "fare_observations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    route_id: Mapped[int] = mapped_column(ForeignKey("routes.id"), nullable=False)
    fare: Mapped[float] = mapped_column(Float, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    booking_window: Mapped[str] = mapped_column(String(20), default="T-30", nullable=False)
    observed_date: Mapped[date] = mapped_column(Date, nullable=False)
    route: Mapped[Route] = relationship(back_populates="observations")


class IndexHistory(Base):
    __tablename__ = "index_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    observed_date: Mapped[date] = mapped_column(Date, unique=True, nullable=False)
    index_value: Mapped[float] = mapped_column(Float, nullable=False)


Base.metadata.create_all(engine)


def ensure_static_index() -> None:
    if STATIC_INDEX.exists() or not STATIC_TEMPLATE.exists():
        return
    open_tag = "<" + "scr" + "ipt"
    close_tag = "</" + "scr" + "ipt>"
    script = (
        f'{open_tag} src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js">{close_tag}'
        f"{open_tag}>"
        "async function load() {"
        "const points = await fetch('/api/index').then(response => response.json());"
        "new Chart(document.getElementById('chart'), {"
        "type:'line', data:{labels:points.map(point=>point.date),datasets:[{label:'FareIndex',data:points.map(point=>point.indexValue),borderColor:'#45d5bb',backgroundColor:'rgba(69,213,187,.15)',fill:true,tension:.35}]},"
        "options:{scales:{y:{ticks:{color:'#9cb1c2'}},x:{ticks:{color:'#9cb1c2'}}},plugins:{legend:{labels:{color:'#f5f7fa'}}}}"
        "});"
        "}"
        "document.getElementById('scrape').onclick = async () => { await fetch('/api/trigger-scrape', {method:'POST'}); location.reload(); };"
        "load();"
        f"{close_tag}"
    )
    STATIC_INDEX.write_text(
        STATIC_TEMPLATE.read_text().replace("<!-- FAREINDEX_STATIC_SCRIPT -->", script),
        encoding="utf-8",
    )


ensure_static_index()


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session


def calculate_index(routes: list[Route], fares: list[float]) -> float:
    return sum(
        route.weight * (fare / route.base_fare)
        for route, fare in zip(routes, fares)
    ) * 100


def seed_database(session: Session) -> None:
    if session.scalar(select(Route.id).limit(1)) is not None:
        return

    routes = [
        Route(code="DEL-BOM", origin="Delhi", destination="Mumbai", weight=0.50, base_fare=5000),
        Route(code="BLR-DEL", origin="Bengaluru", destination="Delhi", weight=0.35, base_fare=4000),
        Route(code="BOM-GOI", origin="Mumbai", destination="Goa", weight=0.15, base_fare=3000),
    ]
    session.add_all(routes)
    session.flush()
    factors = [
        (1.00, 1.00, 1.00),
        (1.02, 0.99, 1.03),
        (1.04, 1.01, 1.05),
        (1.03, 1.03, 1.07),
        (1.07, 1.05, 1.09),
        (1.08, 1.07, 1.11),
        (1.10, 1.09, 1.13),
    ]
    start = date.today() - timedelta(days=6)
    for offset, factor_set in enumerate(factors):
        observed_date = start + timedelta(days=offset)
        fares = [round(route.base_fare * factor_set[index]) for index, route in enumerate(routes)]
        for route, fare in zip(routes, fares):
            session.add(FareObservation(
                route_id=route.id,
                fare=fare,
                timestamp=datetime.now(timezone.utc),
                booking_window="T-30",
                observed_date=observed_date,
            ))
        session.add(IndexHistory(
            timestamp=datetime.now(timezone.utc),
            observed_date=observed_date,
            index_value=calculate_index(routes, fares),
        ))
    session.commit()


def serialize_observation(observation: FareObservation) -> dict:
    route = observation.route
    return {
        "id": observation.id,
        "route": route.code,
        "origin": route.origin,
        "destination": route.destination,
        "fare": observation.fare,
        "date": observation.observed_date.isoformat(),
        "bookingWindow": observation.booking_window,
        "isBase": observation.observed_date == date.today() - timedelta(days=6),
    }


class IndexPoint(BaseModel):
    date: date
    indexValue: float
    changePercent: float
    isLatest: bool


class ScrapeResult(BaseModel):
    date: date
    indexValue: float
    message: str
    observations: list[dict]


app = FastAPI(title="FareIndex API", description="Laspeyres airfare inflation tracker")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/index", response_model=list[IndexPoint])
def get_index(session: Session = Depends(get_db)) -> list[IndexPoint]:
    seed_database(session)
    history = list(session.scalars(select(IndexHistory).order_by(IndexHistory.observed_date)))
    return [
        IndexPoint(
            date=item.observed_date,
            indexValue=round(item.index_value, 2),
            changePercent=0 if index == 0 else round(
                (item.index_value - history[index - 1].index_value)
                / history[index - 1].index_value * 100, 2
            ),
            isLatest=index == len(history) - 1,
        )
        for index, item in enumerate(history)
    ]


@app.get("/api/raw-data")
def get_raw_data(session: Session = Depends(get_db)) -> list[dict]:
    seed_database(session)
    observations = list(session.scalars(
        select(FareObservation)
        .join(FareObservation.route)
        .order_by(FareObservation.observed_date.desc(), FareObservation.id.asc())
    ))
    return [serialize_observation(observation) for observation in observations]


@app.post("/api/trigger-scrape", response_model=ScrapeResult)
def trigger_scrape(session: Session = Depends(get_db)) -> ScrapeResult:
    seed_database(session)
    routes = list(session.scalars(select(Route).order_by(Route.id)))
    latest = session.scalar(select(IndexHistory).order_by(IndexHistory.observed_date.desc()))
    next_date = latest.observed_date + timedelta(days=1)
    fares: list[float] = []
    for route in routes:
        festival_surge = 1.4 if random.random() < 0.15 else 1
        fare = round(route.base_fare * (1 + random.uniform(-0.05, 0.05)) * festival_surge)
        fares.append(fare)
        session.add(FareObservation(
            route_id=route.id,
            fare=fare,
            timestamp=datetime.now(timezone.utc),
            booking_window="T-30",
            observed_date=next_date,
        ))
    index_value = calculate_index(routes, fares)
    session.add(IndexHistory(
        timestamp=datetime.now(timezone.utc),
        observed_date=next_date,
        index_value=index_value,
    ))
    session.commit()
    observations = list(session.scalars(
        select(FareObservation)
        .where(FareObservation.observed_date == next_date)
        .order_by(FareObservation.id)
    ))
    return ScrapeResult(
        date=next_date,
        indexValue=round(index_value, 2),
        message="New route fares captured and the index was recalculated.",
        observations=[serialize_observation(observation) for observation in observations],
    )


@app.get("/api/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)