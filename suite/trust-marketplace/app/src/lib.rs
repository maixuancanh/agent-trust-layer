#![no_std]

use core::cell::RefCell;
use sails_rs::{collections::BTreeMap, prelude::*};

const MAX_PROVIDERS: usize = 96;
const MAX_HIRE_INTENTS: usize = 128;
const MAX_HANDLE_LEN: usize = 32;
const MIN_HANDLE_LEN: usize = 3;
const MAX_URI_LEN: usize = 180;
const MAX_TAGS: usize = 8;
const MAX_TAG_LEN: usize = 24;

#[sails_rs::sails_type]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MarketplaceError {
    InvalidMetadata,
    InvalidAmount,
    InvalidDeadline,
    InvalidProvider,
    ProviderNotFound,
    StorageFull,
}

#[sails_rs::sails_type]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderProfile {
    pub owner: ActorId,
    pub handle: String,
    pub metadata_uri: String,
    pub tags: Vec<String>,
    pub price: u128,
    pub trust_layer_program: ActorId,
    pub updated_at: u32,
}

#[sails_rs::sails_type]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HireIntent {
    pub id: u64,
    pub client: ActorId,
    pub provider: ActorId,
    pub terms_uri: String,
    pub reward: u128,
    pub deadline_block: u32,
    pub trust_layer_program: ActorId,
    pub created_at: u32,
}

#[derive(Default, Clone)]
pub struct TrustMarketplaceState {
    providers: BTreeMap<ActorId, ProviderProfile>,
    hire_intents: BTreeMap<u64, HireIntent>,
    next_hire_intent_id: u64,
}

#[sails_rs::sails_type]
#[sails_rs::event]
pub enum TrustMarketplaceEvents {
    ProviderRegistered {
        provider: ActorId,
        handle: String,
    },
    HireIntentCreated {
        intent_id: u64,
        client: ActorId,
        provider: ActorId,
        reward: u128,
    },
}

struct TrustMarketplace<
    S: StateMut<Item = TrustMarketplaceState, Error = Infallible> = RefCell<TrustMarketplaceState>,
> {
    state: S,
}

impl<S: StateMut<Item = TrustMarketplaceState, Error = Infallible>> TrustMarketplace<S> {
    pub fn new(state: S) -> Self {
        Self { state }
    }
}

#[sails_rs::service(events = TrustMarketplaceEvents)]
impl<S: StateMut<Item = TrustMarketplaceState, Error = Infallible>> TrustMarketplace<S> {
    #[export(unwrap_result)]
    pub fn register_provider(
        &mut self,
        handle: String,
        metadata_uri: String,
        tags: Vec<String>,
        price: u128,
        trust_layer_program: ActorId,
    ) -> Result<(), MarketplaceError> {
        validate_handle(&handle)?;
        validate_uri(&metadata_uri)?;
        validate_tags(&tags)?;
        if price == 0 {
            return Err(MarketplaceError::InvalidAmount);
        }

        let provider = Syscall::message_source();
        {
            let mut state = self.state.get_mut();
            if !state.providers.contains_key(&provider) && state.providers.len() == MAX_PROVIDERS {
                return Err(MarketplaceError::StorageFull);
            }
            state.providers.insert(
                provider,
                ProviderProfile {
                    owner: provider,
                    handle: handle.clone(),
                    metadata_uri,
                    tags,
                    price,
                    trust_layer_program,
                    updated_at: Syscall::block_height(),
                },
            );
        }

        self.emit_event(TrustMarketplaceEvents::ProviderRegistered { provider, handle })
            .expect("event emission failed");
        Ok(())
    }

    #[export(unwrap_result)]
    pub fn create_hire_intent(
        &mut self,
        provider: ActorId,
        terms_uri: String,
        reward: u128,
        deadline_block: u32,
    ) -> Result<u64, MarketplaceError> {
        validate_uri(&terms_uri)?;
        if reward == 0 {
            return Err(MarketplaceError::InvalidAmount);
        }
        let client = Syscall::message_source();
        if provider == client {
            return Err(MarketplaceError::InvalidProvider);
        }
        let created_at = Syscall::block_height();
        if deadline_block <= created_at {
            return Err(MarketplaceError::InvalidDeadline);
        }

        let (intent_id, trust_layer_program);
        {
            let mut state = self.state.get_mut();
            let profile = state
                .providers
                .get(&provider)
                .ok_or(MarketplaceError::ProviderNotFound)?;
            trust_layer_program = profile.trust_layer_program;
            if state.hire_intents.len() == MAX_HIRE_INTENTS {
                return Err(MarketplaceError::StorageFull);
            }
            intent_id = state.next_hire_intent_id;
            state.next_hire_intent_id = state
                .next_hire_intent_id
                .checked_add(1)
                .ok_or(MarketplaceError::StorageFull)?;
            state.hire_intents.insert(
                intent_id,
                HireIntent {
                    id: intent_id,
                    client,
                    provider,
                    terms_uri,
                    reward,
                    deadline_block,
                    trust_layer_program,
                    created_at,
                },
            );
        }

        self.emit_event(TrustMarketplaceEvents::HireIntentCreated {
            intent_id,
            client,
            provider,
            reward,
        })
        .expect("event emission failed");
        Ok(intent_id)
    }

    #[export]
    pub fn get_provider(&self, provider: ActorId) -> Option<ProviderProfile> {
        self.state.get().providers.get(&provider).cloned()
    }

    #[export]
    pub fn list_providers(&self) -> Vec<ProviderProfile> {
        self.state.get().providers.values().cloned().collect()
    }

    #[export]
    pub fn get_hire_intent(&self, intent_id: u64) -> Option<HireIntent> {
        self.state.get().hire_intents.get(&intent_id).cloned()
    }

    #[export]
    pub fn list_hire_intents(&self) -> Vec<HireIntent> {
        self.state.get().hire_intents.values().cloned().collect()
    }
}

#[derive(Default)]
pub struct Program {
    trust_marketplace_state: RefCell<TrustMarketplaceState>,
}

#[sails_rs::program]
impl Program {
    pub fn create() -> Self {
        Self::default()
    }

    pub fn trust_marketplace(&self) -> TrustMarketplace<&RefCell<TrustMarketplaceState>> {
        TrustMarketplace::new(&self.trust_marketplace_state)
    }
}

fn validate_handle(handle: &str) -> Result<(), MarketplaceError> {
    if handle.len() < MIN_HANDLE_LEN || handle.len() > MAX_HANDLE_LEN {
        return Err(MarketplaceError::InvalidMetadata);
    }
    if !handle
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
    {
        return Err(MarketplaceError::InvalidMetadata);
    }
    Ok(())
}

fn validate_uri(value: &str) -> Result<(), MarketplaceError> {
    if value.is_empty() || value.len() > MAX_URI_LEN {
        return Err(MarketplaceError::InvalidMetadata);
    }
    Ok(())
}

fn validate_tags(tags: &[String]) -> Result<(), MarketplaceError> {
    if tags.len() > MAX_TAGS {
        return Err(MarketplaceError::InvalidMetadata);
    }
    for tag in tags {
        if tag.is_empty()
            || tag.len() > MAX_TAG_LEN
            || !tag
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
        {
            return Err(MarketplaceError::InvalidMetadata);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sails_rs::gstd::services::Service as _;

    #[test]
    fn provider_registers_profile() {
        let provider = ActorId::from(2);
        let trust_layer = ActorId::from(99);
        Syscall::with_message_source(provider);
        Syscall::with_block_height(10);
        let state = RefCell::new(TrustMarketplaceState::default());
        let mut service = TrustMarketplace::new(&state).expose(0);

        assert_eq!(
            Ok(()),
            service.register_provider(
                "proof-writer".to_string(),
                "https://example.com/provider.json".to_string(),
                vec!["proof".to_string(), "escrow".to_string()],
                1_000,
                trust_layer,
            )
        );

        let profile = service.get_provider(provider).expect("provider exists");
        assert_eq!("proof-writer", profile.handle);
        assert_eq!(trust_layer, profile.trust_layer_program);
        assert_eq!(10, profile.updated_at);
    }

    #[test]
    fn client_creates_hire_intent_for_registered_provider() {
        let client = ActorId::from(1);
        let provider = ActorId::from(2);
        let trust_layer = ActorId::from(99);
        let state = RefCell::new(TrustMarketplaceState::default());
        let mut service = TrustMarketplace::new(&state).expose(0);

        Syscall::with_message_source(provider);
        Syscall::with_block_height(10);
        service
            .register_provider(
                "proof-writer".to_string(),
                "https://example.com/provider.json".to_string(),
                vec!["proof".to_string()],
                1_000,
                trust_layer,
            )
            .expect("provider registered");

        Syscall::with_message_source(client);
        Syscall::with_block_height(20);
        let intent_id = service
            .create_hire_intent(
                provider,
                "https://example.com/terms.json".to_string(),
                2_000,
                100,
            )
            .expect("intent created");

        let intent = service.get_hire_intent(intent_id).expect("intent exists");
        assert_eq!(client, intent.client);
        assert_eq!(provider, intent.provider);
        assert_eq!(2_000, intent.reward);
        assert_eq!(trust_layer, intent.trust_layer_program);
    }
}
