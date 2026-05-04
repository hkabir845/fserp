from app.database import SessionLocal
from app.models.user import User, UserRole
from app.utils.security import get_password_hash

session = SessionLocal()
try:
    user = session.query(User).filter_by(username='admin').first()
    if user:
        user.hashed_password = get_password_hash('admin123')
        user.role = UserRole.ADMIN
        if user.company_id is None:
            user.company_id = 1
        print('updated admin user')
    else:
        user = User(
            username='admin',
            email='admin@example.com',
            full_name='System Admin',
            role=UserRole.ADMIN,
            hashed_password=get_password_hash('admin123'),
            company_id=1
        )
        session.add(user)
        print('created admin user')
    session.commit()
finally:
    session.close()
