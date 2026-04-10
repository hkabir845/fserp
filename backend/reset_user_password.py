import argparse
import sys

from app.database import SessionLocal
from app.models.user import User, UserRole
from app.utils.security import get_password_hash


def reset_password(username: str, password: str, role: str) -> None:
    session = SessionLocal()
    try:
        user = session.query(User).filter_by(username=username).one_or_none()
        try:
            resolved_role = UserRole(role)
        except ValueError as exc:
            print(f"Invalid role '{role}': {exc}", file=sys.stderr)
            session.rollback()
            return

        if user is None:
            user = User(
                username=username,
                email=f"{username}@example.com",
                full_name=username.replace("_", " ").title(),
                hashed_password=get_password_hash(password),
                role=resolved_role,
            )
            session.add(user)
            session.commit()
            print(f"Created user '{username}' with role '{resolved_role.value}'.")
            return

        user.hashed_password = get_password_hash(password)
        try:
            user.role = resolved_role
        except ValueError as exc:
            print(f"Invalid role '{role}': {exc}", file=sys.stderr)
            session.rollback()
            return

        session.commit()
        print(f"Updated user '{username}' successfully.")
    except Exception as exc:  # noqa: BLE001
        session.rollback()
        print(f"Error updating user '{username}': {exc}", file=sys.stderr)
    finally:
        session.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset a user's password.")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--role", required=True, help="Role must match a UserRole enum member.")
    args = parser.parse_args()

    reset_password(args.username, args.password, args.role)


if __name__ == "__main__":
    main()