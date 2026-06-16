"""
Platform-level authentication dependencies
"""
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from app.core.dependencies import get_db
from app.modules.platform.models import PlatformUser
from app.core.security import decode_access_token

def get_platform_user(
    request: Request,
    db: Session = Depends(get_db)
) -> PlatformUser:
    """Get current platform user from JWT token - supports superadmin"""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    token = auth_header.split(" ")[1]
    payload = decode_access_token(token)
    
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    # Check if it's a platform token or superadmin
    is_platform = payload.get("platform", False)
    is_superadmin = payload.get("is_superadmin", False)
    user_id = payload.get("sub")
    
    # For superadmin, allow access even with regular token
    if is_superadmin:
        # Find tenant user by ID or email
        from app.modules.tenancy.models import User
        from datetime import datetime
        tenant_user = None
        
        try:
            # Try to find by ID first (for regular tenant tokens)
            tenant_user_id = int(user_id) if user_id else None
            if tenant_user_id:
                tenant_user = db.query(User).filter(User.id == tenant_user_id).first()
        except (ValueError, TypeError):
            pass
        
        # If not found by ID, try by email (for platform tokens or when user_id is email)
        if not tenant_user and user_id:
            tenant_user = db.query(User).filter(User.email == user_id).first()
        
        # If still not found, try to find by email "superadmin@fmerp.com" directly
        if not tenant_user:
            tenant_user = db.query(User).filter(User.email == "superadmin@fmerp.com").first()
        
        if tenant_user and tenant_user.email == "superadmin@fmerp.com":
            # Check if platform user exists, create if not
            platform_user = db.query(PlatformUser).filter(
                PlatformUser.email == tenant_user.email,
                PlatformUser.is_active == True
            ).first()
            
            if not platform_user:
                platform_user = PlatformUser(
                    email=tenant_user.email,
                    hashed_password=tenant_user.hashed_password,
                    full_name=tenant_user.full_name,
                    is_super_admin=True,
                    is_active=True,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(platform_user)
                db.commit()
                db.refresh(platform_user)
            
            return platform_user
    
    # Regular platform token check
    if not is_platform:
        raise HTTPException(status_code=403, detail="Not a platform user")
    
    email = payload.get("sub")
    if not email:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    # Find platform user
    user = db.query(PlatformUser).filter(
        PlatformUser.email == email,
        PlatformUser.is_active == True
    ).first()
    
    if not user:
        raise HTTPException(status_code=401, detail="Platform user not found")
    
    return user

