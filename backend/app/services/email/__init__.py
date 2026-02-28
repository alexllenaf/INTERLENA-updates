"""Email services package – split from the original monolithic emails.py.

Re-exports every public symbol so that existing ``from ..services.emails import X``
(via the shim at ``services/emails.py``) continues to work unchanged.
"""

# --- tokens (secure credential storage + sync config) ---
from .tokens import (
    GOOGLE_SEND_TOKEN_ACCOUNT,
    KEYRING_SERVICE_PREFIX,
    resolve_oauth_tokens,
    store_oauth_tokens_secure,
    # Private helpers exposed for sibling modules – not part of the public API
    _delete_token_secure,
    _get_email_sync_config,
    _load_token_secure,
    _save_email_sync_config,
    _save_token_secure,
)

# --- oauth (Google / Microsoft OAuth flows) ---
from .oauth import (
    GOOGLE_GMAIL_SEND_SCOPE,
    GOOGLE_OAUTH_AUTH_URL,
    GOOGLE_OAUTH_REVOKE_URL,
    GOOGLE_OAUTH_TOKEN_URL,
    GOOGLE_SCOPE,
    GOOGLE_USERINFO_URL,
    MICROSOFT_SCOPE,
    build_oauth_authorization_url,
    disconnect_google_send_oauth,
    disconnect_single_google_account,
    exchange_google_code_pkce,
    exchange_oauth_authorization_code,
    fetch_google_user_email,
    get_google_oauth_backend_config,
    get_google_send_email,
    get_valid_google_send_access_token,
    list_google_accounts,
    register_google_account,
    select_google_account,
    store_google_send_tokens_secure,
)

# --- imap (IMAP connection, folders, body fetch) ---
from .imap import (
    fetch_email_body_from_provider,
    get_email_read_stats,
    list_email_metadata_from_provider,
    list_email_provider_folders,
    test_email_provider_connection,
)

# --- sending (Gmail API send, campaigns, templates) ---
from .sending import (
    EMAIL_DAILY_LIMIT,
    EMAIL_DAILY_WARNING_THRESHOLD,
    GMAIL_RETRYABLE_STATUS,
    GMAIL_SEND_ENDPOINT,
    get_email_send_stats,
    list_tracker_contacts_for_email,
    render_email_template,
    send_gmail_campaign,
    send_gmail_message,
    validate_no_header_injection,
    _resolve_google_send_auth,
)

__all__ = [
    # constants
    "GOOGLE_SEND_TOKEN_ACCOUNT",
    "KEYRING_SERVICE_PREFIX",
    "GOOGLE_GMAIL_SEND_SCOPE",
    "GOOGLE_OAUTH_AUTH_URL",
    "GOOGLE_OAUTH_REVOKE_URL",
    "GOOGLE_OAUTH_TOKEN_URL",
    "GOOGLE_SCOPE",
    "GOOGLE_USERINFO_URL",
    "MICROSOFT_SCOPE",
    "EMAIL_DAILY_LIMIT",
    "EMAIL_DAILY_WARNING_THRESHOLD",
    "GMAIL_RETRYABLE_STATUS",
    "GMAIL_SEND_ENDPOINT",
    # tokens
    "resolve_oauth_tokens",
    "store_oauth_tokens_secure",
    # oauth
    "build_oauth_authorization_url",
    "disconnect_google_send_oauth",
    "disconnect_single_google_account",
    "exchange_google_code_pkce",
    "exchange_oauth_authorization_code",
    "fetch_google_user_email",
    "get_google_oauth_backend_config",
    "get_google_send_email",
    "get_valid_google_send_access_token",
    "list_google_accounts",
    "register_google_account",
    "select_google_account",
    "store_google_send_tokens_secure",
    # imap
    "fetch_email_body_from_provider",
    "get_email_read_stats",
    "list_email_metadata_from_provider",
    "list_email_provider_folders",
    "test_email_provider_connection",
    # sending
    "get_email_send_stats",
    "list_tracker_contacts_for_email",
    "render_email_template",
    "send_gmail_campaign",
    "send_gmail_message",
    "validate_no_header_injection",
    "_resolve_google_send_auth",
]
