"""Domain-level errors surfaced to clients as JSON { "detail": "..." }."""


class StockBusinessError(Exception):
    """Inventory / tank rules that should return HTTP 400 with a clear message."""

    def __init__(self, detail: str):
        self.detail = detail
        super().__init__(detail)


class GlPostingError(StockBusinessError):
    """
    G/L or chart-of-accounts preconditions failed for a subledger+journal operation.

    Catching this at the view layer returns 400; the database transaction (if any) is rolled back.
    """
