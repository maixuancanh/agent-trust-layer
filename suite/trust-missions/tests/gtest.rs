use ::trust_missions_client::{
    TrustMissionsClient as _, TrustMissionsClientCtors as _, trust_missions::*,
};
#[allow(unused_imports)]
use sails_rs::{client::*, gtest::*, prelude::*};

async fn deploy() -> (
    GtestEnv,
    Actor<trust_missions_client::TrustMissionsClientProgram, GtestEnv>,
) {
    let env = GtestEnv::system_default();
    env.system()
        .mint_to(DEFAULT_USER_BOB, DEFAULT_USERS_INITIAL_BALANCE);

    let code_id = env.system().submit_code(::trust_missions::WASM_BINARY);
    let program = env
        .deploy::<::trust_missions_client::TrustMissionsClientProgram>(code_id, b"salt".to_vec())
        .create()
        .await
        .unwrap();

    (env, program)
}

#[tokio::test]
async fn mission_can_be_created_and_listed() {
    let (_env, program) = deploy().await;
    let mut service = program.trust_missions();

    let mission_id = service
        .create_mission(
            "Write escrow proof".to_string(),
            "https://example.com/terms.json".to_string(),
            1_000,
            100,
            vec!["proof".to_string(), "escrow".to_string()],
        )
        .await
        .unwrap()
        .unwrap();

    let mission = service
        .get_mission(mission_id)
        .await
        .unwrap()
        .expect("mission exists");
    assert_eq!("Write escrow proof", mission.title);
    assert_eq!(MissionStatus::Open, mission.status);
    assert_eq!(1, service.list_missions().await.unwrap().len());
}

#[tokio::test]
async fn mission_assignment_records_trust_layer_escrow_id() {
    let (_env, program) = deploy().await;
    let mut service = program.trust_missions();

    let mission_id = service
        .create_mission(
            "Write escrow proof".to_string(),
            "https://example.com/terms.json".to_string(),
            1_000,
            100,
            vec!["proof".to_string()],
        )
        .await
        .unwrap()
        .unwrap();

    service
        .apply_to_mission(mission_id)
        .with_actor_id(ActorId::from(DEFAULT_USER_BOB))
        .await
        .unwrap()
        .unwrap();
    service
        .assign_mission(mission_id, ActorId::from(DEFAULT_USER_BOB), 42)
        .await
        .unwrap()
        .unwrap();
    service
        .submit_mission_proof(mission_id, "https://example.com/proof.json".to_string())
        .with_actor_id(ActorId::from(DEFAULT_USER_BOB))
        .await
        .unwrap()
        .unwrap();
    service.close_mission(mission_id).await.unwrap().unwrap();

    let mission = service
        .get_mission(mission_id)
        .await
        .unwrap()
        .expect("mission exists");
    assert_eq!(MissionStatus::Closed, mission.status);
    assert_eq!(Some(42), mission.escrow_id);
    assert_eq!(
        Some(ActorId::from(DEFAULT_USER_BOB)),
        mission.assigned_provider
    );
}
