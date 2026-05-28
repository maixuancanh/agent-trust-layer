fn main() {
    let manifest_dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let package_name = std::env::var("CARGO_PKG_NAME").unwrap().replace('-', "_");
    let idl_path = manifest_dir.join(&package_name).with_extension("idl");
    let client_path = manifest_dir
        .join("src")
        .join(&package_name)
        .with_extension("rs");

    sails_rs::ClientBuilder::<::agent_trust_layer_app::Program>::from_env().build_idl();

    let idl = std::fs::read_to_string(&idl_path).expect("read generated IDL");
    let patched = patch_idl_for_validation(&idl);
    std::fs::write(&idl_path, patched).expect("write patched IDL");

    sails_rs::ClientGenerator::from_idl_path(&idl_path)
        .generate_to(&client_path)
        .expect("generate client from patched IDL");
}

fn patch_idl_for_validation(idl: &str) -> String {
    let patched = if idl.contains("@partial\nservice AgentTrustLayer@") {
        idl.to_owned()
    } else {
        idl.replacen(
            "service AgentTrustLayer@",
            "@partial\nservice AgentTrustLayer@",
            1,
        )
    };
    add_entry_ids(&patched)
}

fn add_entry_ids(idl: &str) -> String {
    let mut output = String::new();
    let mut in_functions = false;
    let mut in_events = false;
    let mut next_entry_id = 0u16;
    let mut next_event_id = 0u16;

    for line in idl.lines() {
        let trimmed = line.trim_start();
        let leading_spaces = line.len() - trimmed.len();
        if trimmed == "events {" {
            in_events = true;
            output.push_str(line);
            output.push('\n');
            continue;
        }
        if trimmed == "functions {" {
            in_functions = true;
            output.push_str(line);
            output.push('\n');
            continue;
        }
        if in_events && trimmed == "}" {
            in_events = false;
        }
        if in_functions && trimmed == "}" {
            in_functions = false;
        }
        if in_events
            && leading_spaces == 8
            && !trimmed.starts_with('}')
            && (trimmed.ends_with('{') || trimmed.ends_with(','))
        {
            output.push_str("        @entry_id: ");
            output.push_str(&next_event_id.to_string());
            output.push('\n');
            next_event_id += 1;
        }
        if in_functions && leading_spaces == 8 && trimmed.contains('(') && trimmed.ends_with(';') {
            output.push_str("        @entry_id: ");
            output.push_str(&next_entry_id.to_string());
            output.push('\n');
            next_entry_id += 1;
        }
        output.push_str(line);
        output.push('\n');
    }

    output
}
