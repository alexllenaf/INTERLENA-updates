"""Backward-compatible shim – real code lives in ``services/email/``.

All existing ``from ..services.emails import X`` statements continue
to work unchanged because this module re-exports the full public API.
"""
from .email import *  # noqa: F401,F403
