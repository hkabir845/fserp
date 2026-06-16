from typing import Optional
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.modules.tenancy.models import Tenant
from app.core.config import settings

class TenantContext:
    def __init__(self):
        self.tenant_id: Optional[int] = None
        self.tenant: Optional[Tenant] = None

tenant_context = TenantContext()

def get_tenant_from_request(request: Request, db: Session) -> Optional[Tenant]:
    """Resolve tenant from request host or header"""
    # Check header override (for dev)
    if settings.ALLOW_HEADER_OVERRIDE:
        tenant_id_header = request.headers.get(settings.TENANT_ID_HEADER)
        if tenant_id_header:
            try:
                tenant = db.query(Tenant).filter(Tenant.id == int(tenant_id_header)).first()
                if tenant and tenant.is_active:
                    return tenant
            except (ValueError, TypeError):
                pass
        
        tenant_domain_header = request.headers.get(settings.TENANT_HEADER)
        if tenant_domain_header:
            tenant = db.query(Tenant).filter(Tenant.domain == tenant_domain_header).first()
            if tenant and tenant.is_active:
                return tenant
    
    # Resolve from host
    host = request.headers.get("host", "").split(":")[0]
    if host:
        tenant = db.query(Tenant).filter(Tenant.domain == host).first()
        if tenant and tenant.is_active:
            return tenant
    
    return None

class TenantMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Skip tenant resolution for health check, docs, platform routes, and auth login
        skip_paths = ["/health", "/", "/api/docs", "/api/redoc", "/openapi.json"]
        if request.url.path.startswith("/api/v1/platform"):
            return await call_next(request)
        if request.url.path.startswith("/api/v1/auth/login"):
            # Allow login without tenant context (tenant will be resolved in login handler if needed)
            return await call_next(request)
        if request.url.path.startswith("/api/v1/cards/public"):
            # Public digital business card (resolved by slug; no tenant header required)
            return await call_next(request)
        if request.url.path in skip_paths:
            return await call_next(request)
        
        db = SessionLocal()
        try:
            tenant = get_tenant_from_request(request, db)
            if tenant is None:
                return Response(
                    content='{"detail":"Tenant not found or inactive"}',
                    status_code=404,
                    media_type="application/json"
                )

            tenant_context.tenant_id = tenant.id
            tenant_context.tenant = tenant
            request.state.tenant_id = tenant.id
            request.state.tenant = tenant
            
            response = await call_next(request)
            return response
        finally:
            db.close()

def get_current_tenant_id() -> int:
    """Get current tenant ID from context"""
    if tenant_context.tenant_id is None:
        raise HTTPException(status_code=400, detail="Tenant not resolved")
    return tenant_context.tenant_id

