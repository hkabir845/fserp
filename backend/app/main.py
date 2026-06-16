from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.tenant import TenantMiddleware
from app.api.v1 import api_router

app = FastAPI(
    title="Multi-Tenant ERP API",
    description="Domain-based multi-tenant ERP for Agri/Feed/Flour/Transport business",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# Middleware: last registered runs first (outermost). CORSMiddleware must be outermost so
# every response—including short-circuited ones from TenantMiddleware—gets CORS headers.
app.add_middleware(TenantMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ALLOW_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=settings.CORS_ALLOW_HEADERS,
    expose_headers=["*"],
)

# Include API router
app.include_router(api_router, prefix="/api/v1")

@app.get("/")
async def root():
    return {"message": "Multi-Tenant ERP API", "version": "1.0.0"}

@app.get("/health")
async def health():
    return {"status": "healthy"}

