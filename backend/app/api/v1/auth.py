from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import timedelta
from app.core.dependencies import get_db, get_tenant_id, get_current_user
from app.core.security import verify_password, create_access_token
from app.core.config import settings
from app.modules.tenancy.models import User
from pydantic import BaseModel

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

class Token(BaseModel):
    access_token: str
    token_type: str

class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    
    class Config:
        from_attributes = True

@router.post("/login", response_model=Token)
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    """Login endpoint - supports both tenant and platform (superadmin) login"""
    # FastAPI should always inject Request; keep a defensive check to avoid 500s.
    if request is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Request context not available"
        )

    # Check if this is superadmin
    is_superadmin = form_data.username == "superadmin@fmerp.com"
    platform_access = request.headers.get("X-Platform-Access", "false").lower() == "true"
    
    # For superadmin with platform access, create platform token
    if is_superadmin and platform_access:
        # For superadmin platform access, check platform user
        from app.modules.platform.models import PlatformUser
        platform_user = db.query(PlatformUser).filter(
            PlatformUser.email == form_data.username,
            PlatformUser.is_active == True
        ).first()
        
        if platform_user and verify_password(form_data.password, platform_user.hashed_password):
            access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
            access_token = create_access_token(
                data={"sub": platform_user.email, "platform": True, "is_superadmin": True},
                expires_delta=access_token_expires
            )
            return {"access_token": access_token, "token_type": "bearer"}
        
        # If platform user doesn't exist, try to find tenant user and create platform user
        user = db.query(User).filter(
            User.email == form_data.username,
            User.is_active == True
        ).first()
        
        if user and verify_password(form_data.password, user.hashed_password):
            # Create platform user if it doesn't exist
            if not platform_user:
                platform_user = PlatformUser(
                    email=user.email,
                    hashed_password=user.hashed_password,
                    full_name=user.full_name,
                    is_super_admin=True,
                    is_active=True
                )
                db.add(platform_user)
                db.commit()
                db.refresh(platform_user)
            
            access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
            access_token = create_access_token(
                data={"sub": platform_user.email, "platform": True, "is_superadmin": True},
                expires_delta=access_token_expires
            )
            return {"access_token": access_token, "token_type": "bearer"}
    
    # Regular tenant login - but handle superadmin without tenant requirement
    try:
        tenant_id = get_tenant_id(request)
    except HTTPException:
        # If tenant not resolved, check if this is superadmin
        if is_superadmin:
            # For superadmin, find user without tenant filter
            user = db.query(User).filter(
                User.email == form_data.username,
                User.is_active == True
            ).first()
            
            if user and verify_password(form_data.password, user.hashed_password):
                access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
                access_token = create_access_token(
                    data={"sub": str(user.id), "is_superadmin": True},
                    expires_delta=access_token_expires
                )
                return {"access_token": access_token, "token_type": "bearer"}
        raise
    
    user = db.query(User).filter(
        User.email == form_data.username,
        User.tenant_id == tenant_id,
        User.is_active == True
    ).first()
    
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )
    
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": str(user.id), "tenant_id": tenant_id, "is_superadmin": is_superadmin},
        expires_delta=access_token_expires
    )
    
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserResponse)
async def get_current_user(
    request: Request,
    current_user: User = Depends(get_current_user)
):
    """Get current authenticated user"""
    return current_user

