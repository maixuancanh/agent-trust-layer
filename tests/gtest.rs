use ::agent_trust_layer_client::{
    AgentTrustLayerClient as _, AgentTrustLayerClientCtors as _, agent_trust_layer::*,
};
#[allow(unused_imports)]
use sails_rs::{client::*, gtest::*, prelude::*};

const ESCROW_AMOUNT: u128 = 10_000;

async fn deploy() -> (
    GtestEnv,
    Actor<agent_trust_layer_client::AgentTrustLayerClientProgram, GtestEnv>,
) {
    let env = GtestEnv::system_default();
    env.system()
        .mint_to(DEFAULT_USER_BOB, DEFAULT_USERS_INITIAL_BALANCE);
    env.system()
        .mint_to(DEFAULT_USER_CHARLIE, DEFAULT_USERS_INITIAL_BALANCE);

    let code_id = env.system().submit_code(::agent_trust_layer::WASM_BINARY);
    let program = env
        .deploy::<::agent_trust_layer_client::AgentTrustLayerClientProgram>(
            code_id,
            b"salt".to_vec(),
        )
        .create()
        .await
        .unwrap();

    (env, program)
}

#[tokio::test]
async fn passport_can_be_registered_and_queried() {
    let (_env, program) = deploy().await;
    let mut service = program.agent_trust_layer();

    service
        .register_service(
            "agent-trust-layer".to_string(),
            "ipfs://agent-trust-layer/profile".to_string(),
            1_000,
            100,
            vec!["escrow".to_string(), "arbitration".to_string()],
        )
        .await
        .unwrap()
        .unwrap();

    let passport = service
        .get_service(ActorId::from(DEFAULT_USER_ALICE))
        .await
        .unwrap()
        .expect("passport exists");

    assert_eq!(ActorId::from(DEFAULT_USER_ALICE), passport.owner);
    assert_eq!("agent-trust-layer", passport.handle);
    assert_eq!(1_000, passport.price);
}

#[tokio::test]
async fn escrow_release_creates_provider_claim_and_withdraw_returns_value() {
    let (_env, program) = deploy().await;
    let mut service = program.agent_trust_layer();

    let escrow_id = service
        .create_escrow(
            ActorId::from(DEFAULT_USER_BOB),
            ActorId::from(DEFAULT_USER_CHARLIE),
            "sha256:terms".to_string(),
            40,
        )
        .with_value(ESCROW_AMOUNT)
        .await
        .unwrap()
        .unwrap();

    service
        .accept_escrow(escrow_id)
        .with_actor_id(ActorId::from(DEFAULT_USER_BOB))
        .await
        .unwrap()
        .unwrap();
    service
        .submit_work(escrow_id, "ipfs://proof".to_string())
        .with_actor_id(ActorId::from(DEFAULT_USER_BOB))
        .await
        .unwrap()
        .unwrap();
    service.approve_work(escrow_id).await.unwrap().unwrap();

    assert_eq!(
        ESCROW_AMOUNT,
        service
            .claimable(ActorId::from(DEFAULT_USER_BOB))
            .await
            .unwrap()
    );

    let withdrawn = service
        .withdraw_claim()
        .with_actor_id(ActorId::from(DEFAULT_USER_BOB))
        .await
        .unwrap();

    assert_eq!(ESCROW_AMOUNT, withdrawn);
    assert_eq!(
        0,
        service
            .claimable(ActorId::from(DEFAULT_USER_BOB))
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn arbiter_can_split_a_disputed_escrow() {
    let (_env, program) = deploy().await;
    let mut service = program.agent_trust_layer();

    let escrow_id = service
        .create_escrow(
            ActorId::from(DEFAULT_USER_BOB),
            ActorId::from(DEFAULT_USER_CHARLIE),
            "sha256:terms".to_string(),
            40,
        )
        .with_value(ESCROW_AMOUNT)
        .await
        .unwrap()
        .unwrap();

    service
        .accept_escrow(escrow_id)
        .with_actor_id(ActorId::from(DEFAULT_USER_BOB))
        .await
        .unwrap()
        .unwrap();
    service
        .open_dispute(escrow_id, "ipfs://client-dispute".to_string())
        .await
        .unwrap()
        .unwrap();
    service
        .resolve_dispute(escrow_id, 4_000, 6_000, "ipfs://ruling".to_string())
        .with_actor_id(ActorId::from(DEFAULT_USER_CHARLIE))
        .await
        .unwrap()
        .unwrap();

    assert_eq!(
        4_000,
        service
            .claimable(ActorId::from(DEFAULT_USER_BOB))
            .await
            .unwrap()
    );
    assert_eq!(
        6_000,
        service
            .claimable(ActorId::from(DEFAULT_USER_ALICE))
            .await
            .unwrap()
    );
}
