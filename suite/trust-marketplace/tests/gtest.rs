use ::trust_marketplace_client::{
    TrustMarketplaceClient as _, TrustMarketplaceClientCtors as _, trust_marketplace::*,
};
#[allow(unused_imports)]
use sails_rs::{client::*, gtest::*, prelude::*};

async fn deploy() -> (
    GtestEnv,
    Actor<trust_marketplace_client::TrustMarketplaceClientProgram, GtestEnv>,
) {
    let env = GtestEnv::system_default();
    env.system()
        .mint_to(DEFAULT_USER_BOB, DEFAULT_USERS_INITIAL_BALANCE);

    let code_id = env.system().submit_code(::trust_marketplace::WASM_BINARY);
    let program = env
        .deploy::<::trust_marketplace_client::TrustMarketplaceClientProgram>(
            code_id,
            b"salt".to_vec(),
        )
        .create()
        .await
        .unwrap();

    (env, program)
}

#[tokio::test]
async fn provider_profile_can_be_registered_and_queried() {
    let (_env, program) = deploy().await;
    let mut service = program.trust_marketplace();
    let trust_layer = ActorId::from(99);

    service
        .register_provider(
            "proof-writer".to_string(),
            "https://example.com/provider.json".to_string(),
            vec!["proof".to_string(), "escrow".to_string()],
            1_000,
            trust_layer,
        )
        .await
        .unwrap()
        .unwrap();

    let profile = service
        .get_provider(ActorId::from(DEFAULT_USER_ALICE))
        .await
        .unwrap()
        .expect("provider exists");

    assert_eq!("proof-writer", profile.handle);
    assert_eq!(trust_layer, profile.trust_layer_program);
    assert_eq!(1, service.list_providers().await.unwrap().len());
}

#[tokio::test]
async fn client_creates_hire_intent_that_points_to_trust_layer() {
    let (_env, program) = deploy().await;
    let mut service = program.trust_marketplace();
    let trust_layer = ActorId::from(99);

    service
        .register_provider(
            "proof-writer".to_string(),
            "https://example.com/provider.json".to_string(),
            vec!["proof".to_string()],
            1_000,
            trust_layer,
        )
        .with_actor_id(ActorId::from(DEFAULT_USER_BOB))
        .await
        .unwrap()
        .unwrap();

    let intent_id = service
        .create_hire_intent(
            ActorId::from(DEFAULT_USER_BOB),
            "https://example.com/terms.json".to_string(),
            2_000,
            100,
        )
        .await
        .unwrap()
        .unwrap();

    let intent = service
        .get_hire_intent(intent_id)
        .await
        .unwrap()
        .expect("intent exists");
    assert_eq!(ActorId::from(DEFAULT_USER_ALICE), intent.client);
    assert_eq!(ActorId::from(DEFAULT_USER_BOB), intent.provider);
    assert_eq!(trust_layer, intent.trust_layer_program);
}
