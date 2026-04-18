"""Domain-level errors surfaced to clients as JSON { "detail": "..." }."""


class StockBusinessError(Exception):
    """Inventory / tank rules that should return HTTP 400 with a clear message."""

    def __init__(self, detail: str):
        self.detail = detail
        super().__init__(detail)
