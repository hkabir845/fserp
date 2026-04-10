from app.database import SessionLocal
from app.models.user import User
from app.utils.security import get_password_hash

session = SessionLocal()
try:
    for username in ("cashier1", "cashier2"):
        user = session.query(User).filter_by(username=username).first()
        if user:
            user.hashed_password = get_password_hash("cashier123")
            user.is_active = True
            print(f"Updated {username}")
        else:
            print(f"User {username} not found")
    session.commit()
finally:
    session.close()
