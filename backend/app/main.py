from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import users, sessions, orders, market, ws, etf, auth
from .auth import generate_api_key
from .db import init_db, AsyncSessionLocal
from .models.db import User


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await _ensure_admin()
    yield


async def _ensure_admin():
    """Create a default admin user on first start if none exists."""
    from sqlalchemy import select
    from .api.auth import hash_password
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.is_admin == True))
        if not result.scalar_one_or_none():
            admin = User(
                username="admin",
                api_key=generate_api_key(),
                password_hash=hash_password("admin"),
                is_admin=True,
            )
            db.add(admin)
            await db.commit()
            await db.refresh(admin)
            print(f"\n{'='*50}")
            print(f"  Admin created: username=admin  password=admin")
            print(f"{'='*50}\n")


app = FastAPI(
    title="SimuQuant",
    description="Market-making simulation platform",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(orders.router, prefix="/api")
app.include_router(etf.router, prefix="/api")
app.include_router(market.router, prefix="/api")
app.include_router(ws.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "SimuQuant"}
