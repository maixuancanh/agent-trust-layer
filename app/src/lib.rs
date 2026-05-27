#![no_std]

use core::cell::RefCell;
use sails_rs::{collections::BTreeMap, prelude::*};

const MAX_SERVICES: usize = 64;
const MAX_ESCROWS: usize = 128;
const MAX_HANDLE_LEN: usize = 32;
const MIN_HANDLE_LEN: usize = 3;
const MAX_URI_LEN: usize = 160;
const MAX_TAGS: usize = 8;
const MAX_TAG_LEN: usize = 24;

#[sails_rs::sails_type]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TrustError {
    AlreadyRegistered,
    EscrowNotFound,
    InvalidAmount,
    InvalidCounterparty,
    InvalidDeadline,
    InvalidMetadata,
    InvalidRuling,
    InvalidState,
    NotArbiter,
    NotClient,
    NotParticipant,
    NotProvider,
    NoClaim,
    RegistryFull,
    StorageFull,
}

#[sails_rs::sails_type]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EscrowStatus {
    Funded,
    Active,
    WorkSubmitted,
    Disputed,
    Resolved,
    Cancelled,
}

#[sails_rs::sails_type]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServicePassport {
    pub owner: ActorId,
    pub handle: String,
    pub metadata_uri: String,
    pub price: u128,
    pub sla_blocks: u32,
    pub tags: Vec<String>,
    pub updated_at: u32,
}

#[sails_rs::sails_type]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Escrow {
    pub id: u64,
    pub client: ActorId,
    pub provider: ActorId,
    pub arbiter: ActorId,
    pub amount: u128,
    pub terms_hash: String,
    pub proof_uri: Option<String>,
    pub dispute_uri: Option<String>,
    pub ruling_uri: Option<String>,
    pub created_at: u32,
    pub deadline_block: u32,
    pub status: EscrowStatus,
}

#[derive(Default, Clone)]
pub struct AgentTrustLayerState {
    services: BTreeMap<ActorId, ServicePassport>,
    escrows: BTreeMap<u64, Escrow>,
    claims: BTreeMap<ActorId, u128>,
    next_escrow_id: u64,
}

#[sails_rs::sails_type]
#[sails_rs::event]
pub enum AgentTrustLayerEvents {
    ServiceRegistered {
        owner: ActorId,
        handle: String,
    },
    EscrowCreated {
        escrow_id: u64,
        client: ActorId,
        provider: ActorId,
        arbiter: ActorId,
        amount: u128,
    },
    EscrowAccepted {
        escrow_id: u64,
        provider: ActorId,
    },
    WorkSubmitted {
        escrow_id: u64,
        provider: ActorId,
    },
    DisputeOpened {
        escrow_id: u64,
        opened_by: ActorId,
    },
    EscrowResolved {
        escrow_id: u64,
        provider_award: u128,
        client_award: u128,
    },
    EscrowCancelled {
        escrow_id: u64,
    },
    ClaimWithdrawn {
        owner: ActorId,
        amount: u128,
    },
}

struct AgentTrustLayer<
    S: StateMut<Item = AgentTrustLayerState, Error = Infallible> = RefCell<AgentTrustLayerState>,
> {
    state: S,
}

impl<S: StateMut<Item = AgentTrustLayerState, Error = Infallible>> AgentTrustLayer<S> {
    pub fn new(state: S) -> Self {
        Self { state }
    }
}

#[sails_rs::service(events = AgentTrustLayerEvents)]
impl<S: StateMut<Item = AgentTrustLayerState, Error = Infallible>> AgentTrustLayer<S> {
    #[export(unwrap_result)]
    pub fn register_service(
        &mut self,
        handle: String,
        metadata_uri: String,
        price: u128,
        sla_blocks: u32,
        tags: Vec<String>,
    ) -> Result<(), TrustError> {
        validate_handle(&handle)?;
        validate_uri(&metadata_uri)?;
        validate_tags(&tags)?;

        let owner = Syscall::message_source();
        {
            let mut state = self.state.get_mut();
            if !state.services.contains_key(&owner) && state.services.len() == MAX_SERVICES {
                return Err(TrustError::RegistryFull);
            }

            state.services.insert(
                owner,
                ServicePassport {
                    owner,
                    handle: handle.clone(),
                    metadata_uri,
                    price,
                    sla_blocks,
                    tags,
                    updated_at: Syscall::block_height(),
                },
            );
        }

        self.emit_event(AgentTrustLayerEvents::ServiceRegistered { owner, handle })
            .expect("event emission failed");
        Ok(())
    }

    #[export(unwrap_result)]
    pub fn create_escrow(
        &mut self,
        provider: ActorId,
        arbiter: ActorId,
        terms_hash: String,
        deadline_block: u32,
    ) -> Result<u64, TrustError> {
        validate_uri(&terms_hash)?;

        let client = Syscall::message_source();
        let amount = Syscall::message_value();
        let created_at = Syscall::block_height();
        if amount == 0 {
            return Err(TrustError::InvalidAmount);
        }
        if provider == client || arbiter == client || arbiter == provider {
            return Err(TrustError::InvalidCounterparty);
        }
        if deadline_block <= created_at {
            return Err(TrustError::InvalidDeadline);
        }

        let escrow_id;
        {
            let mut state = self.state.get_mut();
            if state.escrows.len() == MAX_ESCROWS {
                return Err(TrustError::StorageFull);
            }

            escrow_id = state.next_escrow_id;
            state.next_escrow_id = state
                .next_escrow_id
                .checked_add(1)
                .ok_or(TrustError::StorageFull)?;
            state.escrows.insert(
                escrow_id,
                Escrow {
                    id: escrow_id,
                    client,
                    provider,
                    arbiter,
                    amount,
                    terms_hash,
                    proof_uri: None,
                    dispute_uri: None,
                    ruling_uri: None,
                    created_at,
                    deadline_block,
                    status: EscrowStatus::Funded,
                },
            );
        }

        self.emit_event(AgentTrustLayerEvents::EscrowCreated {
            escrow_id,
            client,
            provider,
            arbiter,
            amount,
        })
        .expect("event emission failed");
        Ok(escrow_id)
    }

    #[export(unwrap_result)]
    pub fn accept_escrow(&mut self, escrow_id: u64) -> Result<(), TrustError> {
        let provider = Syscall::message_source();
        {
            let mut state = self.state.get_mut();
            let escrow = state
                .escrows
                .get_mut(&escrow_id)
                .ok_or(TrustError::EscrowNotFound)?;
            if escrow.provider != provider {
                return Err(TrustError::NotProvider);
            }
            if escrow.status != EscrowStatus::Funded {
                return Err(TrustError::InvalidState);
            }
            escrow.status = EscrowStatus::Active;
        }

        self.emit_event(AgentTrustLayerEvents::EscrowAccepted {
            escrow_id,
            provider,
        })
        .expect("event emission failed");
        Ok(())
    }

    #[export(unwrap_result)]
    pub fn submit_work(&mut self, escrow_id: u64, proof_uri: String) -> Result<(), TrustError> {
        validate_uri(&proof_uri)?;
        let provider = Syscall::message_source();
        {
            let mut state = self.state.get_mut();
            let escrow = state
                .escrows
                .get_mut(&escrow_id)
                .ok_or(TrustError::EscrowNotFound)?;
            if escrow.provider != provider {
                return Err(TrustError::NotProvider);
            }
            if escrow.status != EscrowStatus::Active {
                return Err(TrustError::InvalidState);
            }
            escrow.proof_uri = Some(proof_uri);
            escrow.status = EscrowStatus::WorkSubmitted;
        }

        self.emit_event(AgentTrustLayerEvents::WorkSubmitted {
            escrow_id,
            provider,
        })
        .expect("event emission failed");
        Ok(())
    }

    #[export(unwrap_result)]
    pub fn approve_work(&mut self, escrow_id: u64) -> Result<(), TrustError> {
        let client = Syscall::message_source();
        let provider;
        let amount;
        {
            let mut state = self.state.get_mut();
            let escrow = state
                .escrows
                .get_mut(&escrow_id)
                .ok_or(TrustError::EscrowNotFound)?;
            if escrow.client != client {
                return Err(TrustError::NotClient);
            }
            if escrow.status != EscrowStatus::WorkSubmitted {
                return Err(TrustError::InvalidState);
            }
            provider = escrow.provider;
            amount = escrow.amount;
            escrow.status = EscrowStatus::Resolved;
            credit(&mut state, provider, amount)?;
        }

        self.emit_event(AgentTrustLayerEvents::EscrowResolved {
            escrow_id,
            provider_award: amount,
            client_award: 0,
        })
        .expect("event emission failed");
        Ok(())
    }

    #[export(unwrap_result)]
    pub fn open_dispute(&mut self, escrow_id: u64, dispute_uri: String) -> Result<(), TrustError> {
        validate_uri(&dispute_uri)?;
        let opened_by = Syscall::message_source();
        {
            let mut state = self.state.get_mut();
            let escrow = state
                .escrows
                .get_mut(&escrow_id)
                .ok_or(TrustError::EscrowNotFound)?;
            if opened_by != escrow.client && opened_by != escrow.provider {
                return Err(TrustError::NotParticipant);
            }
            if escrow.status != EscrowStatus::Active && escrow.status != EscrowStatus::WorkSubmitted
            {
                return Err(TrustError::InvalidState);
            }
            escrow.dispute_uri = Some(dispute_uri);
            escrow.status = EscrowStatus::Disputed;
        }

        self.emit_event(AgentTrustLayerEvents::DisputeOpened {
            escrow_id,
            opened_by,
        })
        .expect("event emission failed");
        Ok(())
    }

    #[export(unwrap_result)]
    pub fn resolve_dispute(
        &mut self,
        escrow_id: u64,
        provider_award: u128,
        client_award: u128,
        ruling_uri: String,
    ) -> Result<(), TrustError> {
        validate_uri(&ruling_uri)?;
        let arbiter = Syscall::message_source();
        {
            let mut state = self.state.get_mut();
            let escrow = state
                .escrows
                .get_mut(&escrow_id)
                .ok_or(TrustError::EscrowNotFound)?;
            if escrow.arbiter != arbiter {
                return Err(TrustError::NotArbiter);
            }
            if escrow.status != EscrowStatus::Disputed {
                return Err(TrustError::InvalidState);
            }
            if provider_award.checked_add(client_award) != Some(escrow.amount) {
                return Err(TrustError::InvalidRuling);
            }

            let provider = escrow.provider;
            let client = escrow.client;
            escrow.ruling_uri = Some(ruling_uri);
            escrow.status = EscrowStatus::Resolved;
            credit(&mut state, provider, provider_award)?;
            credit(&mut state, client, client_award)?;
        }

        self.emit_event(AgentTrustLayerEvents::EscrowResolved {
            escrow_id,
            provider_award,
            client_award,
        })
        .expect("event emission failed");
        Ok(())
    }

    #[export(unwrap_result)]
    pub fn cancel_expired(&mut self, escrow_id: u64) -> Result<(), TrustError> {
        let caller = Syscall::message_source();
        let now = Syscall::block_height();
        let client;
        let amount;
        {
            let mut state = self.state.get_mut();
            let escrow = state
                .escrows
                .get_mut(&escrow_id)
                .ok_or(TrustError::EscrowNotFound)?;
            if caller != escrow.client && caller != escrow.provider {
                return Err(TrustError::NotParticipant);
            }
            if now <= escrow.deadline_block {
                return Err(TrustError::InvalidDeadline);
            }
            if escrow.status != EscrowStatus::Funded && escrow.status != EscrowStatus::Active {
                return Err(TrustError::InvalidState);
            }
            client = escrow.client;
            amount = escrow.amount;
            escrow.status = EscrowStatus::Cancelled;
            credit(&mut state, client, amount)?;
        }

        self.emit_event(AgentTrustLayerEvents::EscrowCancelled { escrow_id })
            .expect("event emission failed");
        Ok(())
    }

    #[export]
    pub fn withdraw_claim(&mut self) -> CommandReply<u128> {
        let owner = Syscall::message_source();
        let amount = {
            let mut state = self.state.get_mut();
            let amount = state.claims.remove(&owner).unwrap_or(0);
            if amount == 0 {
                return CommandReply::new(0);
            }
            amount
        };

        self.emit_event(AgentTrustLayerEvents::ClaimWithdrawn { owner, amount })
            .expect("event emission failed");
        CommandReply::new(amount).with_value(amount)
    }

    #[export]
    pub fn get_service(&self, owner: ActorId) -> Option<ServicePassport> {
        self.state.get().services.get(&owner).cloned()
    }

    #[export]
    pub fn list_services(&self) -> Vec<ServicePassport> {
        self.state.get().services.values().cloned().collect()
    }

    #[export]
    pub fn get_escrow(&self, escrow_id: u64) -> Option<Escrow> {
        self.state.get().escrows.get(&escrow_id).cloned()
    }

    #[export]
    pub fn list_escrows(&self) -> Vec<Escrow> {
        self.state.get().escrows.values().cloned().collect()
    }

    #[export]
    pub fn claimable(&self, owner: ActorId) -> u128 {
        *self.state.get().claims.get(&owner).unwrap_or(&0)
    }
}

#[derive(Default)]
pub struct Program {
    agent_trust_layer_state: RefCell<AgentTrustLayerState>,
}

#[sails_rs::program]
impl Program {
    pub fn create() -> Self {
        Self::default()
    }

    pub fn agent_trust_layer(&self) -> AgentTrustLayer<&RefCell<AgentTrustLayerState>> {
        AgentTrustLayer::new(&self.agent_trust_layer_state)
    }
}

fn credit(
    state: &mut AgentTrustLayerState,
    owner: ActorId,
    amount: u128,
) -> Result<(), TrustError> {
    if amount == 0 {
        return Ok(());
    }
    let current = *state.claims.get(&owner).unwrap_or(&0);
    let next = current.checked_add(amount).ok_or(TrustError::StorageFull)?;
    state.claims.insert(owner, next);
    Ok(())
}

fn validate_handle(handle: &str) -> Result<(), TrustError> {
    if handle.len() < MIN_HANDLE_LEN || handle.len() > MAX_HANDLE_LEN {
        return Err(TrustError::InvalidMetadata);
    }
    if !handle
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
    {
        return Err(TrustError::InvalidMetadata);
    }
    Ok(())
}

fn validate_uri(value: &str) -> Result<(), TrustError> {
    if value.is_empty() || value.len() > MAX_URI_LEN {
        return Err(TrustError::InvalidMetadata);
    }
    Ok(())
}

fn validate_tags(tags: &[String]) -> Result<(), TrustError> {
    if tags.len() > MAX_TAGS {
        return Err(TrustError::InvalidMetadata);
    }
    for tag in tags {
        if tag.is_empty()
            || tag.len() > MAX_TAG_LEN
            || !tag
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
        {
            return Err(TrustError::InvalidMetadata);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sails_rs::gstd::services::Service as _;

    #[test]
    fn service_registers_passport_for_caller() {
        let owner = ActorId::from(42);
        Syscall::with_message_source(owner);
        let state = RefCell::new(AgentTrustLayerState::default());
        let mut service = AgentTrustLayer::new(&state).expose(0);

        let result = service.register_service(
            "agent-trust-layer".to_string(),
            "ipfs://agent-trust-layer/profile".to_string(),
            1_000,
            100,
            vec!["escrow".to_string(), "arbitration".to_string()],
        );

        assert_eq!(Ok(()), result);
        let passport = service.get_service(owner).expect("passport exists");
        assert_eq!(owner, passport.owner);
        assert_eq!("agent-trust-layer", passport.handle);
        assert_eq!(1_000, passport.price);
        assert_eq!(100, passport.sla_blocks);
    }

    #[test]
    fn service_releases_accepted_escrow_to_provider_claims() {
        let client = ActorId::from(1);
        let provider = ActorId::from(2);
        let arbiter = ActorId::from(3);
        let state = RefCell::new(AgentTrustLayerState::default());
        let mut service = AgentTrustLayer::new(&state).expose(0);

        Syscall::with_message_source(client);
        Syscall::with_message_value(10_000);
        Syscall::with_block_height(10);
        let escrow_id = service
            .create_escrow(provider, arbiter, "sha256:terms".to_string(), 40)
            .expect("escrow created");

        Syscall::with_message_source(provider);
        Syscall::with_message_value(0);
        assert_eq!(Ok(()), service.accept_escrow(escrow_id));
        assert_eq!(
            Ok(()),
            service.submit_work(escrow_id, "ipfs://proof".to_string())
        );

        Syscall::with_message_source(client);
        assert_eq!(Ok(()), service.approve_work(escrow_id));

        let escrow = service.get_escrow(escrow_id).expect("escrow exists");
        assert_eq!(EscrowStatus::Resolved, escrow.status);
        assert_eq!(10_000, service.claimable(provider));
        assert_eq!(0, service.claimable(client));
    }

    #[test]
    fn service_splits_disputed_escrow_by_arbiter_ruling() {
        let client = ActorId::from(1);
        let provider = ActorId::from(2);
        let arbiter = ActorId::from(3);
        let state = RefCell::new(AgentTrustLayerState::default());
        let mut service = AgentTrustLayer::new(&state).expose(0);

        Syscall::with_message_source(client);
        Syscall::with_message_value(10_000);
        Syscall::with_block_height(10);
        let escrow_id = service
            .create_escrow(provider, arbiter, "sha256:terms".to_string(), 40)
            .expect("escrow created");

        Syscall::with_message_source(provider);
        Syscall::with_message_value(0);
        assert_eq!(Ok(()), service.accept_escrow(escrow_id));

        Syscall::with_message_source(client);
        assert_eq!(
            Ok(()),
            service.open_dispute(escrow_id, "ipfs://client-dispute".to_string())
        );

        Syscall::with_message_source(arbiter);
        assert_eq!(
            Ok(()),
            service.resolve_dispute(escrow_id, 4_000, 6_000, "ipfs://ruling".to_string())
        );

        let escrow = service.get_escrow(escrow_id).expect("escrow exists");
        assert_eq!(EscrowStatus::Resolved, escrow.status);
        assert_eq!(4_000, service.claimable(provider));
        assert_eq!(6_000, service.claimable(client));
    }
}
