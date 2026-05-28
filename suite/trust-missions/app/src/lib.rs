#![no_std]

use core::cell::RefCell;
use sails_rs::{collections::BTreeMap, prelude::*};

const MAX_MISSIONS: usize = 128;
const MAX_APPLICANTS: usize = 16;
const MAX_TITLE_LEN: usize = 64;
const MAX_URI_LEN: usize = 180;
const MAX_TAGS: usize = 8;
const MAX_TAG_LEN: usize = 24;

#[sails_rs::sails_type]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MissionError {
    InvalidAmount,
    InvalidDeadline,
    InvalidMetadata,
    InvalidState,
    MissionNotFound,
    NotCreator,
    NotProvider,
    StorageFull,
}

#[sails_rs::sails_type]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MissionStatus {
    Open,
    Assigned,
    ProofSubmitted,
    Closed,
}

#[sails_rs::sails_type]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Mission {
    pub id: u64,
    pub creator: ActorId,
    pub title: String,
    pub terms_uri: String,
    pub reward: u128,
    pub deadline_block: u32,
    pub tags: Vec<String>,
    pub applicants: Vec<ActorId>,
    pub assigned_provider: Option<ActorId>,
    pub escrow_id: Option<u64>,
    pub proof_uri: Option<String>,
    pub created_at: u32,
    pub status: MissionStatus,
}

#[derive(Default, Clone)]
pub struct TrustMissionsState {
    missions: BTreeMap<u64, Mission>,
    next_mission_id: u64,
}

#[sails_rs::sails_type]
#[sails_rs::event]
pub enum TrustMissionsEvents {
    MissionCreated {
        mission_id: u64,
        creator: ActorId,
        reward: u128,
    },
    MissionApplied {
        mission_id: u64,
        provider: ActorId,
    },
    MissionAssigned {
        mission_id: u64,
        provider: ActorId,
        escrow_id: u64,
    },
    MissionProofSubmitted {
        mission_id: u64,
        provider: ActorId,
    },
    MissionClosed {
        mission_id: u64,
    },
}

struct TrustMissions<
    S: StateMut<Item = TrustMissionsState, Error = Infallible> = RefCell<TrustMissionsState>,
> {
    state: S,
}

impl<S: StateMut<Item = TrustMissionsState, Error = Infallible>> TrustMissions<S> {
    pub fn new(state: S) -> Self {
        Self { state }
    }
}

#[sails_rs::service(events = TrustMissionsEvents)]
impl<S: StateMut<Item = TrustMissionsState, Error = Infallible>> TrustMissions<S> {
    #[export(unwrap_result)]
    pub fn create_mission(
        &mut self,
        title: String,
        terms_uri: String,
        reward: u128,
        deadline_block: u32,
        tags: Vec<String>,
    ) -> Result<u64, MissionError> {
        validate_title(&title)?;
        validate_uri(&terms_uri)?;
        validate_tags(&tags)?;
        if reward == 0 {
            return Err(MissionError::InvalidAmount);
        }
        let creator = Syscall::message_source();
        let created_at = Syscall::block_height();
        if deadline_block <= created_at {
            return Err(MissionError::InvalidDeadline);
        }

        let mission_id;
        {
            let mut state = self.state.get_mut();
            if state.missions.len() == MAX_MISSIONS {
                return Err(MissionError::StorageFull);
            }
            mission_id = state.next_mission_id;
            state.next_mission_id = state
                .next_mission_id
                .checked_add(1)
                .ok_or(MissionError::StorageFull)?;
            state.missions.insert(
                mission_id,
                Mission {
                    id: mission_id,
                    creator,
                    title,
                    terms_uri,
                    reward,
                    deadline_block,
                    tags,
                    applicants: Vec::new(),
                    assigned_provider: None,
                    escrow_id: None,
                    proof_uri: None,
                    created_at,
                    status: MissionStatus::Open,
                },
            );
        }

        self.emit_event(TrustMissionsEvents::MissionCreated {
            mission_id,
            creator,
            reward,
        })
        .expect("event emission failed");
        Ok(mission_id)
    }

    #[export(unwrap_result)]
    pub fn apply_to_mission(&mut self, mission_id: u64) -> Result<(), MissionError> {
        let provider = Syscall::message_source();
        {
            let mut state = self.state.get_mut();
            let mission = state
                .missions
                .get_mut(&mission_id)
                .ok_or(MissionError::MissionNotFound)?;
            if mission.status != MissionStatus::Open {
                return Err(MissionError::InvalidState);
            }
            if !mission.applicants.contains(&provider) {
                if mission.applicants.len() == MAX_APPLICANTS {
                    return Err(MissionError::StorageFull);
                }
                mission.applicants.push(provider);
            }
        }

        self.emit_event(TrustMissionsEvents::MissionApplied {
            mission_id,
            provider,
        })
        .expect("event emission failed");
        Ok(())
    }

    #[export(unwrap_result)]
    pub fn assign_mission(
        &mut self,
        mission_id: u64,
        provider: ActorId,
        escrow_id: u64,
    ) -> Result<(), MissionError> {
        let creator = Syscall::message_source();
        {
            let mut state = self.state.get_mut();
            let mission = state
                .missions
                .get_mut(&mission_id)
                .ok_or(MissionError::MissionNotFound)?;
            if mission.creator != creator {
                return Err(MissionError::NotCreator);
            }
            if mission.status != MissionStatus::Open {
                return Err(MissionError::InvalidState);
            }
            if !mission.applicants.contains(&provider) {
                return Err(MissionError::NotProvider);
            }
            mission.assigned_provider = Some(provider);
            mission.escrow_id = Some(escrow_id);
            mission.status = MissionStatus::Assigned;
        }

        self.emit_event(TrustMissionsEvents::MissionAssigned {
            mission_id,
            provider,
            escrow_id,
        })
        .expect("event emission failed");
        Ok(())
    }

    #[export(unwrap_result)]
    pub fn submit_mission_proof(
        &mut self,
        mission_id: u64,
        proof_uri: String,
    ) -> Result<(), MissionError> {
        validate_uri(&proof_uri)?;
        let provider = Syscall::message_source();
        {
            let mut state = self.state.get_mut();
            let mission = state
                .missions
                .get_mut(&mission_id)
                .ok_or(MissionError::MissionNotFound)?;
            if mission.assigned_provider != Some(provider) {
                return Err(MissionError::NotProvider);
            }
            if mission.status != MissionStatus::Assigned {
                return Err(MissionError::InvalidState);
            }
            mission.proof_uri = Some(proof_uri);
            mission.status = MissionStatus::ProofSubmitted;
        }

        self.emit_event(TrustMissionsEvents::MissionProofSubmitted {
            mission_id,
            provider,
        })
        .expect("event emission failed");
        Ok(())
    }

    #[export(unwrap_result)]
    pub fn close_mission(&mut self, mission_id: u64) -> Result<(), MissionError> {
        let creator = Syscall::message_source();
        {
            let mut state = self.state.get_mut();
            let mission = state
                .missions
                .get_mut(&mission_id)
                .ok_or(MissionError::MissionNotFound)?;
            if mission.creator != creator {
                return Err(MissionError::NotCreator);
            }
            if mission.status != MissionStatus::ProofSubmitted {
                return Err(MissionError::InvalidState);
            }
            mission.status = MissionStatus::Closed;
        }

        self.emit_event(TrustMissionsEvents::MissionClosed { mission_id })
            .expect("event emission failed");
        Ok(())
    }

    #[export]
    pub fn get_mission(&self, mission_id: u64) -> Option<Mission> {
        self.state.get().missions.get(&mission_id).cloned()
    }

    #[export]
    pub fn list_missions(&self) -> Vec<Mission> {
        self.state.get().missions.values().cloned().collect()
    }
}

#[derive(Default)]
pub struct Program {
    trust_missions_state: RefCell<TrustMissionsState>,
}

#[sails_rs::program]
impl Program {
    pub fn create() -> Self {
        Self::default()
    }

    pub fn trust_missions(&self) -> TrustMissions<&RefCell<TrustMissionsState>> {
        TrustMissions::new(&self.trust_missions_state)
    }
}

fn validate_title(title: &str) -> Result<(), MissionError> {
    if title.is_empty() || title.len() > MAX_TITLE_LEN {
        return Err(MissionError::InvalidMetadata);
    }
    Ok(())
}

fn validate_uri(value: &str) -> Result<(), MissionError> {
    if value.is_empty() || value.len() > MAX_URI_LEN {
        return Err(MissionError::InvalidMetadata);
    }
    Ok(())
}

fn validate_tags(tags: &[String]) -> Result<(), MissionError> {
    if tags.len() > MAX_TAGS {
        return Err(MissionError::InvalidMetadata);
    }
    for tag in tags {
        if tag.is_empty()
            || tag.len() > MAX_TAG_LEN
            || !tag
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
        {
            return Err(MissionError::InvalidMetadata);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sails_rs::gstd::services::Service as _;

    #[test]
    fn creator_opens_mission() {
        Syscall::with_message_source(ActorId::from(1));
        Syscall::with_block_height(10);
        let state = RefCell::new(TrustMissionsState::default());
        let mut service = TrustMissions::new(&state).expose(0);

        let mission_id = service
            .create_mission(
                "Write escrow proof".to_string(),
                "https://example.com/terms.json".to_string(),
                1_000,
                100,
                vec!["proof".to_string()],
            )
            .expect("mission created");

        let mission = service.get_mission(mission_id).expect("mission exists");
        assert_eq!(MissionStatus::Open, mission.status);
        assert_eq!(1_000, mission.reward);
    }

    #[test]
    fn full_mission_state_flow_records_escrow_id() {
        let creator = ActorId::from(1);
        let provider = ActorId::from(2);
        let state = RefCell::new(TrustMissionsState::default());
        let mut service = TrustMissions::new(&state).expose(0);

        Syscall::with_message_source(creator);
        Syscall::with_block_height(10);
        let mission_id = service
            .create_mission(
                "Write escrow proof".to_string(),
                "https://example.com/terms.json".to_string(),
                1_000,
                100,
                vec!["proof".to_string()],
            )
            .expect("mission created");

        Syscall::with_message_source(provider);
        service
            .apply_to_mission(mission_id)
            .expect("provider applied");

        Syscall::with_message_source(creator);
        service
            .assign_mission(mission_id, provider, 42)
            .expect("mission assigned");

        Syscall::with_message_source(provider);
        service
            .submit_mission_proof(mission_id, "https://example.com/proof.json".to_string())
            .expect("proof submitted");

        Syscall::with_message_source(creator);
        service.close_mission(mission_id).expect("mission closed");

        let mission = service.get_mission(mission_id).expect("mission exists");
        assert_eq!(MissionStatus::Closed, mission.status);
        assert_eq!(Some(42), mission.escrow_id);
        assert_eq!(Some(provider), mission.assigned_provider);
    }
}
