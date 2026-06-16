from typing import Generator, Optional
from fastapi import Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.core.tenant import get_current_tenant_id
from app.modules.tenancy.models import User
from app.core.security import decode_access_token

def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def require_tenant_id(request: Request) -> int:
    """ERP modules that are always tenant-scoped (payroll, CRM, etc.)."""
    tenant_id = getattr(request.state, "tenant_id", None)
    if tenant_id is None:
        raise HTTPException(
            status_code=400,
            detail="Tenant not resolved. Select a company in the header switcher (use domain e.g. localhost or master).",
        )
    return tenant_id


def get_tenant_id(request: Request) -> Optional[int]:
    """Get tenant ID from request state (set by middleware), including the dev/demo tenant with domain 'master'."""
    tenant_id = getattr(request.state, "tenant_id", None)
    # For superadmin, allow None tenant_id (will be handled in get_current_user)
    # Check if this is a superadmin request by checking token
    if not tenant_id:
        # Check if token indicates superadmin
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                from app.core.security import decode_access_token
                token = auth_header.split(" ")[1]
                payload = decode_access_token(token)
                if payload and payload.get("is_superadmin"):
                    # Superadmin can work without tenant context
                    return None
            except:
                pass
        # For regular users, require tenant
        raise HTTPException(status_code=400, detail="Tenant not resolved")
    return tenant_id

def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    tenant_id: Optional[int] = Depends(get_tenant_id)
) -> User:
    """Get current authenticated user for the resolved tenant (including domain `master`)."""
    authorization = request.headers.get("Authorization")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    
    token = authorization.split(" ")[1]
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )
    
    user_id = payload.get("sub")
    is_superadmin = payload.get("is_superadmin", False)
    
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload"
        )
    
    # For superadmin, don't filter by tenant_id
    # Also handle case where user_id might be email (for superadmin platform tokens)
    if tenant_id is None or is_superadmin:
        # Try to find user by ID first
        try:
            user = db.query(User).filter(
                User.id == int(user_id),
                User.is_active == True
            ).first()
        except (ValueError, TypeError):
            # If user_id is email (platform token), find by email
            user = db.query(User).filter(
                User.email == user_id,
                User.is_active == True
            ).first()
    else:
        try:
            user = db.query(User).filter(
                User.id == int(user_id),
                User.tenant_id == tenant_id,
                User.is_active == True
            ).first()
        except (ValueError, TypeError):
            # If user_id is email, find by email and tenant
            user = db.query(User).filter(
                User.email == user_id,
                User.tenant_id == tenant_id,
                User.is_active == True
            ).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive"
        )
    
    return user

