use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Redirect,
};
use axum_extra::extract::cookie::{Cookie, CookieJar};
use openidconnect::{
    AuthenticationFlow,
    AuthorizationCode, ClientId, ClientSecret, CsrfToken,
    IssuerUrl, Nonce, PkceCodeChallenge, PkceCodeVerifier,
    RedirectUrl, Scope, TokenResponse,
    core::{CoreClient, CoreProviderMetadata, CoreResponseType},
    reqwest::async_http_client,
};
use serde::Deserialize;
use tokio::sync::RwLock;

use crate::auth::SESSION_COOKIE;
use crate::db;
use crate::state::AppState;

// How long OIDC state is kept before we consider it abandoned.
const PENDING_TTL: Duration = Duration::from_secs(600);

struct PendingAuth {
    nonce: Nonce,
    pkce_verifier: PkceCodeVerifier,
    created_at: Instant,
}

pub struct OidcProvider {
    client: CoreClient,
    pending: RwLock<HashMap<String, PendingAuth>>,
}

impl OidcProvider {
    /// Discovers the OIDC provider metadata and builds the client.
    pub async fn discover(
        issuer_url: String,
        client_id: String,
        client_secret: String,
        redirect_uri: String,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let provider_metadata = CoreProviderMetadata::discover_async(
            IssuerUrl::new(issuer_url)?,
            async_http_client,
        )
        .await?;

        let client = CoreClient::from_provider_metadata(
            provider_metadata,
            ClientId::new(client_id),
            Some(ClientSecret::new(client_secret)),
        )
        .set_redirect_uri(RedirectUrl::new(redirect_uri)?);

        Ok(Self {
            client,
            pending: RwLock::new(HashMap::new()),
        })
    }

    fn evict_stale(pending: &mut HashMap<String, PendingAuth>) {
        pending.retain(|_, v| v.created_at.elapsed() < PENDING_TTL);
    }
}

// --- Query params ---

#[derive(Deserialize)]
pub struct CallbackParams {
    code: String,
    state: String,
}

// --- Handlers ---

pub async fn oidc_redirect(
    State(state): State<AppState>,
) -> Result<Redirect, (StatusCode, &'static str)> {
    let provider = state
        .oidc_provider
        .as_ref()
        .ok_or((StatusCode::NOT_IMPLEMENTED, "OIDC not configured"))?;

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
    let (auth_url, csrf_token, nonce) = provider
        .client
        .authorize_url(
            AuthenticationFlow::<CoreResponseType>::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("openid".into()))
        .add_scope(Scope::new("profile".into()))
        .set_pkce_challenge(pkce_challenge)
        .url();

    let mut pending = provider.pending.write().await;
    OidcProvider::evict_stale(&mut pending);
    pending.insert(
        csrf_token.secret().clone(),
        PendingAuth {
            nonce,
            pkce_verifier,
            created_at: Instant::now(),
        },
    );

    Ok(Redirect::to(auth_url.as_str()))
}

pub async fn oidc_callback(
    jar: CookieJar,
    State(state): State<AppState>,
    Query(params): Query<CallbackParams>,
) -> Result<(CookieJar, Redirect), (StatusCode, String)> {
    let provider = state
        .oidc_provider
        .as_ref()
        .ok_or_else(|| (StatusCode::NOT_IMPLEMENTED, "OIDC not configured".into()))?;

    let pending = provider
        .pending
        .write()
        .await
        .remove(&params.state)
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "unknown or expired state".into()))?;

    if pending.created_at.elapsed() >= PENDING_TTL {
        return Err((StatusCode::BAD_REQUEST, "state expired".into()));
    }

    let token_response = provider
        .client
        .exchange_code(AuthorizationCode::new(params.code))
        .set_pkce_verifier(pending.pkce_verifier)
        .request_async(async_http_client)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let id_token = token_response
        .id_token()
        .ok_or_else(|| (StatusCode::BAD_GATEWAY, "no id_token in response".into()))?;

    let claims = id_token
        .claims(&provider.client.id_token_verifier(), &pending.nonce)
        .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;

    let sub = claims.subject().as_str().to_string();

    // Find existing user or auto-provision one from the OIDC claims.
    let user = match db::get_user_by_oidc_subject(&state.pool, &sub)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        Some(u) => u,
        None => {
            let display_name = claims
                .preferred_username()
                .map(|u| u.as_str().to_string())
                .unwrap_or_else(|| sub.clone());

            db::create_user_with_oidc(&state.pool, &display_name, &sub)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        }
    };

    let session_id = db::create_session(&state.pool, user.id, state.session_duration)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let cookie = Cookie::build((SESSION_COOKIE, session_id.to_string()))
        .http_only(true)
        .path("/")
        .build();

    Ok((jar.add(cookie), Redirect::to("/")))
}
